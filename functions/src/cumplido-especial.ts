import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  NOTA_MAXIMA_DE_CUMPLIDO,
  cumplidoPideNota,
  motivoDeCumplidoValido,
} from '../../src/domain/motivos-de-cumplido';
import { diaLocal, minutosNetos, refrigerioCentrado, type Turno } from './horario-cumplido';
import { COLLECTIONS, db, nowISO } from './shared/admin';
import {
  attendanceStateAt,
  filaDelEvento,
  rebuildWorkSession,
  reservarSecuencias,
  type TimeEventInput,
} from './shared/attendance';
import {
  audit,
  membershipOf,
  requireManagesLocation,
  requireRole,
  requireUid,
} from './shared/caller';

/**
 * DAR UN TURNO POR CUMPLIDO POR UN MOTIVO ESPECIAL (4-oct).
 *
 * POR QUÉ EXISTE. Andree, el día de las elecciones: «la escogieron como miembro de mesa,
 * quiero poner que sí cumplió su horario de hoy y que es especial, que sí cumplió sus horas».
 * No había forma: «Registrar como cumplido» se niega a propósito a tocar días con reloj —si
 * no, dar una falta por trabajada sería un clic— y «¿Por qué faltó?» la deja justificada
 * pero sin horas.
 *
 * QUÉ HACE: lo mismo que «Registrar como cumplido» con UN turno —entrada a su hora, el
 * refrigerio que tiene planificado y salida a su hora, armados en jornada con el mismo
 * código que el reloj—, y además guarda el MOTIVO en esos fichajes. La jornada lo hereda
 * (`credit_reason` en `rebuildWorkSession`) y cada pantalla dice «Cumplido · Miembro de
 * mesa» donde antes diría «Según horario». Como son fichajes y jornada de verdad, las horas
 * cuentan en Horas, Equipo, Reportes, el bono, la exportación y su celular sin que cada
 * pantalla tenga que saber nada de esto; y la falta desaparece en todas, porque el turno
 * queda cubierto.
 *
 * LOS SEGUROS, porque esto escribe horas que se pagan:
 *   1. UNO POR UNO, con motivo, y «Otro» con su explicación.
 *   2. SOLO UN TURNO PUBLICADO Y YA TERMINADO: antes de que acabe habría que escribir una
 *      salida que todavía no pasó, y el reloj la vería dentro hasta esa hora.
 *   3. NO PISA NADA: si marcó algo cerca del turno o tenía una jornada abierta, se niega y
 *      lo dice; eso se corrige en Horas, fichaje a fichaje.
 *   4. QUEDA ESCRITO: corrección con el motivo en la jornada, y la llamada en la auditoría.
 *   5. SE PUEDE DESHACER (`undoShiftCredit`): borra esos fichajes y su jornada, y el turno
 *      vuelve a ser lo que era —una falta, si no se marcó—.
 */

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

const TIPOS = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const;

/** El id de cada fichaje de un cumplido especial: fijo por turno, así no se duplica. */
function idDelFichaje(organizationId: string, shiftId: string, tipo: string): string {
  return `${organizationId}_especial_${shiftId}_${tipo}`;
}

/**
 * ¿MARCÓ ALGO DENTRO DE LAS HORAS DEL TURNO? Entonces vino, al menos un rato, y eso se corrige
 * en Horas, no se da por cumplido.
 *
 * SIN MARGEN, y no con la hora de `tieneMarcasCerca` de «Registrar como cumplido». Ese margen
 * rechazaba el caso más común: el turno partido. Quien trabajó de 10:00 a 17:10 y no vino al
 * cierre de 18:00 —miembro de mesa por la tarde— tenía una salida a 50 minutos del turno, y no
 * se podía dar por cumplido. Lo encontró el arnés de faltas con la falta sembrada de la demo,
 * que es exactamente eso.
 *
 * La salida de la jornada anterior justo a la hora de empezar —turnos pegados— no cuenta, ni la
 * entrada de la siguiente justo al acabar: son de otras jornadas.
 */
async function marcasDentroDelTurno(turno: Turno): Promise<boolean> {
  const dentro = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', turno.employee_id)
    .where('occurred_at', '>=', turno.starts_at)
    .where('occurred_at', '<=', turno.ends_at)
    .get();
  return dentro.docs.some((doc) => {
    const evento = doc.data();
    if (evento.occurred_at === turno.starts_at && evento.event_type === 'clock_out') return false;
    if (evento.occurred_at === turno.ends_at && evento.event_type === 'clock_in') return false;
    return true;
  });
}

async function turnoQueSeGestiona(uid: string, shiftId: string) {
  const doc = await db.collection(COLLECTIONS.shifts).doc(shiftId).get();
  const datos = doc.data();
  if (datos === undefined) throw new HttpsError('not-found', 'Ese turno ya no existe.');
  const turno = { ...(datos as Omit<Turno, 'id'>), id: doc.id } as Turno;
  const membership = await membershipOf(uid, turno.organization_id);
  requireRole(membership, ['owner', 'admin', 'manager']);
  requireManagesLocation(membership, turno.location_id);
  const sede = (await db.collection(COLLECTIONS.locations).doc(turno.location_id).get()).data();
  const zona = typeof sede?.timezone === 'string' ? sede.timezone : 'America/Lima';
  return { turno, zona };
}

export const creditShiftAsWorked = onCall(async (request) => {
  const uid = requireUid(request);
  const datos = (request.data ?? {}) as Record<string, unknown>;
  const shiftId = texto(datos.p_shift_id);
  if (shiftId === null) throw new HttpsError('invalid-argument', 'Falta el turno.');
  const { turno, zona } = await turnoQueSeGestiona(uid, shiftId);

  const motivo = datos.p_reason;
  if (!motivoDeCumplidoValido(motivo)) {
    throw new HttpsError('invalid-argument', 'Elige el motivo.', { motivo: 'MOTIVO' });
  }
  const nota = texto(datos.p_note);
  if (nota !== null && nota.length > NOTA_MAXIMA_DE_CUMPLIDO) {
    throw new HttpsError('invalid-argument', 'El comentario es demasiado largo.', {
      motivo: 'NOTA',
    });
  }
  if (cumplidoPideNota(motivo) && nota === null) {
    throw new HttpsError('invalid-argument', 'Escribe qué pasó.', { motivo: 'NOTA' });
  }

  if (turno.status !== 'published') {
    throw new HttpsError('failed-precondition', 'Ese turno no está publicado.', {
      motivo: 'SIN_PUBLICAR',
    });
  }
  if (Date.parse(turno.ends_at) > Date.now()) {
    throw new HttpsError('failed-precondition', 'Ese turno todavía no terminó.', {
      motivo: 'NO_TERMINO',
    });
  }
  // Antes que «ya tiene marcas»: las marcas que encontraría serían las de este mismo cumplido.
  const yaCumplido = await db
    .collection(COLLECTIONS.timeEvents)
    .doc(idDelFichaje(turno.organization_id, turno.id, 'clock_in'))
    .get();
  if (yaCumplido.exists) {
    throw new HttpsError('already-exists', 'Ese turno ya está dado por cumplido.', {
      motivo: 'YA_CUMPLIDO',
    });
  }
  if (await marcasDentroDelTurno(turno)) {
    throw new HttpsError(
      'failed-precondition',
      'Ese día ya tiene marcas: corrige sus horas en Horas.',
      { motivo: 'CON_MARCAS' },
    );
  }
  if ((await attendanceStateAt(turno.employee_id, turno.starts_at)) !== 'OFF_SHIFT') {
    throw new HttpsError(
      'failed-precondition',
      'Tenía una jornada abierta a esa hora: ciérrala primero en Horas.',
      { motivo: 'JORNADA_ABIERTA' },
    );
  }

  const refrigerio = refrigerioCentrado(
    turno.starts_at,
    turno.ends_at,
    turno.planned_unpaid_break_minutes,
  );
  const marcas: { tipo: TimeEventInput['eventType']; instante: string }[] = [
    { tipo: 'clock_in', instante: turno.starts_at },
    ...(refrigerio === null
      ? []
      : [
          { tipo: 'break_start' as const, instante: refrigerio.desde },
          { tipo: 'break_end' as const, instante: refrigerio.hasta },
        ]),
    { tipo: 'clock_out', instante: turno.ends_at },
  ];

  const primera = await reservarSecuencias(marcas.length);
  const lote = db.batch();
  marcas.forEach((marca, i) => {
    const id = idDelFichaje(turno.organization_id, turno.id, marca.tipo);
    lote.create(
      db.collection(COLLECTIONS.timeEvents).doc(id),
      filaDelEvento(
        {
          organizationId: turno.organization_id,
          employeeId: turno.employee_id,
          locationId: turno.location_id,
          shiftId: turno.id,
          eventType: marca.tipo,
          breakType: marca.tipo.startsWith('break') ? 'unpaid' : null,
          breakReason: marca.tipo === 'break_start' ? 'meal' : null,
          occurredAt: marca.instante,
          idempotencyKey: `especial_${turno.id}_${marca.tipo}`,
          // `import`, como lo registrado desde el horario: así Horas, Reportes y el celular
          // ya saben que nadie lo fichó. El motivo va en los metadatos y la jornada lo hereda.
          source: 'import',
          createdBy: uid,
          timezone: zona,
        },
        id,
        primera + i,
        { origen: 'especial', motivo_especial: motivo, nota_especial: nota },
      ),
    );
  });
  try {
    await lote.commit();
  } catch (error) {
    if ((error as { code?: unknown }).code === 6) {
      throw new HttpsError('already-exists', 'Ese turno ya está dado por cumplido.', {
        motivo: 'YA_CUMPLIDO',
      });
    }
    throw error;
  }

  await rebuildWorkSession(turno.organization_id, turno.employee_id, turno.location_id, {
    desde: turno.starts_at,
    hasta: turno.ends_at,
  });

  const sesionId = `${turno.employee_id}_${turno.starts_at}`;
  await db.collection(COLLECTIONS.timeAdjustments).add({
    organization_id: turno.organization_id,
    location_id: turno.location_id,
    employee_id: turno.employee_id,
    work_session_id: sesionId,
    target_type: 'work_session',
    target_id: sesionId,
    before_value: null,
    after_value: {
      starts_at: turno.starts_at,
      ends_at: turno.ends_at,
      origen: 'especial',
      motivo_especial: motivo,
    },
    reason: `Cumplido por motivo especial (${motivo})${nota === null ? '' : `: ${nota}`}`,
    created_by: uid,
    created_at: nowISO(),
    channel: 'manager_app',
  });

  // La falta de ese turno ya no existe: lo que se hubiera dicho de ella sobra.
  await db.collection(COLLECTIONS.absenceResolutions).doc(turno.id).delete();

  await audit({
    organizationId: turno.organization_id,
    actorUserId: uid,
    action: 'shift_credited_as_worked',
    entityType: 'shift',
    entityId: turno.id,
    after: {
      employee_id: turno.employee_id,
      work_date: diaLocal(turno.starts_at, zona),
      reason: motivo,
      note: nota,
      minutes: minutosNetos(turno),
    },
  });

  return { id: turno.id, minutos: minutosNetos(turno) };
});

export const undoShiftCredit = onCall(async (request) => {
  const uid = requireUid(request);
  const shiftId = texto((request.data as Record<string, unknown> | undefined)?.p_shift_id);
  if (shiftId === null) throw new HttpsError('invalid-argument', 'Falta el turno.');
  const { turno, zona } = await turnoQueSeGestiona(uid, shiftId);

  const refs = TIPOS.map((tipo) =>
    db.collection(COLLECTIONS.timeEvents).doc(idDelFichaje(turno.organization_id, turno.id, tipo)),
  );
  const existentes = (await Promise.all(refs.map((ref) => ref.get()))).filter((doc) => doc.exists);
  if (existentes.length === 0) {
    throw new HttpsError('not-found', 'Ese turno no está dado por cumplido.', {
      motivo: 'NO_CUMPLIDO',
    });
  }

  /*
   * LA JORNADA SE BORRA CON SUS FICHAJES. Reconstruirla no basta: sin fichajes,
   * `rebuildWorkSession` no tiene qué armar y deja la jornada vieja donde estaba, con sus
   * horas. Solo la que empieza en la entrada de este cumplido: es suya y de nadie más.
   */
  const entrada = existentes.find((doc) => doc.data()?.event_type === 'clock_in');
  const lote = db.batch();
  for (const doc of existentes) lote.delete(doc.ref);
  if (entrada !== undefined) {
    const sesion = db
      .collection(COLLECTIONS.workSessions)
      .doc(`${turno.employee_id}_${String(entrada.data()?.occurred_at)}`);
    if ((await sesion.get()).data()?.clock_in_event_id === entrada.id) lote.delete(sesion);
  }
  await lote.commit();

  await audit({
    organizationId: turno.organization_id,
    actorUserId: uid,
    action: 'shift_credit_undone',
    entityType: 'shift',
    entityId: turno.id,
    before: {
      employee_id: turno.employee_id,
      work_date: diaLocal(turno.starts_at, zona),
      reason: existentes[0]?.data()?.metadata?.motivo_especial ?? null,
    },
  });

  return { id: turno.id };
});
