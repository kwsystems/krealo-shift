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
import { estaBloqueado, trasUnFallo } from './shared/bloqueo';
import { politicasDe } from './shared/politicas';
import { salDeBcrypt, verificadorSinConexion } from './shared/verificador';
import {
  authenticateKiosk,
  issueActionToken,
  KIOSK_TOKEN_SECRET,
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
const OPCIONES_CON_SECRETO = { secrets: [KIOSK_TOKEN_SECRET] };
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
  /*
   * `activationCode`, QUE ES LO QUE MANDA EL CLIENTE. Esto leia `code` y el resultado
   * era que activar un reloj respondia 400 SIEMPRE: el campo llegaba vacio, fallaba la
   * comprobacion de formato de abajo y salia un `invalid-argument`. Nadie podia montar
   * un reloj, que es el unico camino para que alguien fiche.
   *
   * Es un desajuste heredado de la migracion —la funcion de Supabase se llamaba igual
   * pero tomaba otro nombre de campo— y no hay compilador que lo vea: el cliente y la
   * funcion se hablan por un objeto sin tipo compartido. La forma de verlo es
   * comparar lo que uno manda con lo que la otra lee, que es lo que se hizo con todas.
   */
  const code = String(request.data?.activationCode ?? '').trim();
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
    },
    /*
     * `policies` VA EN LA RAIZ, y estaba anidado dentro de `location`.
     *
     * El cliente valida la respuesta con Zod y su esquema lo espera aqui, como hermano
     * de `location` —y la demostracion lo devuelve asi tambien, que es por lo que ahi
     * si se podia activar un reloj—. Anidado, la validacion fallaba y el aparato veia
     * «No pudimos completar la accion»... DESPUES de que el servidor hubiera creado el
     * reloj y quemado el codigo. O sea que la activacion funcionaba y el unico que no
     * se enteraba era el aparato que la pedia, que es el que necesita la credencial.
     *
     * De ahi que cada intento dejara un reloj mas en Ajustes y ninguno en el iPad.
     */
    policies: politicasDe(location),
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

  const organizacion = (
    await db.collection(COLLECTIONS.organizations).doc(kiosk.organizationId).get()
  ).data();

  /*
   * LOS PUESTOS, EN DOS CONSULTAS Y NO EN UNA POR PERSONA. Son los que se configuran
   * por empleado en Ajustes, y el reloj los enseña debajo del nombre para distinguir
   * a dos personas que se llaman igual.
   */
  const puestos = new Map<string, string>();
  for (const doc of (
    await db
      .collection(COLLECTIONS.jobRoles)
      .where('organization_id', '==', kiosk.organizationId)
      .get()
  ).docs) {
    puestos.set(doc.id, String(doc.data().name ?? ''));
  }

  const puestoDe = new Map<string, string>();
  for (const doc of (
    await db
      .collection(COLLECTIONS.employeeJobRoles)
      .where('organization_id', '==', kiosk.organizationId)
      .get()
  ).docs) {
    const fila = doc.data();
    const nombre = puestos.get(String(fila.job_role_id));
    if (nombre === undefined) continue;
    // El principal gana; si no hay ninguno marcado, vale el primero que aparezca.
    if (fila.is_primary === true || !puestoDe.has(String(fila.employee_id))) {
      puestoDe.set(String(fila.employee_id), nombre);
    }
  }

  const asignaciones = await db
    .collection(COLLECTIONS.employeeLocations)
    .where('location_id', '==', kiosk.locationId)
    .get();

  const roster = [];
  const verifiers = [];
  for (const asignacion of asignaciones.docs) {
    const employeeId = asignacion.data().employee_id as string;
    const empleado = (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).data();
    if (empleado === undefined || empleado.status !== 'active') continue;

    roster.push({
      opaqueId: employeeId,
      displayName: (empleado.preferred_name as string | null) ?? (empleado.full_name as string),
      jobRoleName: puestoDe.get(employeeId) ?? null,
    });

    /**
     * EL VERIFICADOR DE PIN SIN CONEXION va atado a ESTE dispositivo, con su
     * `offline_key`. Sin ese atado, copiar el archivo SQLite de un iPad a otro
     * daria un verificador utilizable en la otra tienda.
     *
     * NUNCA SE MANDA EL HASH: se manda la sal —que el iPad necesita para poder
     * recalcular bcrypt con el PIN tecleado— y el digest con clave del hash. Con eso
     * el aparato puede comparar, pero no puede probar PIN contra el hash original si
     * alguien se lleva el SQLite sin la clave del Keychain.
     *
     * La cadena `clave:hash` tiene que coincidir byte a byte con `deriveVerifier` de
     * `src/lib/offline/pin.ts`, o el PIN correcto se rechaza sin conexion.
     */
    const credencial = (
      await db.collection(COLLECTIONS.pinCredentials).doc(employeeId).get()
    ).data();
    const hash = credencial?.pin_hash;
    // Sin PIN no hay verificador. Y sin la clave del aparato tampoco: mandar uno
    // derivado de una cadena vacia seria mandar algo que nunca va a casar.
    if (typeof hash !== 'string' || hash.length < 29 || kiosk.offlineKey === '') continue;

    verifiers.push({
      employeeOpaqueId: employeeId,
      pinSalt: salDeBcrypt(hash),
      pinVerifier: verificadorSinConexion(kiosk.offlineKey, hash),
      pinLength: Number(credencial?.pin_length ?? politicasDe(location).pinLength),
      pinVersion: Number(credencial?.pin_version ?? 1),
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

  /*
   * LA FORMA ES LA QUE VALIDA EL RELOJ, y no lo era: esto devolvia `employees` con las
   * politicas metidas dentro de `location`, sin `roster`, sin `verifiers` y sin
   * `refreshedAt`. El esquema de `refreshKioskRoster` exige esas cuatro claves, asi que
   * el refresco fallaba SIEMPRE en la validacion: el iPad no renovaba nunca su lista de
   * gente ni sus verificadores, que es justo lo que le permite fichar sin conexion.
   */
  return {
    location: {
      id: kiosk.locationId,
      name: location.name,
      timezone: location.timezone ?? 'America/Lima',
    },
    organization: {
      name: (organizacion?.name as string | null) ?? null,
      logoPath: (organizacion?.logo_path as string | null) ?? null,
    },
    policies: politicasDe(location),
    roster,
    shifts: turnos.docs
      .filter((doc) => doc.data().status === 'published')
      .map((doc) => ({
        id: doc.id,
        employeeOpaqueId: doc.data().employee_id,
        startsAt: doc.data().starts_at,
        endsAt: doc.data().ends_at,
        jobRoleName: puestos.get(String(doc.data().job_role_id)) ?? null,
        employeeNote: doc.data().employee_note ?? null,
        plannedUnpaidBreakMinutes: doc.data().planned_unpaid_break_minutes ?? 0,
        changedSinceLastPublication: doc.data().changed_since_last_publication === true,
      })),
    verifiers,
    refreshedAt: nowISO(),
  };
});

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

/**
 * ¿Esta este reloj bloqueado por PIN equivocados?
 *
 * La decision vive en `shared/bloqueo.ts`, que es puro y tiene prueba: aqui solo se
 * lee el documento y se traduce a un error.
 */
async function comprobarBloqueo(deviceId: string): Promise<void> {
  const dispositivo = (await db.collection(COLLECTIONS.kioskDevices).doc(deviceId).get()).data();
  const bloqueado = estaBloqueado(
    {
      intentos: Number(dispositivo?.pin_failed_attempts ?? 0),
      ultimoFallo: (dispositivo?.pin_last_failed_at as string | null) ?? null,
      bloqueadoHasta: (dispositivo?.pin_locked_until as string | null) ?? null,
    },
    Date.now(),
  );
  if (bloqueado) {
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
    const siguiente = trasUnFallo(
      {
        intentos: Number(actual.pin_failed_attempts ?? 0),
        ultimoFallo: (actual.pin_last_failed_at as string | null) ?? null,
        bloqueadoHasta: (actual.pin_locked_until as string | null) ?? null,
      },
      Date.now(),
    );
    tx.update(ref, {
      pin_failed_attempts: siguiente.intentos,
      pin_last_failed_at: siguiente.ultimoFallo,
      pin_locked_until: siguiente.bloqueadoHasta,
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

  /*
   * TODO DE UNA VEZ, y antes era un `get()` por persona DENTRO del bucle. Cada uno es
   * un viaje de ida y vuelta a Firestore, asi que el teclado tardaba en proporcion a
   * la plantilla de la tienda: medido contra produccion, 0,60 s con 2 personas y
   * 1,67 s con 12 cuando el PIN no era de nadie —el peor caso, porque recorre la lista
   * entera sin poder cortar—. `getAll` los trae en un solo viaje.
   *
   * Lo que sigue creciendo con la plantilla es bcrypt, y eso no tiene vuelta de hoja:
   * sin saber quien teclea hay que probar contra todos, y que cada prueba sea cara es
   * justo lo que impide reventar seis digitos por fuerza bruta.
   */
  const idsUnicos = [...new Set(asignaciones.docs.map((doc) => String(doc.data().employee_id)))];
  const asignacionPorEmpleado = new Map(
    asignaciones.docs.map((doc) => [String(doc.data().employee_id), doc.data()]),
  );

  let employeeId: string | null = null;
  let asignacion: Record<string, unknown> | null = null;

  // `getAll` sin referencias lanza, y una sede recien abierta no tiene a nadie.
  if (idsUnicos.length > 0) {
    const credenciales = await db.getAll(
      ...idsUnicos.map((id) => db.collection(COLLECTIONS.pinCredentials).doc(id)),
    );

    for (let i = 0; i < idsUnicos.length; i += 1) {
      const credencial = credenciales[i]?.data();
      if (credencial === undefined || typeof credencial.pin_hash !== 'string') continue;

      if (bcrypt.compareSync(pin, credencial.pin_hash)) {
        employeeId = idsUnicos[i]!;
        asignacion = asignacionPorEmpleado.get(employeeId) ?? null;
        break;
      }
    }
  }

  /*
   * QUE SIGA ACTIVO. Esto no se comprobaba, y `refreshKioskRoster` si lo hace: las dos
   * mitades no coincidian. O sea que a quien desactivabas desaparecia de la lista del
   * iPad —y de los verificadores sin conexion— pero SU PIN SEGUIA ABRIENDO EL RELOJ,
   * porque el teclado no necesita la lista. Despedir a alguien no le quitaba las horas:
   * comprobado contra produccion el 22-sep-2026.
   *
   * Y no basta con quitarle la sede al desactivar, porque `setEmployeeStatus` solo
   * cambia el estado —a proposito, para no perder el historial de fichajes—. El sitio
   * donde tiene que cortarse es este, que es por donde pasan todos.
   *
   * SE MIRA DESPUES DEL BUCLE Y SOLO DEL QUE ACERTO: una lectura en vez de una por
   * persona. Dentro del bucle costaba 300 ms mas EN CADA FICHAJE de una tienda de doce.
   * Lo unico que cambia es un caso que ya no deberia existir —dos personas con el mismo
   * PIN, una desactivada y la otra no— porque ahora `setEmployeePin` no reparte PIN
   * repetidos; y ahi lo correcto tambien es rechazar y arreglar el duplicado.
   */
  if (employeeId !== null) {
    const empleado = (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).data();
    if (empleado === undefined || empleado.status !== 'active') {
      employeeId = null;
      asignacion = null;
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

  /*
   * A QUE HORA TERMINA SU JORNADA, que estaba fijo en `null`.
   *
   * `submitTimeEvent` si lo devuelve —lo arreglo fd65ea0— pero aqui no, asi que el reloj
   * lo sabia justo despues de fichar la entrada y lo olvidaba en cuanto la persona
   * volvia al teclado. El mismo campo, correcto en una funcion y muerto en la otra.
   *
   * Y no es un adorno: sin esta hora el reloj no puede saber que alguien esta saliendo
   * antes de tiempo, que es justo lo que hay que detectar para preguntarle por que.
   *
   * El turno sale de la SESION, no de la lista de proximos: al fichar la entrada queda
   * apuntado a cual pertenece, y es el unico que dice cuando termina LA JORNADA EN CURSO.
   */
  const turnoDeLaSesion =
    sesion === undefined || typeof sesion.shift_id !== 'string'
      ? undefined
      : (await db.collection(COLLECTIONS.shifts).doc(sesion.shift_id).get()).data();

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
            shiftEndsAt: (turnoDeLaSesion?.ends_at as string | undefined) ?? null,
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

  const shiftId = (request.data?.shiftId as string | null) ?? null;

  /*
   * LA HORA LA PONE EL SERVIDOR, no el aparato. Esto leia `request.data?.occurredAt`,
   * que el reloj no manda nunca —manda `occurredAtDevice`, que es otra cosa: la hora
   * del iPad, que se guarda aparte justamente para poder comparar—. Y es lo correcto
   * que sea asi: un fichaje EN LINEA se sella con el reloj del servidor, porque un iPad
   * con la hora cambiada a mano seria una hora de entrada cambiada a mano.
   */
  const occurredAt = nowISO();

  const resultado = await recordTimeEvent({
    organizationId: kiosk.organizationId,
    employeeId,
    locationId: kiosk.locationId,
    eventType,
    shiftId,
    breakType: (request.data?.breakType as string | null) ?? null,
    breakReason: (request.data?.breakReason as string | null) ?? null,
    breakNote: (request.data?.breakNote as string | null) ?? null,
    occurredAt,
    occurredAtDevice: (request.data?.occurredAtDevice as string | null) ?? null,
    idempotencyKey,
    deviceId: kiosk.deviceId,
    deviceSequence: Number(request.data?.deviceSequence ?? 0),
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

  /*
   * A que hora termina la jornada. Es lo unico que la pantalla de confirmacion enseña
   * ademas de la hora del fichaje, y salia siempre vacia porque aqui habia un `null`
   * fijo. El turno se saca del que mando el reloj, y si no mando ninguno, del que
   * quedo apuntado en la sesion al fichar la entrada.
   */
  const turnoId = shiftId ?? (sesion?.shift_id as string | null) ?? null;
  const turno =
    turnoId === null
      ? undefined
      : (await db.collection(COLLECTIONS.shifts).doc(turnoId).get()).data();

  /*
   * LA FORMA ES LA QUE VALIDA EL RELOJ. Esto devolvia `duplicated` y `session`, y el
   * esquema del cliente exige `status`, `occurredAt`, `serverReceivedAt`, `flags` y
   * `summary`. O sea que TODO FICHAJE quedaba registrado en la base y el iPad lo daba
   * por fallido: la persona veia «No pudimos completar la accion» despues de haber
   * fichado de verdad, y volvia a intentarlo. Es el fallo mas caro de los que habia,
   * porque fichar es para lo unico que existe la aplicacion.
   */
  return {
    status: resultado.duplicated ? ('duplicate' as const) : ('accepted' as const),
    eventId: resultado.eventId,
    attendanceState: resultado.state,
    occurredAt,
    serverReceivedAt: nowISO(),
    // Las marcas las pone la proyeccion de la sesion —llegada tarde, turno sin
    // planificar—, no este fichaje: se devuelven las que ya tenga.
    flags: ((sesion?.flags as string[] | undefined) ?? []).map(String),
    summary: {
      shiftEndsAt: (turno?.ends_at as string | undefined) ?? null,
      netMinutesToday: Math.max(0, (sesion?.net_minutes as number | null) ?? 0),
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

  /**
   * QUIEN FICHO SIN CONEXION NO TIENE TOKEN DE ACCION, y exigirselo era imposible de
   * cumplir: el token lo emite `verifyPin`, que es una llamada de red, y estos eventos
   * se guardaron precisamente porque no habia red. Asi que cada evento del lote
   * fallaba con «Vuelve a marcar tu PIN» y la cola no se vaciaba nunca: una tienda con
   * el wifi caido una tarde perdia la tarde entera.
   *
   * Lo que autentica aqui son dos cosas distintas:
   *   - el APARATO, por su credencial, que ya comprobo `authenticateKiosk`;
   *   - la PERSONA, por el verificador sin conexion que el propio servidor le entrego
   *     a este dispositivo, derivado con su `offline_key` (ver `refreshKioskRoster`).
   *
   * Y se comprueba que la persona siga asignada A ESTA TIENDA, que es lo que el token
   * garantizaba: sin eso, un id de empleado inventado en el JSON ficharia a cualquiera.
   */
  const deLaTienda = new Set(
    (
      await db
        .collection(COLLECTIONS.employeeLocations)
        .where('location_id', '==', kiosk.locationId)
        .get()
    ).docs.map((doc) => String(doc.data().employee_id)),
  );

  const resultados = [];
  for (const evento of ordenados) {
    const idempotencyKey = String(evento?.idempotencyKey ?? '');
    const employeeId = String(evento?.employeeOpaqueId ?? '');

    if (evento?.offlineVerified !== true || !deLaTienda.has(employeeId)) {
      resultados.push({
        idempotencyKey,
        status: 'rejected' as const,
        reason: 'Ese fichaje no es de alguien de esta tienda.',
      });
      continue;
    }

    try {
      const resultado = await recordTimeEvent({
        organizationId: kiosk.organizationId,
        employeeId,
        locationId: kiosk.locationId,
        eventType: String(evento.eventType) as TimeEventType,
        shiftId: (evento.shiftId as string | null) ?? null,
        breakType: evento.breakType ?? null,
        breakReason: evento.breakReason ?? null,
        breakNote: evento.breakNote ?? null,
        /*
         * AQUI SI MANDA EL RELOJ DEL IPAD, al reves que en un fichaje en linea. Es el
         * unico dato que hay de cuando paso: el servidor se entera horas despues, y
         * sellarlo con su propia hora pondria la entrada de las 8 a las 14. Se
         * guardan las dos, y `is_offline` deja dicho cual es cual.
         */
        occurredAt: String(evento.occurredAtDevice ?? nowISO()),
        occurredAtDevice: (evento.occurredAtDevice as string | null) ?? null,
        idempotencyKey,
        deviceId: kiosk.deviceId,
        deviceSequence: Number(evento.deviceSequence ?? 0),
        isOffline: true,
        source: 'kiosk',
      });
      resultados.push({
        idempotencyKey,
        status: resultado.duplicated ? ('duplicate' as const) : ('accepted' as const),
        attendanceState: resultado.state,
        eventId: resultado.eventId,
      });
    } catch (error) {
      /*
       * `needs_review` Y NO `rejected`: una transicion invalida al sincronizar casi
       * siempre es un fichaje que le falta al otro lado —la salida de ayer que se
       * quedo en un iPad apagado—, no un intento de colar algo. Rechazarlo lo borra de
       * la cola y pierde la hora trabajada; marcarlo lo deja para que un encargado lo
       * mire. Ver `backoff.ts`, que ya distingue los dos casos en el aparato.
       */
      resultados.push({
        idempotencyKey,
        status: 'needs_review' as const,
        reason: error instanceof HttpsError ? error.message : 'Error desconocido',
      });
    }
  }

  await db
    .collection(COLLECTIONS.kioskDevices)
    .doc(kiosk.deviceId)
    .update({ last_sync_at: nowISO(), last_seen_at: nowISO() });

  return {
    results: resultados,
    // El esquema del cliente exige las dos, y sin ellas la respuesta entera se
    // descartaba: el iPad daba por fallido un lote que el servidor habia guardado.
    accepted: resultados.filter((r) => r.status === 'accepted' || r.status === 'duplicate').length,
    // Nada queda a medias: el bucle resuelve todos los eventos del lote.
    pending: 0,
    syncedAt: nowISO(),
  };
});

/**
 * La fecha de la jornada, en la zona de la TIENDA y no en UTC.
 *
 * Importa en los turnos de tarde: en Lima —UTC-5— un fichaje a las 20:00 del lunes es
 * la 01:00 del martes en UTC. Cortar la cadena ISO daria el dia siguiente, y la
 * solicitud aparecería en la Bandeja fechada un dia despues de cuando paso.
 */
function fechaLocal(iso: string | null, zona: string): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // `en-CA` da exactamente `AAAA-MM-DD`, que es el formato que usa `target_date`.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(d);
}

export const submitTimeEditRequest = onCall(OPCIONES_CON_SECRETO, async (request) => {
  const kiosk = await authenticateKiosk(request.data);
  const employeeId = exigirTokenDeAccion(request.data, kiosk);

  const reason = String(request.data?.reason ?? '').trim();
  if (reason === '') {
    throw new HttpsError('invalid-argument', 'Hay que explicar qué pasó.');
  }

  const propuesta = (request.data?.proposedAt as string | undefined) ?? null;
  const zonaDeLaSede =
    ((await db.collection(COLLECTIONS.locations).doc(kiosk.locationId).get()).data()?.timezone as
      string | undefined) ?? 'America/Lima';

  const doc = await db.collection(COLLECTIONS.timeEditRequests).add({
    organization_id: kiosk.organizationId,
    employee_id: employeeId,
    location_id: kiosk.locationId,
    /*
     * SIEMPRE NULO, y leia `request.data?.workSessionId`, que el reloj no manda: una
     * solicitud de «Olvide marcar» se escribe justamente cuando NO hay sesion que
     * corregir. Quien la aprueba la ata a la jornada por `target_date`.
     */
    work_session_id: null,
    /*
     * `proposedAt`, QUE ES LO QUE MANDA EL RELOJ. Esto leia `proposedValue` y
     * `targetDate`, que el cliente no envia nunca, asi que toda solicitud de «Olvide
     * marcar» se guardaba con `proposed_value: {}` y `target_date: null`: la Bandeja
     * enseñaba una peticion sin hora que aprobar y sin fecha a la que referirse.
     *
     * `proposed_value.proposedAt` es la clave exacta que lee la Bandeja al aprobar
     * —ver `proposedStart` en `features/requests/api.ts`—, asi que se guarda con ese
     * nombre y no con otro.
     */
    target_date: fechaLocal(propuesta, zonaDeLaSede),
    kind: String(request.data?.kind ?? 'correction'),
    proposed_value: propuesta === null ? {} : { proposedAt: propuesta },
    reason,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    reviewer_comment: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  // `status` lo exige el esquema del cliente, y sin el la solicitud se creaba pero el
  // reloj decia «No pudimos completar la accion»: la persona la mandaba tres veces.
  return { requestId: doc.id, status: 'pending' as const };
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

  return { ok: true as const, photoPath: ruta };
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
