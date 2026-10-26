import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { audit, managesLocation, membershipOf, requireRole, requireUid } from './shared/caller';
import { zonaSegura } from './shared/zonas';

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
 *
 * CON ÚLTIMO DÍA HOY, SIGUE ACTIVA HASTA MAÑANA (26-oct). Se dejaba inactiva al momento, y
 * el reloj rechazaba su PIN ese mismo día: no podía marcar la salida y su turno de hoy, que
 * sigue publicado, acababa como falta. La hoja lo prometía al revés —«desde el día
 * siguiente el reloj no le deja marcar»—. Ahora se guarda el día y la desactiva el cierre
 * de cada hora (`inactivarBajasVencidas`) en cuanto ese día pasa en su sede.
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

/** Las sedes de una persona, la principal primero. */
async function sedesDe(organizationId: string, employeeId: string): Promise<string[]> {
  const asignaciones = (
    await db
      .collection(COLLECTIONS.employeeLocations)
      .where('organization_id', '==', organizationId)
      .where('employee_id', '==', employeeId)
      .get()
  ).docs.map((doc) => doc.data());
  const ordenadas = [
    ...asignaciones.filter((a) => a.is_primary === true),
    ...asignaciones.filter((a) => a.is_primary !== true),
  ];
  return [...new Set(ordenadas.map((a) => String(a.location_id)))];
}

/**
 * «HOY» ES EL DE SU SEDE (26-oct), la principal: el reloj en el que marca está ahí. Sin
 * sede, el de la empresa, y sin él, Lima.
 */
async function zonaDe(organizationId: string, sedes: string[]): Promise<string> {
  const sede =
    sedes[0] === undefined
      ? undefined
      : (await db.collection(COLLECTIONS.locations).doc(sedes[0]).get()).data();
  if (typeof sede?.timezone === 'string' && sede.timezone !== '') {
    return zonaSegura(sede.timezone, 'dischargeEmployee');
  }
  const organizacion = (
    await db.collection(COLLECTIONS.organizations).doc(organizationId).get()
  ).data();
  return zonaSegura(organizacion?.default_timezone ?? 'America/Lima', 'dischargeEmployee');
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
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin', 'manager']);

  /*
   * QUE GESTIONE ALGUNA DE SUS SEDES (26-oct), como `setEmployeePin`. Solo se miraba el rol:
   * el encargado de una tienda podía dar de baja a alguien de otra y cancelarle los turnos.
   * Sin sede asignada, solo owner y admin.
   */
  const sedes = await sedesDe(organizationId, employeeId);
  if (sedes.length === 0) requireRole(membership, ['owner', 'admin']);
  else if (!sedes.some((id) => managesLocation(membership, id))) {
    throw new HttpsError('permission-denied', 'No administras ninguna de sus sedes.');
  }

  const zona = await zonaDe(organizationId, sedes);
  const hoy = diaEn(new Date(), zona);

  /*
   * Lo que marcó por última vez: la hoja lo propone como último día y es el mínimo que se
   * acepta. Su último fichaje —una salida pasada la medianoche es del día siguiente— o su
   * última jornada, lo que sea más tarde. El orden es el del índice que ya existe
   * (`employee_id`, `occurred_at` DESC, `seq` DESC): sin `seq` pediría otro.
   */
  const [ultimaJornada, ultimoFichaje] = await Promise.all([
    db
      .collection(COLLECTIONS.workSessions)
      .where('employee_id', '==', employeeId)
      .orderBy('starts_at', 'desc')
      .limit(1)
      .get(),
    db
      .collection(COLLECTIONS.timeEvents)
      .where('employee_id', '==', employeeId)
      .orderBy('occurred_at', 'desc')
      .orderBy('seq', 'desc')
      .limit(1)
      .get(),
  ]);
  const ultimoDiaMarcado =
    [ultimaJornada.docs[0]?.data().starts_at, ultimoFichaje.docs[0]?.data().occurred_at]
      .filter((marca): marca is string => typeof marca === 'string' && marca !== '')
      .map((marca) => diaEn(marca, zona))
      .sort()
      .at(-1) ?? null;

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
   * NI ANTES DE SU ÚLTIMA MARCA (26-oct). Un día anterior dejaba fichajes y jornadas de
   * alguien «que ya se había ido» y cancelaba turnos que sí trabajó. También en `dryRun`,
   * para que la hoja lo diga al elegir el día y no al confirmar.
   */
  if (conDia && ultimoDiaMarcado !== null && ultimoDia < ultimoDiaMarcado) {
    throw new HttpsError(
      'invalid-argument',
      `Marcó en el reloj el ${ultimoDiaMarcado}: su último día no puede ser anterior.`,
      { code: 'before_last_mark', motivo: 'ANTES_DE_SU_ULTIMA_MARCA', ultimoDiaMarcado },
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

  // Con último día hoy no se desactiva todavía: ver arriba.
  const sigueHoy = conDia && ultimoDia === hoy;
  const resumen = {
    nombre: String(empleado.full_name ?? ''),
    hoy,
    ultimoDiaMarcado,
    turnos: turnos.length,
    descansos: descansos.length,
    sigueHoy,
  };
  if (dryRun) return resumen;

  const ahora = nowISO();
  const estadoNuevo = sigueHoy ? String(empleado.status) : 'inactive';
  const lote = db.batch();
  lote.update(empleadoRef, {
    status: estadoNuevo,
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
      status: estadoNuevo,
      end_date: ultimoDia,
      cancelled_shift_ids: turnos.map((doc) => doc.id),
      removed_rest_day_ids: descansos.map((doc) => doc.id),
    },
  });

  return resumen;
});

/**
 * LA BAJA SE CUMPLE CUANDO PASA SU ÚLTIMO DÍA (26-oct). La llama cada hora el cierre de las
 * jornadas sin salida (`cierre-automatico.ts`), después de cerrarlas: quien tenga `end_date`
 * anterior a hoy en su sede y no esté ya inactiva pasa a inactiva, y desde ahí el reloj, Horario,
 * Equipo y su celular la tratan como a cualquier baja.
 *
 * Quien todavía tiene una jornada abierta espera: el turno de noche de su último día acaba
 * pasada la medianoche, y desactivarla antes le impediría marcar esa salida. La cierra ella
 * o el cierre automático, y a la hora siguiente queda de baja.
 *
 * Se consulta por `end_date` sola: un rango sobre un campo no pide índice compuesto, y las
 * bajas son pocas.
 */
export async function inactivarBajasVencidas(
  ahora: number = Date.now(),
): Promise<{ inactivadas: string[]; esperando: string[] }> {
  const conBaja = await db.collection(COLLECTIONS.employees).where('end_date', '>', '').get();
  const resumen = { inactivadas: [] as string[], esperando: [] as string[] };

  for (const doc of conBaja.docs) {
    const empleado = doc.data();
    if (empleado.status === 'inactive') continue;
    const organizationId = String(empleado.organization_id);
    const zona = await zonaDe(organizationId, await sedesDe(organizationId, doc.id));
    if (String(empleado.end_date) >= diaEn(new Date(ahora), zona)) continue;

    const abiertas = await db
      .collection(COLLECTIONS.workSessions)
      .where('employee_id', '==', doc.id)
      .where('status', '==', 'open')
      .get();
    if (!abiertas.empty) {
      resumen.esperando.push(doc.id);
      continue;
    }

    await doc.ref.update({ status: 'inactive', updated_at: nowISO(), updated_by: 'sistema' });
    resumen.inactivadas.push(doc.id);
    await audit({
      organizationId,
      actorUserId: null,
      action: 'employee_discharge_effective',
      entityType: 'employee',
      entityId: doc.id,
      before: { status: empleado.status, end_date: empleado.end_date },
      after: { status: 'inactive', end_date: empleado.end_date },
    });
  }
  if (resumen.inactivadas.length > 0 || resumen.esperando.length > 0) {
    logger.info('Bajas que se cumplen', {
      inactivadas: resumen.inactivadas.length,
      esperando: resumen.esperando.length,
    });
  }
  return resumen;
}
