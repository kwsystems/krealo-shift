import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { COLLECTIONS, db } from './shared/admin';
import { tipoEfectivo } from './shared/eventos';
import { zonaSegura } from './shared/zonas';
import { membershipOf, requireManagesLocation, requireRole, requireUid } from './shared/caller';

/**
 * Las cinco VISTAS de Postgres, servidas como funciones.
 *
 * Firestore no une ni agrupa. «Quien esta trabajando ahora» cruza sesiones con
 * empleados; «resumen diario» suma minutos por persona y dia; «correcciones con
 * autor» traduce un uid a un nombre que el cliente no puede leer. Nada de eso cabe
 * en una consulta de Firestore, asi que cada vista es una funcion que devuelve
 * EXACTAMENTE las mismas filas que devolvia la vista SQL — los esquemas Zod de la
 * app no se tocaron y siguen validando lo que llega.
 *
 * TODAS COMPRUEBAN EL PERMISO POR DENTRO. Las vistas de Postgres eran
 * `security_invoker = true`, o sea que la RLS de quien preguntaba se aplicaba sola.
 * Aqui no hay nada que se aplique solo: el Admin SDK lo ve todo, y una vista que no
 * filtre por quien pregunta es una filtracion de las horas de toda la empresa.
 */

type Filtro = { field: string; op: string; value: unknown };
type PeticionVista = { filters?: Filtro[]; order?: { field: string; ascending: boolean }[] };

function valorDe(peticion: PeticionVista, field: string, op = 'eq'): unknown {
  return peticion.filters?.find((f) => f.field === field && f.op === op)?.value;
}

function textoRequerido(peticion: PeticionVista, field: string, op = 'eq'): string {
  const valor = valorDe(peticion, field, op);
  if (typeof valor !== 'string' || valor === '') {
    throw new HttpsError('invalid-argument', `Falta el filtro «${field}».`);
  }
  return valor;
}

/** El dia local de un instante, en la zona de la ubicacion. */
function claveDeDia(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    // Una zona mal escrita en la base tumbaba la consulta entera. Ver `shared/zonas.ts`.
    timeZone: zonaSegura(timezone, 'claveDeDia'),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

async function ubicacion(locationId: string) {
  const snapshot = await db.collection(COLLECTIONS.locations).doc(locationId).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Esa ubicación no existe.');
  return snapshot.data() ?? {};
}

/** Comprueba que quien llama administre la ubicacion que pide. */
async function autorizarUbicacion(request: CallableRequest, locationId: string) {
  const uid = requireUid(request);
  const location = await ubicacion(locationId);
  const membership = await membershipOf(uid, location.organization_id as string);
  requireManagesLocation(membership, locationId);
  return { membership, location };
}

// ---------------------------------------------------------------------------

export const viewEmployeesWorkingNow = onCall(async (request) => {
  const peticion = (request.data ?? {}) as PeticionVista;
  const locationId = textoRequerido(peticion, 'location_id');
  const { membership } = await autorizarUbicacion(request, locationId);

  const abiertas = await db
    .collection(COLLECTIONS.workSessions)
    .where('organization_id', '==', membership.organizationId)
    .where('location_id', '==', locationId)
    .where('status', '==', 'open')
    .get();

  const filas = await Promise.all(
    abiertas.docs.map(async (doc) => {
      const sesion = doc.data();
      const empleado = (
        await db
          .collection(COLLECTIONS.employees)
          .doc(sesion.employee_id as string)
          .get()
      ).data();

      /**
       * La pausa abierta se busca por el ULTIMO evento de pausa, no contando pares.
       * Contar pares parece mas limpio y falla con el evento que falta: si alguien
       * marco inicio de pausa y el iPad se quedo sin bateria, el conteo dice «no hay
       * pausa» y el panel lo pinta trabajando.
       */
      const eventos = await db
        .collection(COLLECTIONS.timeEvents)
        .where('employee_id', '==', sesion.employee_id)
        .where('occurred_at', '>=', sesion.starts_at)
        .orderBy('occurred_at', 'desc')
        .limit(20)
        .get();

      const ultimaPausa = eventos.docs
        .map((e) => e.data())
        .find((e) => tipoEfectivo(e) === 'break_start' || tipoEfectivo(e) === 'break_end');

      const enPausa = ultimaPausa !== undefined && tipoEfectivo(ultimaPausa) === 'break_start';

      return {
        work_session_id: doc.id,
        employee_id: sesion.employee_id,
        full_name: empleado?.full_name ?? '',
        preferred_name: empleado?.preferred_name ?? null,
        starts_at: sesion.starts_at,
        shift_id: sesion.shift_id ?? null,
        break_started_at: enPausa ? ultimaPausa?.occurred_at : null,
        attendance_state: enPausa ? 'ON_BREAK' : 'WORKING',
      };
    }),
  );

  return filas.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
});

export const viewDailyTimeSummary = onCall(async (request) => {
  const peticion = (request.data ?? {}) as PeticionVista;
  const locationId = textoRequerido(peticion, 'location_id');
  const desde = textoRequerido(peticion, 'work_date', 'gte');
  const hasta = textoRequerido(peticion, 'work_date', 'lte');
  const { location } = await autorizarUbicacion(request, locationId);
  const zona = (location.timezone as string | undefined) ?? 'America/Lima';

  /**
   * Se pide UN DIA DE MAS POR CADA LADO, y luego se recorta por dia local.
   *
   * La consulta filtra por instante y el resultado se agrupa por dia de la tienda.
   * En Lima (UTC-5) una sesion que empieza a las 20:00 del dia 3 es el 4 en UTC, y
   * una que empieza a las 02:00 del 4 en UTC es todavia el 3 en la tienda. Cortar
   * justo en el instante del rango dejaria fuera turnos de noche que SI pertenecen
   * a los dias que se pidieron. El margen los trae y el filtro de abajo descarta lo
   * que sobra.
   */
  const MARGEN_MS = 24 * 60 * 60 * 1000;
  const desplazar = (iso: string, ms: number) =>
    new Date(new Date(iso).getTime() + ms).toISOString();

  const sesiones = await db
    .collection(COLLECTIONS.workSessions)
    .where('location_id', '==', locationId)
    .where('starts_at', '>=', desplazar(`${desde}T00:00:00.000Z`, -MARGEN_MS))
    .where('starts_at', '<=', desplazar(`${hasta}T23:59:59.999Z`, MARGEN_MS))
    .get();

  const porClave = new Map<string, Record<string, unknown>>();

  for (const doc of sesiones.docs) {
    const sesion = doc.data();
    const dia = claveDeDia(sesion.starts_at as string, zona);
    if (dia < desde || dia > hasta) continue;

    const clave = `${sesion.employee_id as string}_${dia}`;
    const actual = porClave.get(clave) ?? {
      employee_id: sesion.employee_id,
      location_id: locationId,
      work_date: dia,
      sessions: 0,
      gross_minutes: 0,
      paid_break_minutes: 0,
      unpaid_break_minutes: 0,
      net_minutes: 0,
      needs_review: false,
      flags: [] as string[],
    };

    actual.sessions = (actual.sessions as number) + 1;
    actual.gross_minutes =
      (actual.gross_minutes as number) + ((sesion.gross_minutes as number) ?? 0);
    actual.paid_break_minutes =
      (actual.paid_break_minutes as number) + ((sesion.paid_break_minutes as number) ?? 0);
    actual.unpaid_break_minutes =
      (actual.unpaid_break_minutes as number) + ((sesion.unpaid_break_minutes as number) ?? 0);
    actual.net_minutes = (actual.net_minutes as number) + ((sesion.net_minutes as number) ?? 0);
    actual.needs_review = (actual.needs_review as boolean) || sesion.status === 'needs_review';
    actual.flags = [...(actual.flags as string[]), ...((sesion.flags as string[]) ?? [])];

    porClave.set(clave, actual);
  }

  return [...porClave.values()].sort((a, b) =>
    String(a.work_date).localeCompare(String(b.work_date)),
  );
});

export const viewTimeAdjustmentsWithAuthor = onCall(async (request) => {
  const peticion = (request.data ?? {}) as PeticionVista;
  const uid = requireUid(request);
  const sessionIds = valorDe(peticion, 'work_session_id', 'in');
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return [];

  /*
   * LA ORGANIZACION SALE DE LAS SESIONES QUE SE PIDEN, no de «la unica membresia».
   *
   * Esto usaba `soleMembership`, que se queda con la MAS VIEJA de las membresias activas
   * y descarta el resto en silencio. Con una sola organizacion daba igual; con dos, quien
   * pertenece a las dos miraria la hoja de horas de la segunda y esta consulta filtraria
   * por la PRIMERA: el historial de correcciones saldria vacio, sin error y sin pista.
   * No es una fuga —el filtro sigue atando a una organizacion— pero es contestar sobre
   * otra cosa, que es el patron que este proyecto lleva toda la semana persiguiendo.
   *
   * Se lee una sesion, se mira de quien es, y se comprueba la membresia ALLI.
   */
  const primera = await db.collection(COLLECTIONS.workSessions).doc(String(sessionIds[0])).get();
  const organizationId = primera.data()?.organization_id as string | undefined;
  if (organizationId === undefined) return [];

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin', 'manager']);

  /**
   * `in` de Firestore admite 30 valores por consulta, asi que se parte en trozos.
   * La hoja de horas de una semana pasa de 30 sesiones con facilidad, y sin
   * trocear la consulta falla con un error de argumento que no dice cual es el
   * limite.
   */
  const trozos: string[][] = [];
  for (let i = 0; i < sessionIds.length; i += 30) {
    trozos.push(sessionIds.slice(i, i + 30) as string[]);
  }

  const filas: Record<string, unknown>[] = [];
  for (const trozo of trozos) {
    const encontrados = await db
      .collection(COLLECTIONS.timeAdjustments)
      .where('organization_id', '==', organizationId)
      .where('work_session_id', 'in', trozo)
      .get();
    for (const doc of encontrados.docs) filas.push({ id: doc.id, ...doc.data() });
  }

  /**
   * El autor se resuelve a un NOMBRE, y `null` cuando no se puede: lo hizo alguien
   * que ya no esta en la organizacion, o lo escribio una funcion del sistema sin
   * usuario. La pantalla lo pinta como «—» y no inventa un nombre.
   */
  const autores = new Map<string, string | null>();
  for (const fila of filas) {
    const autorId = fila.created_by as string | null;
    if (autorId === null || autorId === undefined || autores.has(autorId)) continue;
    const perfil = await db.collection(COLLECTIONS.profiles).doc(autorId).get();
    const nombre = perfil.data()?.full_name as string | undefined;
    autores.set(autorId, nombre !== undefined && nombre !== '' ? nombre : null);
  }

  return filas
    .map((fila): Record<string, unknown> => ({
      ...fila,
      author_name: autores.get(fila.created_by as string) ?? null,
    }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
});

export const viewBreakTimeByReason = onCall(async (request) => {
  const peticion = (request.data ?? {}) as PeticionVista;
  const locationId = textoRequerido(peticion, 'location_id');
  const desde = textoRequerido(peticion, 'work_date', 'gte');
  const hasta = textoRequerido(peticion, 'work_date', 'lte');
  const { membership, location } = await autorizarUbicacion(request, locationId);
  const zona = (location.timezone as string | undefined) ?? 'America/Lima';

  const eventos = await db
    .collection(COLLECTIONS.timeEvents)
    .where('organization_id', '==', membership.organizationId)
    .where('location_id', '==', locationId)
    .where('occurred_at', '>=', `${desde}T00:00:00.000Z`)
    .where('occurred_at', '<=', `${hasta}T23:59:59.999Z`)
    .orderBy('occurred_at', 'asc')
    .get();

  const porEmpleado = new Map<string, Record<string, unknown>[]>();
  for (const doc of eventos.docs) {
    const evento = doc.data();
    const tipo = tipoEfectivo(evento);
    if (tipo !== 'break_start' && tipo !== 'break_end') continue;
    const lista = porEmpleado.get(evento.employee_id as string) ?? [];
    lista.push(evento);
    porEmpleado.set(evento.employee_id as string, lista);
  }

  const agregado = new Map<string, Record<string, unknown>>();

  for (const [employeeId, lista] of porEmpleado) {
    let inicio: Record<string, unknown> | null = null;
    for (const evento of lista) {
      // `tipoEfectivo` otra vez y no la variable de arriba: ahi hay un `tipo` distinto
      // —el `break_type` de nomina— y el compilador lo cazo al primer intento.
      if (tipoEfectivo(evento) === 'break_start') {
        inicio = evento;
        continue;
      }
      if (inicio === null) continue;

      const minutos = Math.floor(
        (new Date(String(evento.occurred_at)).getTime() -
          new Date(String(inicio.occurred_at)).getTime()) /
          60000,
      );
      const dia = claveDeDia(String(inicio.occurred_at), zona);
      const motivo = (inicio.break_reason as string | null) ?? 'other';
      const tipo = (inicio.break_type as string | null) ?? null;
      const clave = `${employeeId}_${dia}_${motivo}`;

      const actual = agregado.get(clave) ?? {
        employee_id: employeeId,
        work_date: dia,
        break_reason: motivo,
        break_type: tipo,
        minutes: 0,
        pauses: 0,
        notes: [] as { at: string; minutes: number; note: string }[],
      };
      actual.minutes = (actual.minutes as number) + minutos;
      actual.pauses = (actual.pauses as number) + 1;

      /*
       * LA NOTA DE LA PAUSA, que hasta ahora se guardaba y no la leia nadie.
       *
       * Al pausar por «Otro» la app OBLIGA a escribir un motivo, y ese texto viaja en el
       * propio evento `break_start` que este bucle ya esta leyendo. Pero la vista solo
       * devolvia minutos, asi que Reportes enseñaba «Otro: 45 min» sin las explicaciones
       * detras. Se le estaba pidiendo a la gente que escribiera algo cada vez que se
       * ausentaba por un motivo raro a cambio de nada, y eso es peor que no pedirlo:
       * enseña que la app pide cosas que no sirven.
       *
       * VA AQUI Y NO EN UNA FUNCION NUEVA porque el evento ya esta en la mano: sacarlo
       * aparte serian dos lecturas del mismo rango para el mismo dato.
       *
       * Quien recibe esto es exactamente quien ya podia ver la vista —`autorizarUbicacion`
       * corre arriba—, o sea un encargado de ESA sede. No se añade audiencia.
       */
      const nota = typeof inicio.break_note === 'string' ? inicio.break_note.trim() : '';
      if (nota !== '') {
        (actual.notes as { at: string; minutes: number; note: string }[]).push({
          at: String(inicio.occurred_at),
          minutes: minutos,
          // El teclado del reloj ya corta en 500; esto es el cinturon por si un evento
          // viejo o la cola sin conexion trajera algo mas largo.
          note: nota.slice(0, 500),
        });
      }

      agregado.set(clave, actual);
      inicio = null;
    }
  }

  return [...agregado.values()];
});

export const viewKioskDevicesAdmin = onCall(async (request) => {
  const peticion = (request.data ?? {}) as PeticionVista;
  const uid = requireUid(request);
  const organizationId = textoRequerido(peticion, 'organization_id');
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin', 'manager']);

  const dispositivos = await db
    .collection(COLLECTIONS.kioskDevices)
    .where('organization_id', '==', organizationId)
    .get();

  const ubicaciones = new Map<string, string>();
  const ahora = Date.now();

  const filas = await Promise.all(
    dispositivos.docs
      .filter(
        (doc) =>
          membership.role === 'owner' ||
          membership.role === 'admin' ||
          membership.managedLocationIds.includes(doc.data().location_id as string),
      )
      .map(async (doc) => {
        const dispositivo = doc.data();
        const locationId = dispositivo.location_id as string;
        if (!ubicaciones.has(locationId)) {
          const snapshot = await db.collection(COLLECTIONS.locations).doc(locationId).get();
          ubicaciones.set(locationId, (snapshot.data()?.name as string | undefined) ?? '');
        }

        const minutosDesde = (valor: unknown): number | null =>
          typeof valor === 'string'
            ? Math.floor((ahora - new Date(valor).getTime()) / 60000)
            : null;

        return {
          id: doc.id,
          display_name: (dispositivo.display_name as string | undefined) ?? 'iPad',
          location_id: locationId,
          location_name: ubicaciones.get(locationId) ?? '',
          device_public_id: dispositivo.device_public_id,
          status: dispositivo.status,
          app_version: dispositivo.app_version ?? null,
          last_seen_at: dispositivo.last_seen_at ?? null,
          last_sync_at: dispositivo.last_sync_at ?? null,
          /**
           * NUNCA `null`: es lo que mide el aviso de «reloj sin sincronizar». Un
           * kiosco que jamas contacto cuenta desde su creacion, no desde nunca, para
           * que un iPad activado y abandonado aparezca como lo que es.
           */
          minutes_since_seen:
            minutosDesde(dispositivo.last_seen_at) ?? minutosDesde(dispositivo.created_at) ?? 0,
          /**
           * `null` es el caso NORMAL Y BUENO en una tienda con red estable: solo lo
           * escribe la sincronizacion sin conexion, asi que un iPad con buen wifi no
           * lo tiene nunca. Leerlo como problema hacia disparar la alerta a diario.
           */
          minutes_since_sync: minutosDesde(dispositivo.last_sync_at),
        };
      }),
  );

  return filas.sort(
    (a, b) =>
      String(a.location_name).localeCompare(String(b.location_name)) ||
      String(a.display_name).localeCompare(String(b.display_name)),
  );
});
