import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import {
  attendanceStateAt,
  filaDelEvento,
  rebuildJornadaDe,
  reservarSecuencias,
} from './shared/attendance';
import {
  audit,
  membershipOf,
  requireManagesLocation,
  requireRole,
  requireUid,
} from './shared/caller';
import { exigirQueSeaDeLaSede } from './shared/persona-de-la-sede';
import { noEnElFuturo } from './shared/salida-a-mano';
import { refrigerioCentrado } from './horario-cumplido';

/**
 * «VINO Y NO MARCÓ»: SU ENTRADA Y SU SALIDA, JUNTAS (4-oct).
 *
 * Eran dos fichajes manuales seguidos desde la pantalla. Si el segundo fallaba —la red, o
 * hasta el 4-oct una respuesta que la app no sabía leer—, quedaba la entrada sola: la
 * persona «dentro» desde ese día, el reloj ofreciéndole «Marcar salida» al llegar, y al
 * reintentar el servidor rechazaba la entrada porque ya estaba. No había forma de
 * terminarlo desde la pantalla.
 *
 * Ahora es una sola escritura, con ids fijos por turno: repetirla no duplica nada y lo que
 * ya quedó escrito cuenta como hecho.
 *
 * Y CON SU REFRIGERIO (13-oct). Quien no marcó en todo el día tampoco marcó su refrigerio, y
 * sin él la jornada contaba las 9 h de 10:00 a 19:00: «Por resolver» preguntaba «sin
 * refrigerio» y «trabajó 1 h más que su turno», dos casos por una hora que no existía.
 * Andree: «su hora de almuerzo es repetitiva, que te la cuente». Llega `p_break_minutes`
 * —el de su turno, que la hoja trae puesto y se puede cambiar; 0 si trabajó de corrido— y
 * se registra en el centro de la jornada, como «Registrar como cumplido» y «Descontar
 * refrigerio». Sin él (una app de antes) no se pone ninguno, como hasta ahora.
 */
type TipoDeMarca = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
const idDelFichaje = (organizationId: string, shiftId: string, tipo: TipoDeMarca) =>
  `${organizationId}_vino_${shiftId}_${tipo}`;

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;

export const registerMissedAttendance = onCall(async (request) => {
  const uid = requireUid(request);
  const datos = (request.data ?? {}) as Record<string, unknown>;
  const shiftId = texto(datos.p_shift_id);
  const entrada = texto(datos.p_starts_at);
  const salida = texto(datos.p_ends_at);
  const motivo = texto(datos.p_reason);
  if (shiftId === null || entrada === null || salida === null) {
    throw new HttpsError('invalid-argument', 'Faltan el turno, la entrada o la salida.');
  }
  if (motivo === null) throw new HttpsError('invalid-argument', 'Escribe el motivo.');
  noEnElFuturo(entrada, 'entrada');
  noEnElFuturo(salida, 'salida');
  if (Date.parse(salida) <= Date.parse(entrada)) {
    throw new HttpsError('invalid-argument', 'La salida tiene que ser después de la entrada.');
  }
  const refrigerio = datos.p_break_minutes ?? 0;
  if (typeof refrigerio !== 'number' || !Number.isInteger(refrigerio) || refrigerio < 0) {
    throw new HttpsError('invalid-argument', 'El refrigerio no se entiende.', {
      motivo: 'REFRIGERIO',
    });
  }
  const pausa = refrigerio === 0 ? null : refrigerioCentrado(entrada, salida, refrigerio);
  if (refrigerio > 0 && pausa === null) {
    throw new HttpsError('invalid-argument', 'El refrigerio no cabe entre esa entrada y salida.', {
      motivo: 'CORTA',
    });
  }
  const marcas: { tipo: TipoDeMarca; instante: string }[] = [
    { tipo: 'clock_in', instante: entrada },
    ...(pausa === null
      ? []
      : [
          { tipo: 'break_start' as const, instante: pausa.desde },
          { tipo: 'break_end' as const, instante: pausa.hasta },
        ]),
    { tipo: 'clock_out', instante: salida },
  ];

  const turno = (await db.collection(COLLECTIONS.shifts).doc(shiftId).get()).data();
  if (turno === undefined) throw new HttpsError('not-found', 'Ese turno ya no existe.');
  const organizationId = String(turno.organization_id);
  const locationId = String(turno.location_id);
  const employeeId = String(turno.employee_id);
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin', 'manager']);
  requireManagesLocation(membership, locationId);
  await exigirQueSeaDeLaSede(employeeId, organizationId, locationId);

  const ids = marcas.map((marca) => idDelFichaje(organizationId, shiftId, marca.tipo));
  // Repetirlo es no hacer nada: lo de antes ya quedó escrito.
  const yaEstaba = await db
    .collection(COLLECTIONS.timeEvents)
    .doc(ids[0] as string)
    .get();
  if (yaEstaba.exists) return { eventIds: ids, repetido: true };

  if ((await attendanceStateAt(employeeId, entrada)) !== 'OFF_SHIFT') {
    throw new HttpsError(
      'failed-precondition',
      'A esa hora ya estaba dentro: revisa su jornada en Horas.',
      { motivo: 'DENTRO' },
    );
  }
  const entreMedias = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', employeeId)
    .where('occurred_at', '>', entrada)
    .where('occurred_at', '<=', salida)
    .limit(1)
    .get();
  if (!entreMedias.empty) {
    throw new HttpsError(
      'failed-precondition',
      'Entre esa entrada y esa salida ya hay marcas: corrígelas en Horas.',
      { motivo: 'CON_MARCAS' },
    );
  }

  const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const zona = typeof sede?.timezone === 'string' ? sede.timezone : 'America/Lima';
  const primera = await reservarSecuencias(marcas.length);
  const lote = db.batch();
  marcas.forEach(({ tipo, instante }, i) => {
    const id = ids[i] as string;
    lote.create(
      db.collection(COLLECTIONS.timeEvents).doc(id),
      filaDelEvento(
        {
          organizationId,
          employeeId,
          locationId,
          shiftId,
          eventType: tipo,
          ...(tipo === 'break_start' || tipo === 'break_end'
            ? { breakType: 'unpaid' as const, breakReason: tipo === 'break_start' ? 'meal' : null }
            : {}),
          occurredAt: instante,
          idempotencyKey: `vino_${shiftId}_${tipo}`,
          source: 'manager',
          createdBy: uid,
          timezone: zona,
        },
        id,
        primera + i,
        { origen: 'vino_y_no_marco' },
      ),
    );
    // Y su corrección, como cualquier fichaje añadido a mano: la cuenta Reportes.
    lote.create(db.collection(COLLECTIONS.timeAdjustments).doc(), {
      organization_id: organizationId,
      location_id: locationId,
      employee_id: employeeId,
      work_session_id: null,
      target_type: 'time_event',
      target_id: id,
      before_value: null,
      after_value: { event_type: tipo, occurred_at: instante },
      reason: motivo,
      created_by: uid,
      created_at: nowISO(),
      channel: 'manager_app',
    });
  });
  try {
    await lote.commit();
  } catch (error) {
    // Otra petición igual llegó primero: está hecho.
    if ((error as { code?: unknown }).code === 6) return { eventIds: ids, repetido: true };
    throw error;
  }

  await rebuildJornadaDe(organizationId, employeeId, locationId, entrada);
  await audit({
    organizationId,
    actorUserId: uid,
    action: 'missed_attendance_registered',
    entityType: 'shift',
    entityId: shiftId,
    after: { event_ids: ids, starts_at: entrada, ends_at: salida, break_minutes: refrigerio },
  });
  return { eventIds: ids, repetido: false };
});
