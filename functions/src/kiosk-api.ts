import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  allowedEvents,
  evaluateClockInEligibility,
  type AttendanceState,
  type TimeEventType,
} from '../../src/domain/attendance-state-machine';
import { COLLECTIONS, db, nowISO } from './shared/admin';
import { membershipOf, requireManagesLocation, requireUid } from './shared/caller';
import { attendanceStateAt, recordTimeEvent } from './shared/attendance';
import {
  authenticateKiosk,
  issueActionToken,
  recordKioskRejection,
  verifyActionToken,
  type KioskContext,
} from './shared/kiosk';

/**
 * Las ocho funciones del kiosco. Reemplazan a las Edge Functions de Supabase.
 *
 * NINGUNA EXIGE SESION DE FIREBASE, y es deliberado: un iPad compartido en el
 * mostrador con una cuenta de Google dentro seria una cuenta que cualquiera del
 * local puede usar para entrar al panel. Lo que las defiende es la credencial del
 * dispositivo, y para escribir un fichaje ademas el token de accion de 90 segundos
 * que emite `verifyPin`. Con una sola de las dos, conocer la credencial del iPad
 * bastaria para fichar por cualquiera.
 */

const BCRYPT_ROUNDS = 10;

/**
 * El secreto que firma los tokens de accion, declarado SOLO en las cuatro funciones
 * que lo usan.
 *
 * En firebase-functions v2 un secreto no llega al entorno por existir: hay que
 * pedirlo por funcion, y la que no lo pide lee `undefined`. Declararlo en todas
 * seria mas comodo y peor: cada funcion que lo declara puede leerlo, y `activateKiosk`
 * —la unica que atiende sin credencial previa— no tiene por que poder.
 */
const OPCIONES_CON_SECRETO = { secrets: ['KIOSK_TOKEN_SECRET'] };
const POLITICAS_POR_DEFECTO = {
  pinLength: 6,
  photoEnabled: false,
  earlyClockInMinutes: 10,
  lateGraceMinutes: 5,
  allowUnscheduledShifts: true,
  timeFormat: '24h' as const,
  requiredBreakMinutes: 0,
};

function politicasDe(location: Record<string, unknown>) {
  const settings = (location.settings ?? {}) as Record<string, unknown>;
  return {
    pinLength: Number(settings.pinLength ?? POLITICAS_POR_DEFECTO.pinLength),
    photoEnabled: Boolean(settings.photoEnabled ?? POLITICAS_POR_DEFECTO.photoEnabled),
    earlyClockInMinutes: Number(
      settings.earlyClockInMinutes ?? POLITICAS_POR_DEFECTO.earlyClockInMinutes,
    ),
    lateGraceMinutes: Number(settings.lateGraceMinutes ?? POLITICAS_POR_DEFECTO.lateGraceMinutes),
    allowUnscheduledShifts: Boolean(
      settings.allowUnscheduledShifts ?? POLITICAS_POR_DEFECTO.allowUnscheduledShifts,
    ),
    timeFormat: (settings.timeFormat ?? POLITICAS_POR_DEFECTO.timeFormat) as '12h' | '24h',
    requiredBreakMinutes: Number(
      settings.requiredBreakMinutes ?? POLITICAS_POR_DEFECTO.requiredBreakMinutes,
    ),
  };
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const primera = partes[0]?.[0] ?? '?';
  const segunda = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return `${primera}${segunda}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Activacion
// ---------------------------------------------------------------------------

/**
 * Canjea un codigo de un solo uso y ata este iPad a UNA ubicacion.
 *
 * El codigo se marca usado DENTRO de la transaccion que lo lee. Comprobar antes y
 * marcar despues deja una ventana en la que dos iPads canjean el mismo codigo, y el
 * codigo existe precisamente para que solo uno pueda.
 *
 * La credencial se devuelve EN CLARO UNA SOLA VEZ: solo se guarda su hash, en una
 * coleccion cerrada. Si se pudiera volver a leer, el inventario de relojes del
 * panel seria la lista de llaves de todas las tiendas.
 */
export const activateKiosk = onCall(async (request) => {
  const code = String(request.data?.code ?? '').trim();
  const displayName = String(request.data?.displayName ?? 'iPad').trim() || 'iPad';
  const installationId = (request.data?.installationId as string | undefined) ?? null;
  const appVersion = (request.data?.appVersion as string | undefined) ?? null;

  if (!/^\d{4,8}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Ese código no tiene la forma correcta.');
  }

  const candidatos = await db
    .collection(COLLECTIONS.kioskActivationCodes)
    .where('used_count', '==', 0)
    .where('expires_at', '>', nowISO())
    .get();

  /**
   * Se comparan TODOS los codigos vivos con bcrypt en vez de buscar por hash.
   * Buscar por hash exigiria guardarlo sin sal, y un hash sin sal de seis digitos
   * se rompe con una tabla precalculada de un millon de entradas. Son pocos codigos
   * vivos a la vez —caducan en minutos—, asi que el coste es despreciable.
   */
  const encontrado = candidatos.docs.find((doc) =>
    bcrypt.compareSync(code, String(doc.data().code_hash)),
  );

  if (encontrado === undefined) {
    throw new HttpsError('not-found', 'Ese código no es válido o ya caducó.');
  }

  const datosCodigo = encontrado.data();
  const locationId = datosCodigo.location_id as string;
  const organizationId = datosCodigo.organization_id as string;

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const organization = (
    await db.collection(COLLECTIONS.organizations).doc(organizationId).get()
  ).data();
  if (location === undefined || organization === undefined) {
    throw new HttpsError('not-found', 'La tienda de ese código ya no existe.');
  }

  const credential = randomBytes(32).toString('base64url');
  const deviceKey = randomBytes(32).toString('base64url');
  const devicePublicId = randomBytes(12).toString('base64url');

  const deviceRef = db.collection(COLLECTIONS.kioskDevices).doc();

  await db.runTransaction(async (tx) => {
    const actual = await tx.get(encontrado.ref);
    if ((actual.data()?.used_count ?? 0) !== 0) {
      throw new HttpsError('aborted', 'Ese código ya se usó en otro dispositivo.');
    }
    tx.update(encontrado.ref, { used_count: 1 });

    tx.create(deviceRef, {
      id: deviceRef.id,
      organization_id: organizationId,
      location_id: locationId,
      display_name: displayName,
      device_public_id: devicePublicId,
      installation_id: installationId,
      status: 'active',
      app_version: appVersion,
      last_seen_at: nowISO(),
      last_sync_at: null,
      created_by: datosCodigo.created_by ?? null,
      created_at: nowISO(),
      revoked_at: null,
    });

    // Los dos secretos, en la coleccion que nadie puede leer.
    tx.create(db.collection(COLLECTIONS.kioskDeviceSecrets).doc(deviceRef.id), {
      credential_hash: bcrypt.hashSync(credential, BCRYPT_ROUNDS),
      offline_key: deviceKey,
      created_at: nowISO(),
    });
  });

  return {
    credential,
    deviceKey,
    device: { id: deviceRef.id, publicId: devicePublicId, displayName },
    organization: {
      id: organizationId,
      name: organization.name,
      defaultLocale: organization.default_locale ?? 'es-PE',
      weekStartsOn: organization.week_starts_on ?? 1,
      logoPath: organization.logo_path ?? null,
    },
    location: {
      id: locationId,
      name: location.name,
      timezone: location.timezone ?? 'America/Lima',
      policies: politicasDe(location),
    },
  };
});

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/** Lo minimo para que el iPad opere: quien trabaja aqui, sus turnos y las politicas. */
export const refreshKioskRoster = onCall(async (request) => {
  const kiosk = await authenticateKiosk(request.data);

  const location = (await db.collection(COLLECTIONS.locations).doc(kiosk.locationId).get()).data();
  if (location === undefined) throw new HttpsError('not-found', 'Esa tienda ya no existe.');

  const asignaciones = await db
    .collection(COLLECTIONS.employeeLocations)
    .where('location_id', '==', kiosk.locationId)
    .get();

  const empleados = [];
  for (const asignacion of asignaciones.docs) {
    const employeeId = asignacion.data().employee_id as string;
    const empleado = (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).data();
    if (empleado === undefined || empleado.status !== 'active') continue;

    /**
     * EL VERIFICADOR DE PIN SIN CONEXION va atado a ESTE dispositivo, con su
     * `offline_key`. Sin ese atado, copiar el archivo SQLite de un iPad a otro
     * daria un verificador utilizable en la otra tienda.
     */
    const credencial = (
      await db.collection(COLLECTIONS.pinCredentials).doc(employeeId).get()
    ).data();

    empleados.push({
      opaqueId: employeeId,
      displayName: (empleado.preferred_name as string | null) ?? (empleado.full_name as string),
      initials: iniciales(String(empleado.full_name)),
      pinVerifier: credencial?.pin_hash ?? null,
      pinLength: credencial?.pin_length ?? politicasDe(location).pinLength,
      canManageLocation: asignacion.data().can_manage === true,
    });
  }

  const desde = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const hasta = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const turnos = await db
    .collection(COLLECTIONS.shifts)
    .where('location_id', '==', kiosk.locationId)
    .where('starts_at', '>=', desde)
    .where('starts_at', '<=', hasta)
    .orderBy('starts_at', 'asc')
    .get();

  await db.collection(COLLECTIONS.kioskDevices).doc(kiosk.deviceId).update({
    last_seen_at: nowISO(),
  });

  return {
    location: {
      id: kiosk.locationId,
      name: location.name,
      timezone: location.timezone ?? 'America/Lima',
      policies: politicasDe(location),
    },
    employees: empleados,
    shifts: turnos.docs
      .filter((doc) => doc.data().status === 'published')
      .map((doc) => ({
        id: doc.id,
        employeeId: doc.data().employee_id,
        startsAt: doc.data().starts_at,
        endsAt: doc.data().ends_at,
        plannedUnpaidBreakMinutes: doc.data().planned_unpaid_break_minutes ?? 0,
        employeeNote: doc.data().employee_note ?? null,
      })),
    syncedAt: nowISO(),
  };
});

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 5;

/**
 * El limite de intentos se cuenta POR DISPOSITIVO, no por empleado, y la diferencia
 * importa en las dos direcciones.
 *
 * A favor: el ataque real es alguien de pie frente al iPad tecleando combinaciones,
 * y con bcrypt no se puede saber a quien pertenece un PIN fallido —no hay a quien
 * sumarle el intento—. Contar por aparato es lo unico que de verdad frena eso.
 *
 * En contra, y es el motivo de que NO se cuente por persona: si se pudiera bloquear
 * a un empleado concreto, cualquiera podria dejar a un companero sin fichar tecleando
 * cinco veces mal su PIN. Eso convierte una proteccion en un arma.
 *
 * Cinco minutos y no mas: esto pasa en el mostrador de una tienda al empezar el turno,
 * y un bloqueo largo por un dedo torpe deja a alguien sin marcar su entrada.
 */
async function comprobarBloqueo(deviceId: string): Promise<void> {
  const dispositivo = (await db.collection(COLLECTIONS.kioskDevices).doc(deviceId).get()).data();
  const hasta = dispositivo?.pin_locked_until;
  if (typeof hasta === 'string' && new Date(hasta) > new Date()) {
    throw new HttpsError(
      'resource-exhausted',
      'Demasiados intentos en este reloj. Espera unos minutos.',
    );
  }
}

async function anotarFallo(deviceId: string): Promise<void> {
  const ref = db.collection(COLLECTIONS.kioskDevices).doc(deviceId);
  await db.runTransaction(async (tx) => {
    const actual = (await tx.get(ref)).data() ?? {};
    const intentos = Number(actual.pin_failed_attempts ?? 0) + 1;
    tx.update(ref, {
      pin_failed_attempts: intentos,
      pin_locked_until:
        intentos >= MAX_INTENTOS
          ? new Date(Date.now() + BLOQUEO_MINUTOS * 60_000).toISOString()
          : null,
    });
  });
}

export const verifyPin = onCall(OPCIONES_CON_SECRETO, async (request) => {
  const kiosk = await authenticateKiosk(request.data);
  const pin = String(request.data?.pin ?? '');

  if (!/^\d{4,6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'Ese PIN no tiene la forma correcta.');
  }

  await comprobarBloqueo(kiosk.deviceId);

  const asignaciones = await db
    .collection(COLLECTIONS.employeeLocations)
    .where('location_id', '==', kiosk.locationId)
    .get();

  let employeeId: string | null = null;
  let asignacion: Record<string, unknown> | null = null;

  for (const doc of asignaciones.docs) {
    const candidato = doc.data().employee_id as string;
    const credencial = (
      await db.collection(COLLECTIONS.pinCredentials).doc(candidato).get()
    ).data();
    if (credencial === undefined) continue;

    const bloqueado =
      typeof credencial.locked_until === 'string' && new Date(credencial.locked_until) > new Date();
    if (bloqueado) continue;

    if (bcrypt.compareSync(pin, String(credencial.pin_hash))) {
      employeeId = candidato;
      asignacion = doc.data();
      break;
    }
  }

  if (employeeId === null || asignacion === null) {
    /**
     * MISMO ERROR PARA «no existe» Y «PIN equivocado». Distinguirlos convertiria el
     * teclado en un comprobador de que PIN pertenece a alguien, probando de uno en
     * uno. Los intentos fallidos se cuentan por ubicacion, no por persona, porque
     * aqui todavia no se sabe quien intento entrar.
     */
    await anotarFallo(kiosk.deviceId);
    await recordKioskRejection({
      devicePublicId: String(
        (request.data as { kioskAuth?: { devicePublicId?: string } })?.kioskAuth?.devicePublicId ??
          '',
      ),
      reason: 'wrong_location',
      organizationId: kiosk.organizationId,
      locationId: kiosk.locationId,
      deviceId: kiosk.deviceId,
    });
    throw new HttpsError('permission-denied', 'Ese PIN no es correcto.');
  }

  // Un acierto limpia la cuenta del aparato: si no, cinco errores repartidos a lo
  // largo del dia acabarian bloqueando un reloj que funciona bien.
  await db
    .collection(COLLECTIONS.kioskDevices)
    .doc(kiosk.deviceId)
    .update({ pin_failed_attempts: 0, pin_locked_until: null });

  return buildEmployeeContext(kiosk, employeeId, asignacion);
});

/** El contexto que ve el empleado tras el PIN. Era `kiosk_employee_context`. */
async function buildEmployeeContext(
  kiosk: KioskContext,
  employeeId: string,
  asignacion: Record<string, unknown>,
) {
  const location = (await db.collection(COLLECTIONS.locations).doc(kiosk.locationId).get()).data();
  const empleado = (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).data();
  if (location === undefined || empleado === undefined) {
    throw new HttpsError('not-found', 'No pudimos preparar tu turno.');
  }

  const politicas = politicasDe(location);
  const ahora = new Date();
  const estado: AttendanceState = await attendanceStateAt(employeeId, ahora.toISOString());

  const turnos = await db
    .collection(COLLECTIONS.shifts)
    .where('employee_id', '==', employeeId)
    .where('status', 'in', ['draft', 'published'])
    .where('starts_at', '>=', new Date(ahora.getTime() - 12 * 3600_000).toISOString())
    .orderBy('starts_at', 'asc')
    .limit(5)
    .get();

  const proximos = turnos.docs
    .filter((doc) => doc.data().status === 'published')
    .map((doc) => ({
      id: doc.id,
      startsAt: doc.data().starts_at as string,
      endsAt: doc.data().ends_at as string,
      jobRoleName: null,
      employeeNote: (doc.data().employee_note as string | null) ?? null,
      plannedUnpaidBreakMinutes: (doc.data().planned_unpaid_break_minutes as number) ?? 0,
      changedSinceLastPublication: false,
    }));

  const elegibilidad = evaluateClockInEligibility({
    now: ahora,
    shiftStartsAt: proximos[0] === undefined ? null : new Date(proximos[0].startsAt),
    earlyClockInMinutes: politicas.earlyClockInMinutes,
    allowUnscheduledShifts: politicas.allowUnscheduledShifts,
  });

  const abierta = await db
    .collection(COLLECTIONS.workSessions)
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'open')
    .limit(1)
    .get();
  const sesion = abierta.docs[0]?.data();

  const resueltas = await db
    .collection(COLLECTIONS.timeEditRequests)
    .where('employee_id', '==', employeeId)
    .where('status', 'in', ['approved', 'rejected'])
    .orderBy('created_at', 'desc')
    .limit(5)
    .get();

  const { token, expiresAt } = issueActionToken({
    employeeId,
    deviceId: kiosk.deviceId,
    locationId: kiosk.locationId,
  });

  return {
    actionToken: token,
    expiresAt,
    employee: {
      opaqueId: employeeId,
      displayName: (empleado.preferred_name as string | null) ?? (empleado.full_name as string),
      initials: iniciales(String(empleado.full_name)),
      jobRoleName: null,
      canManageLocation: asignacion.can_manage === true,
    },
    attendanceState: estado,
    allowedActions: allowedEvents(estado),
    eligibleShifts: proximos,
    openSession:
      sesion === undefined
        ? null
        : {
            startedAt: sesion.starts_at,
            shiftEndsAt: null,
            takenBreakMinutes:
              ((sesion.paid_break_minutes as number) ?? 0) +
              ((sesion.unpaid_break_minutes as number) ?? 0),
            requiredBreakMinutes: politicas.requiredBreakMinutes,
            openBreak: null,
          },
    earliestClockInAt:
      elegibilidad.eligible || elegibilidad.reason !== 'too_early' ? null : elegibilidad.earliestAt,
    requestUpdates: resueltas.docs.map((doc) => ({
      id: doc.id,
      kind: doc.data().kind,
      status: doc.data().status,
      targetDate: doc.data().target_date ?? null,
      reason: doc.data().reason,
      reviewerComment: doc.data().reviewer_comment ?? null,
      reviewedAt: doc.data().reviewed_at ?? doc.data().created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fichajes
// ---------------------------------------------------------------------------

function exigirTokenDeAccion(data: unknown, kiosk: KioskContext): string {
  const token = (data as { actionToken?: unknown } | null)?.actionToken;
  if (typeof token !== 'string') {
    throw new HttpsError('unauthenticated', 'Vuelve a marcar tu PIN.');
  }
  const payload = verifyActionToken(token, kiosk);
  if (payload === null) {
    throw new HttpsError('unauthenticated', 'Ese permiso caducó. Vuelve a marcar tu PIN.');
  }
  return payload.employeeId;
}

export const submitTimeEvent = onCall(OPCIONES_CON_SECRETO, async (request) => {
  const kiosk = await authenticateKiosk(request.data);
  const employeeId = exigirTokenDeAccion(request.data, kiosk);

  const eventType = String(request.data?.eventType ?? '') as TimeEventType;
  const idempotencyKey = String(request.data?.idempotencyKey ?? '');
  if (idempotencyKey === '') {
    throw new HttpsError('invalid-argument', 'Falta la clave de idempotencia.');
  }

  const resultado = await recordTimeEvent({
    organizationId: kiosk.organizationId,
    employeeId,
    locationId: kiosk.locationId,
    eventType,
    breakType: (request.data?.breakType as string | null) ?? null,
    breakReason: (request.data?.breakReason as string | null) ?? null,
    breakNote: (request.data?.breakNote as string | null) ?? null,
    occurredAt: (request.data?.occurredAt as string | undefined) ?? nowISO(),
    occurredAtDevice: (request.data?.occurredAtDevice as string | null) ?? null,
    idempotencyKey,
    deviceId: kiosk.deviceId,
    isOffline: false,
    source: 'kiosk',
  });

  const abierta = await db
    .collection(COLLECTIONS.workSessions)
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'open')
    .limit(1)
    .get();
  const sesion = abierta.docs[0]?.data();

  return {
    eventId: resultado.eventId,
    duplicated: resultado.duplicated,
    attendanceState: resultado.state,
    session: {
      startedAt: sesion?.starts_at ?? null,
      shiftEndsAt: null,
      netMinutesToday: (sesion?.net_minutes as number | undefined) ?? 0,
    },
  };
});

/**
 * Sincroniza un lote sin conexion. EN ORDEN Y SIN DESCARTAR NADA.
 *
 * El orden importa: los eventos se aplican por `deviceSequence`, no por el orden en
 * que llegaron al JSON, porque la maquina de estados rechazaria «salida, entrada» y
 * aceptaria «entrada, salida». Y no se corta al primer fallo: un evento invalido en
 * medio del lote no puede impedir que se guarden los demas, o una hora trabajada se
 * pierde porque otra estaba mal.
 */
export const syncOfflineEvents = onCall(OPCIONES_CON_SECRETO, async (request) => {
  const kiosk = await authenticateKiosk(request.data);
  const eventos = Array.isArray(request.data?.events) ? request.data.events : [];

  const ordenados = [...eventos].sort(
    (a, b) => Number(a?.deviceSequence ?? 0) - Number(b?.deviceSequence ?? 0),
  );

  const resultados = [];
  for (const evento of ordenados) {
    const employeeId = exigirTokenDeAccion(evento, kiosk);
    try {
      const resultado = await recordTimeEvent({
        organizationId: kiosk.organizationId,
        employeeId,
        locationId: kiosk.locationId,
        eventType: String(evento.eventType) as TimeEventType,
        breakType: evento.breakType ?? null,
        breakReason: evento.breakReason ?? null,
        breakNote: evento.breakNote ?? null,
        occurredAt: String(evento.occurredAt),
        occurredAtDevice: evento.occurredAtDevice ?? null,
        idempotencyKey: String(evento.idempotencyKey),
        deviceId: kiosk.deviceId,
        deviceSequence: Number(evento.deviceSequence ?? 0),
        isOffline: true,
        source: 'kiosk',
      });
      resultados.push({
        idempotencyKey: evento.idempotencyKey,
        accepted: true,
        duplicated: resultado.duplicated,
      });
    } catch (error) {
      resultados.push({
        idempotencyKey: evento.idempotencyKey,
        accepted: false,
        reason: error instanceof HttpsError ? error.message : 'Error desconocido',
      });
    }
  }

  await db
    .collection(COLLECTIONS.kioskDevices)
    .doc(kiosk.deviceId)
    .update({ last_sync_at: nowISO(), last_seen_at: nowISO() });

  return { results: resultados, syncedAt: nowISO() };
});

export const submitTimeEditRequest = onCall(OPCIONES_CON_SECRETO, async (request) => {
  const kiosk = await authenticateKiosk(request.data);
  const employeeId = exigirTokenDeAccion(request.data, kiosk);

  const reason = String(request.data?.reason ?? '').trim();
  if (reason === '') {
    throw new HttpsError('invalid-argument', 'Hay que explicar qué pasó.');
  }

  const doc = await db.collection(COLLECTIONS.timeEditRequests).add({
    organization_id: kiosk.organizationId,
    employee_id: employeeId,
    location_id: kiosk.locationId,
    work_session_id: (request.data?.workSessionId as string | null) ?? null,
    target_date: (request.data?.targetDate as string | null) ?? null,
    kind: String(request.data?.kind ?? 'correction'),
    proposed_value: request.data?.proposedValue ?? {},
    reason,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    reviewer_comment: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  return { requestId: doc.id };
});

/**
 * Sube la foto de un fichaje YA ACEPTADO y apunta su ruta.
 *
 * El orden importa y no es casual: primero el fichaje, despues la foto. Al reves,
 * una camara lenta o una subida que falla bloquearian el registro de la hora, y la
 * hora trabajada vale mas que la foto. Si la foto no llega, el fichaje sigue siendo
 * valido y solo se queda sin ella.
 *
 * La foto NO se sirve nunca directa: `storage.rules` cierra ese prefijo a todo el
 * mundo y quien la mire la pide por URL firmada.
 */
export const attachPhoto = onCall(async (request) => {
  const kiosk = await authenticateKiosk(request.data);
  const eventId = String(request.data?.eventId ?? '');
  const base64 = String(request.data?.imageBase64 ?? '');

  if (eventId === '' || base64 === '') {
    throw new HttpsError('invalid-argument', 'Falta el fichaje o la imagen.');
  }

  const eventoRef = db.collection(COLLECTIONS.timeEvents).doc(eventId);
  const evento = (await eventoRef.get()).data();
  if (evento === undefined) throw new HttpsError('not-found', 'Ese fichaje no existe.');

  // Que la foto sea de un fichaje de ESTE kiosco: si no, conocer un id de evento
  // bastaria para colgarle una imagen al fichaje de otra tienda.
  if (evento.location_id !== kiosk.locationId || evento.device_id !== kiosk.deviceId) {
    throw new HttpsError('permission-denied', 'Ese fichaje no es de este reloj.');
  }

  const ruta = `attendance-photos/${kiosk.organizationId}/${eventId}.jpg`;
  await getStorage()
    .bucket()
    .file(ruta)
    .save(Buffer.from(base64, 'base64'), { contentType: 'image/jpeg' });

  /**
   * `time_events` es append-only y esto lo respeta: `photo_path` se escribe una sola
   * vez, sobre un campo que nacio nulo, y no toca ni la hora ni el tipo del evento.
   * Es el mismo hueco que dejaba el disparador `reject_mutation()` en Postgres para
   * `attach-photo`, y por el mismo motivo.
   */
  if (typeof evento.photo_path === 'string') {
    throw new HttpsError('already-exists', 'Ese fichaje ya tiene foto.');
  }
  await eventoRef.update({ photo_path: ruta });

  return { photoPath: ruta };
});

/**
 * URL firmada de corta vida para que un encargado vea una foto de fichaje.
 *
 * Es el equivalente de `attendance_photo_path`: quien pide tiene que administrar la
 * ubicacion del fichaje, y la URL caduca en cinco minutos. Servir la foto sin firma
 * seria publicar la cara de un trabajador con su hora y su tienda.
 */
export const attendancePhotoUrl = onCall(async (request) => {
  const uid = requireUid(request);
  const eventId = String(request.data?.eventId ?? '');

  const evento = (await db.collection(COLLECTIONS.timeEvents).doc(eventId).get()).data();
  if (evento === undefined) throw new HttpsError('not-found', 'Ese fichaje no existe.');
  if (typeof evento.photo_path !== 'string') {
    throw new HttpsError('not-found', 'Ese fichaje no tiene foto.');
  }

  const membership = await membershipOf(uid, evento.organization_id as string);
  requireManagesLocation(membership, evento.location_id as string);

  const [url] = await getStorage()
    .bucket()
    .file(evento.photo_path)
    .getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60_000 });

  return { url };
});
