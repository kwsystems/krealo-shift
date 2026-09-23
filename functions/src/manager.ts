import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { attendanceStateAt, recordTimeEvent } from './shared/attendance';
import { auth, COLLECTIONS, db, nowISO } from './shared/admin';
import {
  audit,
  managesLocation,
  membershipOf,
  requireManagesLocation,
  requireRole,
  requireUid,
  soleMembership,
} from './shared/caller';
import { transition, type TimeEventType } from '../../src/domain/attendance-state-machine';
import { generatePin } from '../../src/domain/pin';
import { estaReclasificado, tipoEfectivo } from './shared/eventos';
import { politicasDe, POLITICAS_POR_DEFECTO } from './shared/politicas';
import { DEFAULT_PAID_REASONS } from '../../src/domain/break-reason';

/** El mismo valor de fabrica que `DEFAULT_LOCATION_SETTINGS.minimumRestMinutes`: once horas. */
const DESCANSO_MINIMO_POR_DEFECTO = 660;

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
/**
 * Las sedes de un empleado y la longitud de PIN que exigen sus teclados.
 *
 * Si trabaja en dos sedes con longitudes distintas no hay PIN posible —el teclado
 * envia al llegar a SU longitud, asi que uno de los dos relojes nunca lo aceptaria—,
 * y eso se dice en voz alta en vez de generar algo que va a fallar en una tienda.
 */
async function sedesYLongitud(
  organizationId: string,
  employeeId: string,
): Promise<{ sedes: string[]; longitud: number }> {
  const asignaciones = await db
    .collection(COLLECTIONS.employeeLocations)
    .where('organization_id', '==', organizationId)
    .where('employee_id', '==', employeeId)
    .get();

  const sedes = [...new Set(asignaciones.docs.map((doc) => String(doc.data().location_id)))];
  // Sin sede todavia no hay teclado que contentar: vale el valor de fabrica y ya se
  // recalculara cuando se le asigne una. Dar error aqui bloquearia el alta de alguien
  // a quien se le pone el PIN antes que la tienda.
  if (sedes.length === 0) return { sedes, longitud: POLITICAS_POR_DEFECTO.pinLength };

  const docs = await db.getAll(...sedes.map((id) => db.collection(COLLECTIONS.locations).doc(id)));
  const longitudes = [...new Set(docs.map((doc) => politicasDe(doc.data() ?? {}).pinLength))];
  if (longitudes.length > 1) {
    throw new HttpsError(
      'failed-precondition',
      `Sus sedes piden PIN de distinta longitud (${longitudes.join(' y ')} dígitos). ` +
        'Igualalas antes de darle un PIN.',
    );
  }
  return { sedes, longitud: longitudes[0] ?? POLITICAS_POR_DEFECTO.pinLength };
}

/**
 * ¿Hay ya alguien en esas sedes con este PIN?
 *
 * HACE FALTA PORQUE EL RELOJ NO PREGUNTA QUIEN ERES. `verifyPin` prueba el PIN tecleado
 * contra todos los de la sede y se queda con el PRIMERO que casa, asi que dos personas
 * con el mismo PIN significan que una de las dos ficha SIEMPRE por la otra, en silencio
 * y para siempre: las horas se le apuntan a quien no las trabajo y nadie se entera.
 *
 * Nada lo impedia: el PIN se sorteaba al azar y se guardaba. Con seis digitos y veinte
 * personas la probabilidad es ~0,2%, pero el coste de que ocurra es que las horas de
 * alguien acaben en la nomina de otro.
 */
async function pinYaUsado(sedes: string[], employeeId: string, pin: string): Promise<boolean> {
  if (sedes.length === 0) return false;

  // `in` admite 30 valores. Nadie trabaja en 30 sedes, pero el limite es del motor.
  const companeros = new Set<string>();
  for (const doc of (
    await db
      .collection(COLLECTIONS.employeeLocations)
      .where('location_id', 'in', sedes.slice(0, 30))
      .get()
  ).docs) {
    const otro = String(doc.data().employee_id);
    if (otro !== employeeId) companeros.add(otro);
  }
  if (companeros.size === 0) return false;

  const credenciales = await db.getAll(
    ...[...companeros].map((id) => db.collection(COLLECTIONS.pinCredentials).doc(id)),
  );
  return credenciales.some((doc) => {
    const hash = doc.data()?.pin_hash;
    return typeof hash === 'string' && bcrypt.compareSync(pin, hash);
  });
}

/**
 * Fija el PIN de un empleado. El PIN EN CLARO NO SE GUARDA NI SE REGISTRA.
 *
 * Se guarda solo su hash bcrypt, en una coleccion que las reglas cierran a todo el
 * mundo: devolverlo —o dejar leer el hash— permitiria atacarlo sin limite de
 * intentos y sin dejar rastro, y seis digitos son un millon de combinaciones, cosa
 * de segundos en una maquina local. La auditoria anota QUE se cambio, nunca a que.
 *
 * LO GENERA EL SERVIDOR Y YA NO EL PANEL. Antes el panel sorteaba el PIN y mandaba los
 * digitos; el problema es que el panel no sabe dos cosas que hacen falta para que ese
 * PIN sirva: cuantos digitos pide el teclado de la sede DE ESA PERSONA —usaba los de la
 * sede que el gerente tuviera seleccionada— y si el PIN ya es de otro. Las dos se
 * saben aqui, asi que aqui se decide, y el PIN en claro vuelve en la respuesta para
 * enseñarlo una vez.
 */
export const setEmployeePin = onCall(async (request) => {
  const uid = requireUid(request);
  const employeeId = textoRequerido(request.data?.p_employee_id, 'p_employee_id');
  const empleadoRef = db.collection(COLLECTIONS.employees).doc(employeeId);
  const empleado = (await empleadoRef.get()).data();
  if (empleado === undefined) throw new HttpsError('not-found', 'Ese empleado no existe.');

  const organizationId = empleado.organization_id as string;
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin', 'manager']);

  const { sedes, longitud } = await sedesYLongitud(organizationId, employeeId);

  /*
   * QUE GESTIONE ALGUNA DE SUS SEDES. Esto solo miraba el rol, asi que un encargado de
   * la sede A podia ponerle PIN a alguien de la sede B —y, sabiendo el PIN, fichar por
   * el—. El ayudante existia desde siempre; aqui no se usaba.
   *
   * Sin sede asignada no hay ubicacion contra la que comprobar, y entonces solo pueden
   * owner y admin: un encargado no tiene por que tocar a alguien que todavia no es de
   * ninguna tienda.
   */
  if (sedes.length === 0) requireRole(membership, ['owner', 'admin']);
  else if (!sedes.some((id) => managesLocation(membership, id))) {
    throw new HttpsError('permission-denied', 'No administras ninguna de sus sedes.');
  }

  /*
   * Se sortea hasta dar con uno libre. Veinte vueltas es de sobra: con seis digitos y
   * una tienda de doscientas personas, la probabilidad de fallar veinte seguidas es de
   * una entre 10^54. Y si pasara, es mejor un error que un PIN compartido.
   *
   * NO HAY FORMA DE ELEGIR EL PIN, a proposito. La habia —un `p_pin` opcional— y no la
   * usaba nadie: el unico camino del panel es «Reiniciar PIN». Un parametro que nadie
   * manda es una rama que nadie prueba, y en esta valia la pena menos que en ninguna,
   * porque es por donde entraria un PIN elegido a mano tipo 1234.
   */
  let pin: string | null = null;
  for (let intento = 0; intento < 20 && pin === null; intento += 1) {
    const sorteado = generatePin(longitud, (n) => new Uint8Array(randomBytes(n)));
    if (!(await pinYaUsado(sedes, employeeId, sorteado))) pin = sorteado;
  }
  if (pin === null) {
    throw new HttpsError('resource-exhausted', 'No encontramos un PIN libre. Inténtalo otra vez.');
  }

  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(employeeId)
    .set(
      {
        employee_id: employeeId,
        organization_id: organizationId,
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
    organizationId,
    actorUserId: uid,
    action: 'employee_pin_set',
    entityType: 'employee',
    entityId: employeeId,
  });

  // El PIN en claro, UNA vez, para poder enseñarselo a la persona. No se registra.
  return { pin };
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

// ---------------------------------------------------------------------------
// Reclasificar una salida que en realidad fue una ausencia por trabajo
// ---------------------------------------------------------------------------

/**
 * «Esa salida no fue fin de jornada: se fue al almacen y volvio.» (Andree, 2026-09-22)
 *
 * EL CASO REAL. Alguien se ausenta por un encargo de la empresa y marca SALIDA, porque
 * en el momento no sabia que lo correcto era una pausa —o habia cola, o simplemente no
 * lo penso—. Al volver marca ENTRADA. El resultado son dos jornadas cortadas y un hueco
 * en medio que el sistema cuenta como tiempo propio, cuando era trabajo.
 *
 * QUE HACE: convierte ese par salida+entrada en una PAUSA con motivo. La opcion B de las
 * dos que habia, y la elegida porque NO AÑADE UN CONCEPTO NUEVO: usa la pausa, que ya
 * existe y ya sabe si cuenta como trabajado segun lo que la sede configuro.
 *
 * QUE NO HACE: tocar los fichajes. No se edita ninguno y no se borra ninguno. Los dos
 * eventos siguen diciendo `clock_out` y `clock_in` —es lo que la persona marco, y es lo
 * que se enseña en «Fichajes en crudo»— y ganan un `reclassified_as` que solo mira el
 * calculo. Ver `shared/eventos.ts`.
 *
 * TRES COSAS QUE SE RECHAZAN, y cada una por una razon concreta:
 *  - que el evento no sea una salida: no hay nada que convertir;
 *  - que no haya una entrada despues: seria una pausa sin final, o sea una persona que
 *    figura descansando para siempre;
 *  - que ya este reclasificado: hacerlo dos veces sumaria la pausa dos veces.
 */
export const managerReclassifyDeparture = onCall(async (request) => {
  const uid = requireUid(request);
  const eventId = textoRequerido(request.data?.p_event_id, 'p_event_id');
  const breakReason = textoRequerido(request.data?.p_break_reason, 'p_break_reason');
  const reason = textoRequerido(request.data?.p_reason, 'p_reason');

  const salidaRef = db.collection(COLLECTIONS.timeEvents).doc(eventId);
  const salidaDoc = await salidaRef.get();
  const salida = salidaDoc.data();
  if (salida === undefined) throw new HttpsError('not-found', 'Ese fichaje no existe.');

  const organizationId = salida.organization_id as string;
  const employeeId = salida.employee_id as string;
  const locationId = salida.location_id as string;

  const membership = await membershipOf(uid, organizationId);
  requireManagesLocation(membership, locationId);

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const locationSettings = ((location ?? {}).settings ?? {}) as Record<string, unknown>;

  if (tipoEfectivo(salida) !== 'clock_out') {
    throw new HttpsError('failed-precondition', 'Ese fichaje no es una salida.');
  }
  if (estaReclasificado(salida)) {
    throw new HttpsError('failed-precondition', 'Esa salida ya se reclasifico.');
  }

  /*
   * LA ENTRADA DE VUELTA ES LA SIGUIENTE, no una cualquiera. Se busca por instante y se
   * comprueba que de verdad sea una entrada: si el siguiente fichaje fuera otra cosa, el
   * par no formaria una pausa y convertirlo dejaria la jornada peor de como estaba.
   */
  const siguientes = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', employeeId)
    .where('occurred_at', '>', salida.occurred_at)
    .orderBy('occurred_at', 'asc')
    .limit(1)
    .get();

  const vueltaDoc = siguientes.docs[0];
  const vuelta = vueltaDoc?.data();
  if (vueltaDoc === undefined || vuelta === undefined || tipoEfectivo(vuelta) !== 'clock_in') {
    throw new HttpsError(
      'failed-precondition',
      'No hay una entrada despues de esa salida: sin vuelta no hay pausa que crear.',
    );
  }

  const minutos = Math.floor(
    (new Date(String(vuelta.occurred_at)).getTime() -
      new Date(String(salida.occurred_at)).getTime()) /
      60000,
  );

  /*
   * NO SE PUEDE CONVERTIR UN HUECO DE UNA NOCHE ENTERA, y esto no estaba y era un fallo
   * de verdad: «la entrada siguiente» de quien sale a las 21:00 un lunes es la de las
   * 09:00 del martes. Sin este limite, reclasificar la salida del lunes creaba una pausa
   * de doce horas y fundia dos jornadas distintas en una sola de veinticuatro. Con
   * `errand` —que cuenta como trabajado— eso son doce horas regaladas de un clic.
   *
   * EL LIMITE ES EL DESCANSO MINIMO ENTRE TURNOS de la sede, y no un numero nuevo: ese
   * valor ya significa exactamente «a partir de aqui esto es tiempo libre entre dos
   * jornadas y no un rato fuera». Once horas de fabrica.
   */
  const descansoMinimo = Number(
    (locationSettings.minimumRestMinutes as number | undefined) ?? DESCANSO_MINIMO_POR_DEFECTO,
  );
  if (minutos >= descansoMinimo) {
    throw new HttpsError(
      'failed-precondition',
      'Entre esa salida y la vuelta pasa mas que el descanso minimo entre turnos: ' +
        'son dos jornadas distintas, no una ausencia.',
    );
  }

  /*
   * PAGADO O NO LO DECIDE LA SEDE, no el gerente que corrige ni el motivo por si solo.
   * Es la misma regla que en el reloj y vive en un solo sitio: si aqui se decidiera
   * aparte, la misma pausa contaria distinto segun quien la creo.
   */
  const pagados = politicasDe(location ?? {}).paidBreakReasons;
  const breakType =
    (pagados[breakReason] ??
    (DEFAULT_PAID_REASONS as Record<string, boolean>)[breakReason] ??
    false)
      ? 'paid'
      : 'unpaid';

  const sesionCortada = await db
    .collection(COLLECTIONS.workSessions)
    .where('clock_out_event_id', '==', eventId)
    .limit(1)
    .get();
  const sesionSiguiente = await db
    .collection(COLLECTIONS.workSessions)
    .where('clock_in_event_id', '==', vueltaDoc.id)
    .limit(1)
    .get();

  await db.runTransaction(async (tx) => {
    tx.update(salidaRef, {
      reclassified_as: 'break_start',
      break_reason: breakReason,
      break_type: breakType,
      reclassified_by: uid,
      reclassified_at: nowISO(),
    });
    tx.update(vueltaDoc.ref, {
      reclassified_as: 'break_end',
      reclassified_by: uid,
      reclassified_at: nowISO(),
    });

    /*
     * LAS DOS SESIONES SE FUNDEN EN UNA, a mano y solo estas dos.
     *
     * Reconstruir todo desde los eventos habria sido mas elegante y es lo que dice el
     * comentario de `rebuildWorkSession`, pero HOY LA PROYECCION NO ES PURA:
     * `managerAdjustTime` escribe las correcciones de hora DENTRO de la sesion, no en
     * los eventos. Una reconstruccion general las borraria todas sin avisar. Asi que se
     * toca lo justo: la sesion cortada se alarga hasta el final de la siguiente y la
     * siguiente desaparece.
     */
    const cortada = sesionCortada.docs[0];
    const siguiente = sesionSiguiente.docs[0];

    if (cortada !== undefined && siguiente !== undefined) {
      const a = cortada.data();
      const b = siguiente.data();

      const brutos =
        b.ends_at === null
          ? null
          : Math.floor(
              (new Date(String(b.ends_at)).getTime() - new Date(String(a.starts_at)).getTime()) /
                60000,
            );
      const pagadosMin =
        Number(a.paid_break_minutes ?? 0) +
        Number(b.paid_break_minutes ?? 0) +
        (breakType === 'paid' ? minutos : 0);
      const noPagadosMin =
        Number(a.unpaid_break_minutes ?? 0) +
        Number(b.unpaid_break_minutes ?? 0) +
        (breakType === 'paid' ? 0 : minutos);

      tx.update(cortada.ref, {
        ends_at: b.ends_at ?? null,
        clock_out_event_id: b.clock_out_event_id ?? null,
        gross_minutes: brutos,
        paid_break_minutes: pagadosMin,
        unpaid_break_minutes: noPagadosMin,
        net_minutes: brutos === null ? null : brutos - noPagadosMin,
        status: b.ends_at === null ? 'open' : 'complete',
        /*
         * LA MARCA DE SALIDA ANTICIPADA SE VA, y es media razon para existir de todo
         * esto: la persona no se fue antes, siguio trabajando en otro sitio. Dejarla
         * seria seguir señalando en la hoja de horas algo que el gerente acaba de
         * explicar.
         */
        flags: (Array.isArray(a.flags) ? a.flags : []).filter(
          (marca: unknown) => marca !== 'early_departure',
        ),
        departure_reason: null,
        departure_note: null,
        recomputed_at: nowISO(),
        updated_at: nowISO(),
      });
      tx.delete(siguiente.ref);
    }

    /**
     * LA CORRECCION ES UNA FILA NUEVA con su autor y su motivo, como todas: es lo que
     * vale ante una inspeccion, y es lo unico que distingue una correccion legitima de
     * alguien regalandose horas.
     */
    tx.create(db.collection(COLLECTIONS.timeAdjustments).doc(), {
      organization_id: organizationId,
      work_session_id: sesionCortada.docs[0]?.id ?? null,
      target_type: 'time_event',
      target_id: eventId,
      before_value: { event_type: 'clock_out', occurred_at: salida.occurred_at },
      after_value: {
        reclassified_as: 'break_start',
        break_reason: breakReason,
        break_type: breakType,
        minutes: minutos,
        paired_event_id: vueltaDoc.id,
      },
      reason,
      created_by: uid,
      created_at: nowISO(),
      channel: 'manager_app',
    });
  });

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'departure_reclassified_as_break',
    entityType: 'time_event',
    entityId: eventId,
  });

  return { minutes: minutos, breakType, workSessionId: sesionCortada.docs[0]?.id ?? null };
});

// ---------------------------------------------------------------------------
// Publicar el horario de una semana
// ---------------------------------------------------------------------------

/**
 * Publica los turnos de una semana y SELLA su version en el servidor (§11.3 pasos 6-7).
 *
 * POR QUE EXISTE ESTA FUNCION. El cliente publicaba por su cuenta: ponia los turnos en
 * `published` e insertaba la fila de publicacion con la version siguiente. Lo que NUNCA
 * escribia era la version EN EL TURNO, y de eso depende la etiqueta «Cambiado»:
 *
 *     shift.status === 'draft' && shift.publication_version > 0
 *
 * O sea «esto ya estuvo publicado y ahora vuelve a ser borrador». Sin el sello, esa
 * condicion no se cumplia jamas y un turno que moviste DESPUES de publicarlo se veia
 * exactamente igual que uno nuevo. Quien mira el horario no distinguia «esto es nuevo»
 * de «esto cambio y el equipo ya lo habia visto de otra forma», que es justo la
 * diferencia que importa antes de volver a publicar.
 *
 * EN LA DEMOSTRACION SI SALIA, porque la semilla escribe `publication_version: 7` a mano.
 * Otro caso de algo que funciona en la demostracion y no en la realidad.
 *
 * Y POR QUE NO SE ARREGLO EN EL CLIENTE, que era un `update` mas: porque el propio
 * comentario de `publishShifts` decia que la version «la pone un trigger de la base, no
 * el cliente: las tardanzas se miden contra el turno publicado vigente y esa version no
 * puede depender de lo que envie una app». Ese trigger era de Postgres y se fue con la
 * migracion a Firebase sin que nada lo reemplazara. El comentario seguia describiendo un
 * mecanismo que ya no existia. Esto es ese reemplazo.
 *
 * TODO EN UNA TRANSACCION, y no es adorno: la version siguiente se calcula leyendo la
 * ultima. Dos gerentes publicando la misma semana a la vez leerian las dos la misma y
 * escribirian las dos la misma, y entonces habria dos publicaciones distintas diciendo
 * ser la numero 4.
 */
export const publishShiftsForWeek = onCall(async (request) => {
  const uid = requireUid(request);
  const locationId = textoRequerido(request.data?.p_location_id, 'p_location_id');
  const weekStart = textoRequerido(request.data?.p_week_start, 'p_week_start');
  const shiftIds = Array.isArray(request.data?.p_shift_ids)
    ? (request.data.p_shift_ids as string[])
    : [];

  if (shiftIds.length === 0) {
    throw new HttpsError('invalid-argument', 'No hay turnos que publicar.');
  }

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  if (location === undefined) throw new HttpsError('not-found', 'Esa ubicación no existe.');

  const organizationId = location.organization_id as string;
  const membership = await membershipOf(uid, organizationId);
  requireManagesLocation(membership, locationId);

  const version = await db.runTransaction(async (tx) => {
    /*
     * TODAS LAS LECTURAS ANTES QUE LAS ESCRITURAS: Firestore lo exige dentro de una
     * transaccion, y saltarselo no da un error claro sino uno sobre el orden.
     */
    const publicaciones = await tx.get(
      db
        .collection(COLLECTIONS.shiftPublications)
        .where('organization_id', '==', organizationId)
        .where('location_id', '==', locationId)
        .where('week_starts_on', '==', weekStart)
        .orderBy('publication_version', 'desc')
        .limit(1),
    );

    const turnos = await Promise.all(
      shiftIds.map((id) => tx.get(db.collection(COLLECTIONS.shifts).doc(id))),
    );

    const siguiente = Number(publicaciones.docs[0]?.data().publication_version ?? 0) + 1;
    const ahora = nowISO();

    const publicados: string[] = [];
    for (const doc of turnos) {
      const turno = doc.data();
      if (turno === undefined) continue;

      /*
       * QUE EL TURNO SEA DE ESTA SEDE, comprobado aqui y no confiando en la lista que
       * manda el cliente. Sin esto, alguien que gestiona una tienda podria publicar —y
       * sellar— turnos de otra pasando sus ids.
       */
      if (turno.location_id !== locationId) {
        throw new HttpsError('permission-denied', 'Ese turno no es de esta ubicación.');
      }
      // Solo los borradores: republicar uno ya publicado subiria su version sin motivo.
      if (turno.status !== 'draft') continue;

      tx.update(doc.ref, {
        status: 'published',
        /*
         * EL SELLO, que es todo el punto de esta funcion. `publication_version` en el
         * TURNO es lo que hace que la etiqueta «Cambiado» pueda salir algun dia: al
         * editarlo despues, el turno vuelve a `draft` y conserva esta version, y esa
         * combinacion es la que la pantalla busca.
         */
        publication_version: siguiente,
        published_at: ahora,
        updated_by: uid,
        updated_at: ahora,
      });
      publicados.push(doc.id);
    }

    if (publicados.length === 0) {
      throw new HttpsError('failed-precondition', 'Ninguno de esos turnos estaba en borrador.');
    }

    tx.create(db.collection(COLLECTIONS.shiftPublications).doc(), {
      organization_id: organizationId,
      location_id: locationId,
      week_starts_on: weekStart,
      publication_version: siguiente,
      published_by: uid,
      published_at: ahora,
      changed_shift_ids: publicados,
      created_at: ahora,
    });

    return { version: siguiente, publicados: publicados.length };
  });

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'shifts_published',
    entityType: 'location',
    entityId: locationId,
  });

  return version;
});
