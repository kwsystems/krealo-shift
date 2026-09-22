import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { attendanceStateAt, recordTimeEvent } from './shared/attendance';
import { auth, COLLECTIONS, db, nowISO } from './shared/admin';
import {
  audit,
  membershipOf,
  requireManagesLocation,
  requireRole,
  requireUid,
  soleMembership,
} from './shared/caller';
import { transition, type TimeEventType } from '../../src/domain/attendance-state-machine';

/**
 * Lo que la app llamaba con `db.rpc(...)`: las siete funciones del panel.
 *
 * CADA UNA COMPRUEBA EL ROL POR DENTRO, y eso no es defensa en profundidad sino la
 * unica defensa. En Postgres la migracion `001500_authorize_rpc.sql` existia por lo
 * mismo: conceder `execute` sobre una funcion `security definer` no era conceder
 * permiso para lo que la funcion hace. Aqui es literal — el Admin SDK no evalua
 * ninguna regla.
 */

const BCRYPT_ROUNDS = 10;

function textoRequerido(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new HttpsError('invalid-argument', `Falta «${campo}».`);
  }
  return valor.trim();
}

// ---------------------------------------------------------------------------
// PIN del empleado
// ---------------------------------------------------------------------------

/**
 * Fija el PIN de un empleado. El PIN EN CLARO NO SE GUARDA NI SE REGISTRA.
 *
 * Se guarda solo su hash bcrypt, en una coleccion que las reglas cierran a todo el
 * mundo: devolverlo —o dejar leer el hash— permitiria atacarlo sin limite de
 * intentos y sin dejar rastro, y seis digitos son un millon de combinaciones, cosa
 * de segundos en una maquina local. La auditoria anota QUE se cambio, nunca a que.
 */
export const setEmployeePin = onCall(async (request) => {
  const uid = requireUid(request);
  const employeeId = textoRequerido(request.data?.p_employee_id, 'p_employee_id');
  const pin = textoRequerido(request.data?.p_pin, 'p_pin');

  if (!/^\d{4,6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'El PIN debe tener entre 4 y 6 dígitos.');
  }

  const empleadoRef = db.collection(COLLECTIONS.employees).doc(employeeId);
  const empleado = (await empleadoRef.get()).data();
  if (empleado === undefined) throw new HttpsError('not-found', 'Ese empleado no existe.');

  const membership = await membershipOf(uid, empleado.organization_id as string);
  requireRole(membership, ['owner', 'admin', 'manager']);

  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(employeeId)
    .set(
      {
        employee_id: employeeId,
        organization_id: empleado.organization_id,
        pin_hash: bcrypt.hashSync(pin, BCRYPT_ROUNDS),
        pin_length: pin.length,
        /*
         * SUBE UNA CON CADA CAMBIO, y sobre un campo que no existia arranca en 1, que
         * es justo lo que el reloj exige. Es lo que permite a un fichaje guardado sin
         * conexion decir contra que version de PIN se valido: sin numero, un PIN
         * cambiado a media tarde no se distingue del viejo al sincronizar.
         */
        pin_version: FieldValue.increment(1),
        failed_attempts: 0,
        locked_until: null,
        rotated_at: nowISO(),
        updated_at: nowISO(),
      },
      { merge: true },
    );

  await audit({
    organizationId: empleado.organization_id as string,
    actorUserId: uid,
    action: 'employee_pin_set',
    entityType: 'employee',
    entityId: employeeId,
  });

  return null;
});

// ---------------------------------------------------------------------------
// Kioscos
// ---------------------------------------------------------------------------

/**
 * Codigo de activacion temporal. Se devuelve EN CLARO UNA SOLA VEZ y solo se guarda
 * su hash: si se pudiera volver a leer, un codigo filtrado del panel valdria para
 * activar un iPad ajeno en esa tienda.
 */
export const createKioskActivationCode = onCall(async (request) => {
  const uid = requireUid(request);
  const locationId = textoRequerido(request.data?.p_location_id, 'p_location_id');
  const validMinutes = Number(request.data?.p_valid_minutes ?? 15);

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  if (location === undefined) throw new HttpsError('not-found', 'Esa ubicación no existe.');

  const membership = await membershipOf(uid, location.organization_id as string);
  requireManagesLocation(membership, locationId);

  // Seis digitos, como pide la pantalla. `randomBytes` y no `Math.random()`: un
  // codigo adivinable es un iPad ajeno activado en la tienda.
  const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));

  await db.collection(COLLECTIONS.kioskActivationCodes).add({
    organization_id: location.organization_id,
    location_id: locationId,
    code_hash: bcrypt.hashSync(code, BCRYPT_ROUNDS),
    expires_at: new Date(Date.now() + validMinutes * 60000).toISOString(),
    max_uses: 1,
    used_count: 0,
    created_by: uid,
    created_at: nowISO(),
  });

  await audit({
    organizationId: location.organization_id as string,
    actorUserId: uid,
    action: 'kiosk_activation_code_created',
    entityType: 'location',
    entityId: locationId,
  });

  return code;
});

export const revokeKioskDevice = onCall(async (request) => {
  const uid = requireUid(request);
  const deviceId = textoRequerido(request.data?.p_device_id, 'p_device_id');

  const deviceRef = db.collection(COLLECTIONS.kioskDevices).doc(deviceId);
  const device = (await deviceRef.get()).data();
  if (device === undefined) throw new HttpsError('not-found', 'Ese reloj no existe.');

  const membership = await membershipOf(uid, device.organization_id as string);
  requireManagesLocation(membership, device.location_id as string);

  await deviceRef.update({ status: 'revoked', revoked_at: nowISO() });

  /**
   * EL SECRETO SE BORRA, no solo se marca el estado. Revocar tiene que servir para
   * un iPad perdido, y un hash que sigue ahi es un hash que sigue pudiendo
   * compararse si alguien cambia el estado de vuelta por error.
   */
  await db.collection(COLLECTIONS.kioskDeviceSecrets).doc(deviceId).delete();

  await audit({
    organizationId: device.organization_id as string,
    actorUserId: uid,
    action: 'kiosk_revoked',
    entityType: 'kiosk_device',
    entityId: deviceId,
  });

  return null;
});

// ---------------------------------------------------------------------------
// Correcciones de horas
// ---------------------------------------------------------------------------

/**
 * Corrige las horas de una sesion, con motivo obligatorio y bloqueo optimista.
 *
 * `p_expected_updated_at` NO ES OPCIONAL Y NO ES CEREMONIA: dos encargados mirando
 * la misma hoja de horas es el caso normal, y sin esta comprobacion el segundo en
 * guardar pisa en silencio la correccion del primero. Cuando no coincide se
 * devuelve `aborted`, que la pantalla traduce a «alguien más cambió el dato
 * primero».
 */
export const managerAdjustTime = onCall(async (request) => {
  const uid = requireUid(request);
  const workSessionId = textoRequerido(request.data?.p_work_session_id, 'p_work_session_id');
  const reason = textoRequerido(request.data?.p_reason, 'p_reason');
  const expectedUpdatedAt = request.data?.p_expected_updated_at as string | undefined;
  const newStartsAt = request.data?.p_new_starts_at as string | null | undefined;
  const newEndsAt = request.data?.p_new_ends_at as string | null | undefined;

  const sessionRef = db.collection(COLLECTIONS.workSessions).doc(workSessionId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(sessionRef);
    const sesion = snapshot.data();
    if (sesion === undefined) throw new HttpsError('not-found', 'Esa sesión no existe.');

    const membership = await membershipOf(uid, sesion.organization_id as string);
    requireManagesLocation(membership, sesion.location_id as string);

    if (expectedUpdatedAt !== undefined && sesion.updated_at !== expectedUpdatedAt) {
      throw new HttpsError('aborted', 'Alguien más cambió esta sesión mientras la editabas.');
    }

    const antes = {
      starts_at: sesion.starts_at,
      ends_at: sesion.ends_at,
      gross_minutes: sesion.gross_minutes,
      net_minutes: sesion.net_minutes,
    };

    const startsAt = newStartsAt ?? (sesion.starts_at as string);
    const endsAt = newEndsAt ?? (sesion.ends_at as string | null);
    if (endsAt !== null && new Date(endsAt) < new Date(startsAt)) {
      throw new HttpsError('invalid-argument', 'La salida no puede ser anterior a la entrada.');
    }

    // Truncar, no redondear: son minutos que se pagan.
    const brutos =
      endsAt === null
        ? null
        : Math.floor((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
    const noPagados = (sesion.unpaid_break_minutes as number | undefined) ?? 0;

    const despues = {
      starts_at: startsAt,
      ends_at: endsAt,
      gross_minutes: brutos,
      net_minutes: brutos === null ? null : brutos - noPagados,
    };

    tx.update(sessionRef, { ...despues, updated_at: nowISO(), recomputed_at: nowISO() });

    /**
     * EL AJUSTE ES UNA FILA NUEVA, nunca una edicion del evento original: el evento
     * crudo es la unica prueba de lo que paso, y una correccion que lo reescribe
     * borra la diferencia entre un error honesto y un fraude en una auditoria
     * laboral. El autor se guarda porque §11.4 exige poder mostrarlo.
     */
    tx.create(db.collection(COLLECTIONS.timeAdjustments).doc(), {
      organization_id: sesion.organization_id,
      work_session_id: workSessionId,
      target_type: 'work_session',
      target_id: workSessionId,
      before_value: antes,
      after_value: despues,
      reason,
      created_by: uid,
      created_at: nowISO(),
      channel: 'manager_app',
    });
  });

  const sesion = (await sessionRef.get()).data();
  await audit({
    organizationId: sesion?.organization_id as string,
    actorUserId: uid,
    action: 'work_session_adjusted',
    entityType: 'work_session',
    entityId: workSessionId,
  });

  return null;
});

/**
 * Fichaje que el gerente anade porque faltó (§11.4).
 *
 * CREA un evento nuevo marcado `source = 'manager'`; no edita ninguno existente.
 * Valida la transicion contra el estado del empleado EN EL INSTANTE del fichaje, no
 * en el actual, porque una correccion casi siempre se pone en el pasado: comprobar
 * contra «ahora» rechazaria una entrada de ayer por alguien que ya salio.
 */
export const managerAddTimeEvent = onCall(async (request) => {
  const uid = requireUid(request);
  const employeeId = textoRequerido(request.data?.p_employee_id, 'p_employee_id');
  const locationId = textoRequerido(request.data?.p_location_id, 'p_location_id');
  const eventType = textoRequerido(request.data?.p_event_type, 'p_event_type') as TimeEventType;
  const occurredAt = textoRequerido(request.data?.p_occurred_at, 'p_occurred_at');
  const reason = textoRequerido(request.data?.p_reason, 'p_reason');
  const idempotencyKey = (request.data?.p_idempotency_key as string | undefined) ?? randomUUID();

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  if (location === undefined) throw new HttpsError('not-found', 'Esa ubicación no existe.');

  const membership = await membershipOf(uid, location.organization_id as string);
  requireManagesLocation(membership, locationId);

  const estado = await attendanceStateAt(employeeId, occurredAt);
  const resultado = transition(estado, eventType);
  if (!resultado.allowed) {
    throw new HttpsError(
      'failed-precondition',
      `En ese momento la persona estaba en «${estado}»: no cabe un «${eventType}».`,
    );
  }

  const { eventId } = await recordTimeEvent({
    organizationId: location.organization_id as string,
    employeeId,
    locationId,
    eventType,
    breakType: (request.data?.p_break_type as string | null) ?? null,
    occurredAt,
    idempotencyKey,
    source: 'manager',
    createdBy: uid,
    timezone: (location.timezone as string | undefined) ?? 'America/Lima',
  });

  await db.collection(COLLECTIONS.timeAdjustments).add({
    organization_id: location.organization_id,
    work_session_id: null,
    target_type: 'time_event',
    target_id: eventId,
    before_value: null,
    after_value: { event_type: eventType, occurred_at: occurredAt },
    reason,
    created_by: uid,
    created_at: nowISO(),
    channel: 'manager_app',
  });

  await audit({
    organizationId: location.organization_id as string,
    actorUserId: uid,
    action: 'manager_added_time_event',
    entityType: 'time_event',
    entityId: eventId,
  });

  const abierta = await db
    .collection(COLLECTIONS.workSessions)
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'open')
    .limit(1)
    .get();

  return { eventId, workSessionId: abierta.docs[0]?.id ?? null };
});

// ---------------------------------------------------------------------------
// Periodos y exportacion
// ---------------------------------------------------------------------------

export const approveTimesheetPeriod = onCall(async (request) => {
  const uid = requireUid(request);
  const periodId = textoRequerido(request.data?.p_period_id, 'p_period_id');

  const periodRef = db.collection(COLLECTIONS.timesheetPeriods).doc(periodId);
  const periodo = (await periodRef.get()).data();
  if (periodo === undefined) throw new HttpsError('not-found', 'Ese período no existe.');

  const membership = await membershipOf(uid, periodo.organization_id as string);
  requireRole(membership, ['owner', 'admin', 'manager']);
  if (typeof periodo.location_id === 'string') {
    requireManagesLocation(membership, periodo.location_id);
  }

  await periodRef.update({
    status: 'approved',
    approved_by: uid,
    approved_at: nowISO(),
    updated_at: nowISO(),
  });

  await audit({
    organizationId: periodo.organization_id as string,
    actorUserId: uid,
    action: 'timesheet_period_approved',
    entityType: 'timesheet_period',
    entityId: periodId,
  });

  return null;
});

export const exportTimesheetRows = onCall(async (request) => {
  const uid = requireUid(request);
  const locationId = textoRequerido(request.data?.p_location_id, 'p_location_id');
  const desde = textoRequerido(request.data?.p_from, 'p_from');
  const hasta = textoRequerido(request.data?.p_to, 'p_to');

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  if (location === undefined) throw new HttpsError('not-found', 'Esa ubicación no existe.');
  const membership = await membershipOf(uid, location.organization_id as string);
  requireManagesLocation(membership, locationId);

  const sesiones = await db
    .collection(COLLECTIONS.workSessions)
    .where('location_id', '==', locationId)
    .where('starts_at', '>=', `${desde}T00:00:00.000Z`)
    .where('starts_at', '<=', `${hasta}T23:59:59.999Z`)
    .orderBy('starts_at', 'asc')
    .get();

  const nombres = new Map<string, string>();
  const filas = [];

  for (const doc of sesiones.docs) {
    const sesion = doc.data();
    const employeeId = sesion.employee_id as string;
    if (!nombres.has(employeeId)) {
      const empleado = await db.collection(COLLECTIONS.employees).doc(employeeId).get();
      nombres.set(employeeId, (empleado.data()?.full_name as string | undefined) ?? '');
    }
    filas.push({
      employee_id: employeeId,
      full_name: nombres.get(employeeId) ?? '',
      work_session_id: doc.id,
      starts_at: sesion.starts_at,
      ends_at: sesion.ends_at ?? null,
      gross_minutes: sesion.gross_minutes ?? 0,
      paid_break_minutes: sesion.paid_break_minutes ?? 0,
      unpaid_break_minutes: sesion.unpaid_break_minutes ?? 0,
      net_minutes: sesion.net_minutes ?? 0,
      status: sesion.status,
      flags: sesion.flags ?? [],
    });
  }

  return filas;
});

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

/**
 * Cierra la sesion en TODOS los dispositivos de quien llama (§8).
 *
 * NO ACEPTA UN IDENTIFICADOR DE USUARIO, y esa ausencia es la medida de seguridad:
 * toma el `uid` del token ya verificado. Con un parametro, cualquiera con una cuenta
 * podria cerrar la sesion de otra persona — y en Firebase eso ademas obliga a la
 * victima a volver a entrar en todos sus aparatos.
 *
 * Los demas dispositivos caen a la pantalla de acceso cuando toca refrescar el
 * token, que con Firebase es dentro de la hora siguiente. No es instantaneo y
 * conviene no prometer que lo sea.
 */
export const revokeAllSessions = onCall(async (request) => {
  const uid = requireUid(request);
  await auth.revokeRefreshTokens(uid);

  const membership = await soleMembership(uid).catch(() => null);
  if (membership !== null) {
    await audit({
      organizationId: membership.organizationId,
      actorUserId: uid,
      action: 'sessions_revoked_everywhere',
      entityType: 'user',
      entityId: uid,
    });
  }

  return { ok: true };
});

// ---------------------------------------------------------------------------
// Mantenimiento de la membresia
// ---------------------------------------------------------------------------

/**
 * Mantiene `managed_location_ids` al dia cuando cambian las asignaciones.
 *
 * ESTE CAMPO ES LO QUE HACE QUE LAS REGLAS CUESTEN UNA LECTURA Y NO TRES. Una regla
 * de Firestore no puede consultar: para saber si alguien administra una ubicacion
 * habria que encadenar membresia -> empleado -> asignaciones, y `get()` se paga
 * cada vez. Denormalizarlo aqui es el precio, y el precio de denormalizar es
 * exactamente esta funcion: si deja de correr, el campo miente y alguien pierde
 * acceso a su tienda o lo gana sobre otra.
 */
export const syncManagedLocations = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = textoRequerido(request.data?.organizationId, 'organizationId');
  const targetUserId = textoRequerido(request.data?.userId, 'userId');

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  const objetivo = await db
    .collection(COLLECTIONS.memberships)
    .doc(`${organizationId}_${targetUserId}`)
    .get();
  if (!objetivo.exists) throw new HttpsError('not-found', 'Esa membresía no existe.');

  const employeeId = objetivo.data()?.employee_id as string | undefined;
  const asignaciones =
    employeeId === undefined
      ? []
      : (
          await db
            .collection(COLLECTIONS.employeeLocations)
            .where('employee_id', '==', employeeId)
            .where('can_manage', '==', true)
            .get()
        ).docs.map((doc) => doc.data().location_id as string);

  await objetivo.ref.update({ managed_location_ids: asignaciones, updated_at: nowISO() });

  return { managedLocationIds: asignaciones };
});
