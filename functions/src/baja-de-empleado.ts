import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { audit, membershipOf, requireRole, requireUid } from './shared/caller';

/**
 * DAR DE BAJA A QUIEN DEJÓ DE TRABAJAR, CON SU ÚLTIMO DÍA (4-oct).
 *
 * POR QUÉ EXISTE. Andree: «su último día fue miércoles 30 de setiembre, ya no está en
 * octubre, ¿cómo hacemos ahí? Que haya un botón para decir que ya no trabaja. No quiero que
 * se borren sus datos, es importante». Había «Desactivar», pero hacía menos de lo que hace
 * falta y una cosa de más:
 *
 *   - NO SABÍA DESDE CUÁNDO. Desactivar era «desde ahora», y los turnos que la persona ya
 *     tenía puestos después de irse seguían publicados: salían como FALTAS en Horario, Horas,
 *     Inicio y el bono de octubre, de alguien que ya no trabajaba ahí.
 *   - LA SACABA DEL BONO DE LOS MESES QUE SÍ TRABAJÓ: el cálculo se saltaba a todo el que no
 *     estuviera activo. Eso se arregla en `src/features/reports/bono.ts`.
 *
 * QUÉ HACE: guarda el último día (`end_date`) y la deja inactiva; CANCELA sus turnos de
 * DESPUÉS de ese día —no los borra: quedan en la base como cancelados— y quita sus días
 * libres marcados después de ese día, que si no seguirían pintando su fila en semanas que ya
 * no son suyas. Lo de ANTES no se toca: fichajes, jornadas, turnos, faltas, solicitudes,
 * correcciones. El reloj y su celular ya la tratan como inactiva (ver `verifyPin` y
 * `fetchMiFicha`).
 *
 * `dryRun` cuenta sin escribir: la hoja enseña cuántos turnos se van a quitar antes de
 * confirmar, y desde cuándo marcó por última vez, para no tener que adivinar el día.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El día (AAAA-MM-DD) de un instante en una zona. */
function diaEn(instante: string | Date, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof instante === 'string' ? new Date(instante) : instante);
}

export const dischargeEmployee = onCall(async (request) => {
  const uid = requireUid(request);
  const employeeId = request.data?.employeeId;
  const ultimoDia = request.data?.lastDay;
  const dryRun = request.data?.dryRun === true;
  if (typeof employeeId !== 'string' || employeeId === '') {
    throw new HttpsError('invalid-argument', 'Falta el empleado.');
  }

  const empleadoRef = db.collection(COLLECTIONS.employees).doc(employeeId);
  const empleado = (await empleadoRef.get()).data();
  if (empleado === undefined) throw new HttpsError('not-found', 'Ese empleado no existe.');
  const organizationId = empleado.organization_id as string;
  requireRole(await membershipOf(uid, organizationId), ['owner', 'admin', 'manager']);

  const organizacion = (
    await db.collection(COLLECTIONS.organizations).doc(organizationId).get()
  ).data();
  const zona = (organizacion?.default_timezone as string | undefined) ?? 'America/Lima';
  const hoy = diaEn(new Date(), zona);

  // Lo que marcó por última vez: la hoja lo propone como último día.
  const ultimaJornada = await db
    .collection(COLLECTIONS.workSessions)
    .where('employee_id', '==', employeeId)
    .orderBy('starts_at', 'desc')
    .limit(1)
    .get();
  const ultimaMarca = ultimaJornada.docs[0]?.data().starts_at as string | undefined;
  const ultimoDiaMarcado = ultimaMarca === undefined ? null : diaEn(ultimaMarca, zona);

  /*
   * Sin día —la hoja se abre y todavía no se eligió—, solo se responde lo que hace falta para
   * proponerlo: hoy y el último día que marcó. Sin día y sin `dryRun` no se da de baja a nadie.
   */
  const conDia = typeof ultimoDia === 'string' && FECHA.test(ultimoDia);
  if (!conDia && !dryRun) {
    throw new HttpsError('invalid-argument', 'Falta el último día de trabajo.');
  }
  if (conDia && ultimoDia > hoy) {
    throw new HttpsError(
      'invalid-argument',
      'El último día no puede ser futuro: dalo de baja ese día o después.',
      { code: 'future_last_day' },
    );
  }

  /*
   * SUS TURNOS DE DESPUÉS. Se consulta desde la víspera en UTC y se decide con el día de la
   * tienda: un turno del 1-oct a las 20:00 de Lima ya es 2-oct en UTC, y uno del 30-sep a
   * las 21:00 también. Con la cadena ISO cortada se cancelaría el último turno que SÍ hizo.
   */
  const turnos = !conDia
    ? []
    : (
        await db
          .collection(COLLECTIONS.shifts)
          .where('organization_id', '==', organizationId)
          .where('employee_id', '==', employeeId)
          .where('status', 'in', ['draft', 'published'])
          .where(
            'starts_at',
            '>=',
            new Date(Date.parse(`${ultimoDia}T00:00:00Z`) - 24 * 3600_000).toISOString(),
          )
          .get()
      ).docs.filter(
        (doc) =>
          diaEn(String(doc.data().starts_at), (doc.data().timezone as string | undefined) ?? zona) >
          ultimoDia,
      );

  const descansos = !conDia
    ? []
    : (
        await db
          .collection(COLLECTIONS.restDays)
          .where('organization_id', '==', organizationId)
          .where('employee_id', '==', employeeId)
          .get()
      ).docs.filter((doc) => String(doc.data().date_key) > ultimoDia);

  const resumen = {
    nombre: String(empleado.full_name ?? ''),
    hoy,
    ultimoDiaMarcado,
    turnos: turnos.length,
    descansos: descansos.length,
  };
  if (dryRun) return resumen;

  const ahora = nowISO();
  const lote = db.batch();
  lote.update(empleadoRef, {
    status: 'inactive',
    end_date: ultimoDia,
    updated_at: ahora,
    updated_by: uid,
  });
  for (const doc of turnos) {
    lote.update(doc.ref, { status: 'cancelled', updated_by: uid, updated_at: ahora });
  }
  for (const doc of descansos) lote.delete(doc.ref);
  await lote.commit();

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'employee_discharged',
    entityType: 'employee',
    entityId: employeeId,
    before: { status: empleado.status, end_date: empleado.end_date ?? null },
    after: {
      status: 'inactive',
      end_date: ultimoDia,
      cancelled_shift_ids: turnos.map((doc) => doc.id),
      removed_rest_day_ids: descansos.map((doc) => doc.id),
    },
  });

  return resumen;
});
