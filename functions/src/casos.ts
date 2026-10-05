import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { filaDelEvento, rebuildJornadaDe, reservarSecuencias } from './shared/attendance';
import { audit, membershipOf, requireManagesLocation, requireUid } from './shared/caller';
import { zonaSegura } from './shared/zonas';
import { refrigerioCentrado } from './horario-cumplido';

/**
 * LOS CASOS DE HORAS QUE HAY QUE RESOLVER, a un toque (Andree, 1-oct).
 *
 * Una vendedora se enfermó y se fue a media mañana: «lo que debería salir acá es que yo
 * vea que ella me debe horas… y a ella debería aparecerle en su apartado». Otra no marcó
 * su refrigerio y Horas le contaba la hora de comer como trabajada. «Debería haber algo
 * donde se vean todos estos casos y yo poder arreglarlos rápidamente.»
 *
 * Horas los detecta (`src/features/timesheets/casos.ts`) y aquí se resuelven:
 *
 *   - TRABAJÓ MENOS QUE SU TURNO —salió antes o llegó tarde—: «le debe N h», que queda en
 *     `owed_hours` y la persona ve en su celular, o «está justificado».
 *   - NO MARCÓ EL REFRIGERIO: se descuenta el del turno, con dos fichajes de pausa a nombre
 *     de quien gestiona; o «trabajó sin refrigerio», y no se toca nada.
 *
 * Lo resuelto se apunta en la jornada (`casos_resueltos`), por caso. Reconstruir la jornada
 * no lo borra: `rebuildWorkSession` escribe con `merge`.
 *
 * TODO VA POR EL SERVIDOR: las reglas no dejan escribir jornadas, fichajes ni horas debidas
 * desde la app, porque son horas que se pagan o se cobran.
 */

// `salida_automatica` (5-oct): la jornada que se cerró sola; «la salida está bien».
const CASOS = ['faltan_horas', 'sin_refrigerio', 'salida_automatica'] as const;
type Caso = (typeof CASOS)[number];

const DECISIONES: Record<Caso, readonly string[]> = {
  faltan_horas: ['owes', 'justified'],
  sin_refrigerio: ['worked_through'],
  salida_automatica: ['confirmed'],
};

/** Más de una jornada entera no puede deberse por un solo día. */
const MINUTOS_MAXIMOS_DEBIDOS = 16 * 60;

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new HttpsError('invalid-argument', `Falta «${campo}».`);
  }
  return valor.trim();
}

function diaEn(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

async function jornadaGestionable(uid: string, sessionId: string) {
  const ref = db.collection(COLLECTIONS.workSessions).doc(sessionId);
  const sesion = (await ref.get()).data();
  if (sesion === undefined) throw new HttpsError('not-found', 'Esa jornada no existe.');
  const organizationId = String(sesion.organization_id);
  const locationId = String(sesion.location_id);
  requireManagesLocation(await membershipOf(uid, organizationId), locationId);
  return { ref, sesion, organizationId, locationId };
}

/**
 * Resolver un caso de una jornada: «le debe N h», «está justificado» o «trabajó sin
 * refrigerio».
 */
export const resolveSessionCase = onCall(async (request) => {
  const uid = requireUid(request);
  const sessionId = texto(request.data?.p_work_session_id, 'p_work_session_id');
  const caso = texto(request.data?.p_case, 'p_case') as Caso;
  const decision = texto(request.data?.p_decision, 'p_decision');
  if (!CASOS.includes(caso)) throw new HttpsError('invalid-argument', 'Ese caso no existe.');
  if (!DECISIONES[caso].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Esa decisión no vale para ese caso.');
  }
  const nota =
    typeof request.data?.p_note === 'string' && request.data.p_note.trim() !== ''
      ? String(request.data.p_note).trim().slice(0, 300)
      : null;

  const { ref, sesion, organizationId, locationId } = await jornadaGestionable(uid, sessionId);
  if (sesion.ends_at === null || sesion.ends_at === undefined) {
    throw new HttpsError(
      'failed-precondition',
      'La jornada sigue abierta: primero tiene que tener su salida.',
      { motivo: 'ABIERTA' },
    );
  }

  const ahora = nowISO();
  const lote = db.batch();
  let minutos: number | null = null;

  if (decision === 'owes') {
    minutos = Number(request.data?.p_minutes);
    if (!Number.isInteger(minutos) || minutos < 1 || minutos > MINUTOS_MAXIMOS_DEBIDOS) {
      throw new HttpsError(
        'invalid-argument',
        'Las horas que debe tienen que estar entre 1 min y 16 h.',
        {
          motivo: 'MINUTOS',
        },
      );
    }
    const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
    const zona = zonaSegura(sede?.timezone, 'resolveSessionCase');
    // Una por jornada: volver a registrarla la corrige, no suma otra.
    lote.set(db.collection(COLLECTIONS.owedHours).doc(sessionId), {
      id: sessionId,
      organization_id: organizationId,
      location_id: locationId,
      employee_id: sesion.employee_id,
      work_session_id: sessionId,
      work_date: diaEn(String(sesion.starts_at), zona),
      minutes: minutos,
      note: nota,
      status: 'pending',
      created_by: uid,
      created_at: ahora,
      updated_at: ahora,
    });
  }

  lote.update(ref, {
    casos_resueltos: FieldValue.arrayUnion(caso),
    [`casos_decision.${caso}`]: { decision, por: uid, at: ahora, nota },
    updated_at: ahora,
  });
  await lote.commit();

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'session_case_resolved',
    entityType: 'work_session',
    entityId: sessionId,
    after: { caso, decision, minutos },
  });
  return { caso, decision, minutos };
});

/**
 * «Descontar el refrigerio del turno»: quien no marcó su refrigerio tiene la jornada entera
 * como trabajada. Se añaden la salida y la vuelta de la pausa —la del turno, en el centro
 * de la jornada, como al registrar el horario como cumplido— a nombre de quien gestiona, y
 * la jornada se vuelve a calcular. Los fichajes de la persona no se tocan.
 */
export const applyPlannedBreak = onCall(async (request) => {
  const uid = requireUid(request);
  const sessionId = texto(request.data?.p_work_session_id, 'p_work_session_id');
  const { sesion, organizationId, locationId } = await jornadaGestionable(uid, sessionId);

  const desde = String(sesion.starts_at);
  const hasta =
    sesion.ends_at === null || sesion.ends_at === undefined ? null : String(sesion.ends_at);
  if (hasta === null) {
    throw new HttpsError('failed-precondition', 'La jornada sigue abierta.', { motivo: 'ABIERTA' });
  }
  if (Number(sesion.paid_break_minutes ?? 0) + Number(sesion.unpaid_break_minutes ?? 0) > 0) {
    throw new HttpsError('failed-precondition', 'Esa jornada ya tiene una pausa marcada.', {
      motivo: 'YA_TIENE_PAUSA',
    });
  }
  const turno =
    typeof sesion.shift_id === 'string'
      ? (await db.collection(COLLECTIONS.shifts).doc(sesion.shift_id).get()).data()
      : undefined;
  const minutos = Number(turno?.planned_unpaid_break_minutes ?? 0);
  if (turno === undefined || minutos <= 0) {
    throw new HttpsError('failed-precondition', 'Su turno no tiene refrigerio que descontar.', {
      motivo: 'SIN_REFRIGERIO',
    });
  }
  /*
   * NI SOBRE UNA HORA CORREGIDA EN HORAS: esa corrección vive en la jornada y no en los
   * fichajes (`managerAdjustTime`), así que volver a calcular la jornada la borraría.
   */
  const ajustes = await db
    .collection(COLLECTIONS.timeAdjustments)
    .where('work_session_id', '==', sessionId)
    .get();
  // Solo cuenta la hora corregida EN LA JORNADA; un fichaje añadido o lo registrado desde
  // el horario son fichajes, y volver a calcular los respeta.
  const corregida = ajustes.docs.some((doc) => {
    const fila = doc.data();
    const despues = (fila.after_value ?? {}) as Record<string, unknown>;
    return fila.target_type === 'work_session' && despues.origen !== 'horario';
  });
  if (corregida) {
    throw new HttpsError(
      'failed-precondition',
      'Esta jornada tiene una hora corregida a mano: añade la pausa con «Agregar fichaje manual».',
      { motivo: 'AJUSTADA' },
    );
  }

  const pausa = refrigerioCentrado(desde, hasta, minutos);
  if (pausa === null) {
    throw new HttpsError('failed-precondition', 'La jornada es más corta que su refrigerio.', {
      motivo: 'CORTA',
    });
  }

  const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const zona = zonaSegura(sede?.timezone, 'applyPlannedBreak');
  const marcas = [
    { tipo: 'break_start' as const, instante: pausa.desde },
    { tipo: 'break_end' as const, instante: pausa.hasta },
  ];
  const primera = await reservarSecuencias(marcas.length);
  const lote = db.batch();
  const ahora = nowISO();
  const motivo = 'No marcó su refrigerio: se descuenta el de su turno.';
  marcas.forEach((marca, i) => {
    const clave = `refrigerio_${sessionId}_${marca.tipo}`;
    const id = `${organizationId}_${clave}`;
    lote.create(
      db.collection(COLLECTIONS.timeEvents).doc(id),
      filaDelEvento(
        {
          organizationId,
          employeeId: String(sesion.employee_id),
          locationId,
          shiftId: String(sesion.shift_id),
          eventType: marca.tipo,
          breakType: 'unpaid',
          breakReason: marca.tipo === 'break_start' ? 'meal' : null,
          occurredAt: marca.instante,
          idempotencyKey: clave,
          source: 'manager',
          createdBy: uid,
          timezone: zona,
        },
        id,
        primera + i,
        { origen: 'refrigerio_del_turno', work_session_id: sessionId },
      ),
    );
    lote.set(db.collection(COLLECTIONS.timeAdjustments).doc(`ajuste_${id}`), {
      organization_id: organizationId,
      location_id: locationId,
      employee_id: sesion.employee_id,
      work_session_id: null,
      target_type: 'time_event',
      target_id: id,
      before_value: null,
      after_value: { event_type: marca.tipo, occurred_at: marca.instante },
      reason: motivo,
      created_by: uid,
      created_at: ahora,
      channel: 'manager_app',
    });
  });
  try {
    // Las dos o ninguna: una pausa sin vuelta dejaría a la persona «en descanso» para siempre.
    await lote.commit();
  } catch (error) {
    // ALREADY_EXISTS: otra pulsación llegó antes y la pausa ya está.
    if ((error as { code?: unknown }).code !== 6) throw error;
  }

  await rebuildJornadaDe(organizationId, String(sesion.employee_id), locationId, desde);
  await audit({
    organizationId,
    actorUserId: uid,
    action: 'planned_break_applied',
    entityType: 'work_session',
    entityId: sessionId,
    after: { desde: pausa.desde, hasta: pausa.hasta, minutos },
  });
  return { desde: pausa.desde, hasta: pausa.hasta, minutos };
});

/** Las horas que debía, compensadas o perdonadas; o de vuelta a pendientes. */
export const settleOwedHours = onCall(async (request) => {
  const uid = requireUid(request);
  const id = texto(request.data?.p_owed_id, 'p_owed_id');
  const estado = texto(request.data?.p_status, 'p_status');
  if (!['pending', 'compensated', 'forgiven'].includes(estado)) {
    throw new HttpsError('invalid-argument', 'Ese estado no existe.');
  }
  const ref = db.collection(COLLECTIONS.owedHours).doc(id);
  const fila = (await ref.get()).data();
  if (fila === undefined) throw new HttpsError('not-found', 'Esas horas no existen.');
  requireManagesLocation(
    await membershipOf(uid, String(fila.organization_id)),
    String(fila.location_id),
  );
  await ref.update({
    status: estado,
    settled_by: estado === 'pending' ? null : uid,
    settled_at: estado === 'pending' ? null : nowISO(),
    updated_at: nowISO(),
  });
  await audit({
    organizationId: String(fila.organization_id),
    actorUserId: uid,
    action: 'owed_hours_settled',
    entityType: 'owed_hours',
    entityId: id,
    after: { status: estado },
  });
  return { status: estado };
});
