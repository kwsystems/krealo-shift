import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db } from './shared/admin';
import { membershipOf, requireManagesLocation, requireUid } from './shared/caller';
import { zonaSegura } from './shared/zonas';

/**
 * LAS CORRECCIONES DE HORA DE UN PERIODO, una fila por corrección (30-sep).
 *
 * POR QUÉ EXISTE. La lista de la semana de prueba pide, al final de la semana, «cuántas
 * correcciones de hora hubo y de qué tipo»: cada una es un fichaje que el reloj no recogió
 * bien, y es de lo más revelador de la prueba. La app no lo contaba en ningún sitio.
 *
 * LA TRAMPA DE LOS DATOS: `time_adjustments` no guardaba la sede, y muchas filas tampoco la
 * jornada —«Agregar fichaje manual» escribe `work_session_id: null`—. Desde hoy las nuevas
 * llevan `location_id`; para las de antes la sede se deduce de su jornada o de su fichaje,
 * sin reescribir nada.
 *
 * CADA UNA CUENTA EN EL DÍA QUE CORRIGE, no en el día en que se hizo. Si el lunes se arregla
 * la salida del viernes, es una corrección de las horas del viernes, y es en esa semana
 * donde se busca. Contar por fecha de creación metería en esta semana todo lo que se
 * registró hoy desde el horario de septiembre.
 *
 * Devuelve filas y no totales para que Reportes las filtre por persona, como filtra lo demás.
 */

export const TIPOS_DE_CORRECCION = [
  'fichaje_anadido',
  'hora_corregida',
  'salida_a_pausa',
  'solicitud_aprobada',
  'segun_horario',
  /** Un turno dado por cumplido por un motivo especial (4-oct): ver `cumplido-especial.ts`. */
  'cumplido_especial',
  /** La salida que puso el sistema a quien no marcó (5-oct): ver `cierre-automatico.ts`. */
  'salida_automatica',
] as const;
export type TipoDeCorreccion = (typeof TIPOS_DE_CORRECCION)[number];

type Fila = Record<string, unknown>;
const objeto = (valor: unknown): Fila =>
  typeof valor === 'object' && valor !== null ? (valor as Fila) : {};

/** Qué clase de corrección es, por lo que dejó escrito quien la hizo. */
export function tipoDeCorreccion(fila: Fila): TipoDeCorreccion {
  const despues = objeto(fila.after_value);
  if (typeof fila.request_id === 'string' && fila.request_id !== '') return 'solicitud_aprobada';
  if (despues.origen === 'horario') return 'segun_horario';
  if (despues.origen === 'especial') return 'cumplido_especial';
  if (despues.origen === 'salida_automatica') return 'salida_automatica';
  if (typeof despues.reclassified_as === 'string') return 'salida_a_pausa';
  if (fila.target_type === 'time_event') return 'fichaje_anadido';
  return 'hora_corregida';
}

/** El instante que corrige: el fichaje añadido, la jornada ajustada o la salida convertida. */
export function instanteCorregido(fila: Fila): string | null {
  const despues = objeto(fila.after_value);
  const antes = objeto(fila.before_value);
  for (const valor of [
    despues.occurred_at,
    despues.starts_at,
    antes.occurred_at,
    antes.starts_at,
    fila.created_at,
  ]) {
    if (typeof valor === 'string' && !Number.isNaN(Date.parse(valor))) return valor;
  }
  return null;
}

function diaEn(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const viewCorrectionsSummary = onCall(async (request) => {
  const uid = requireUid(request);
  const locationId = String(request.data?.p_location_id ?? '').trim();
  const desde = String(request.data?.p_from ?? '');
  const hasta = String(request.data?.p_to ?? '');
  if (locationId === '' || !DIA.test(desde) || !DIA.test(hasta)) {
    throw new HttpsError('invalid-argument', 'Faltan la sede o el periodo (AAAA-MM-DD).');
  }

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  if (location === undefined) throw new HttpsError('not-found', 'Esa ubicación no existe.');
  const organizationId = String(location.organization_id);
  requireManagesLocation(await membershipOf(uid, organizationId), locationId);
  const zona = zonaSegura(location.timezone ?? 'America/Lima', 'viewCorrectionsSummary');

  /*
   * Una corrección siempre se hace DESPUÉS de lo que corrige, así que basta con las creadas
   * desde un día antes del periodo (el día de margen es por la zona horaria). Sin tope por
   * arriba: la del viernes arreglada el lunes siguiente también es de esta semana.
   */
  const desdeIso = new Date(Date.parse(`${desde}T00:00:00.000Z`) - 24 * 3600_000).toISOString();
  const snapshot = await db
    .collection(COLLECTIONS.timeAdjustments)
    .where('organization_id', '==', organizationId)
    .where('created_at', '>=', desdeIso)
    .get();

  const sesiones = new Map<string, Fila | null>();
  const eventos = new Map<string, Fila | null>();
  const leer = async (cache: Map<string, Fila | null>, coleccion: string, id: string) => {
    if (!cache.has(id)) {
      cache.set(id, (await db.collection(coleccion).doc(id).get()).data() ?? null);
    }
    return cache.get(id) ?? null;
  };

  const filas: {
    tipo: TipoDeCorreccion;
    employee_id: string | null;
    created_by: string | null;
    work_date: string;
  }[] = [];

  for (const doc of snapshot.docs) {
    const fila = doc.data();
    const instante = instanteCorregido(fila);
    if (instante === null) continue;
    const dia = diaEn(instante, zona);
    if (dia < desde || dia > hasta) continue;

    // De quién y de qué sede: de la fila si lo trae, y si no, de su jornada o su fichaje.
    const sesion =
      typeof fila.work_session_id === 'string'
        ? await leer(sesiones, COLLECTIONS.workSessions, fila.work_session_id)
        : null;
    const evento =
      fila.target_type === 'time_event' && typeof fila.target_id === 'string'
        ? await leer(eventos, COLLECTIONS.timeEvents, fila.target_id)
        : null;
    const sede = fila.location_id ?? sesion?.location_id ?? evento?.location_id ?? null;
    if (sede !== locationId) continue;

    filas.push({
      tipo: tipoDeCorreccion(fila),
      employee_id:
        (fila.employee_id as string | undefined) ??
        (sesion?.employee_id as string | undefined) ??
        (evento?.employee_id as string | undefined) ??
        null,
      created_by: typeof fila.created_by === 'string' ? fila.created_by : null,
      work_date: dia,
    });
  }

  // El autor, por su nombre; `null` si ya no está o lo escribió el sistema.
  const autores: Record<string, string | null> = {};
  for (const autor of new Set(filas.map((fila) => fila.created_by))) {
    if (autor === null) continue;
    const perfil = (await db.collection(COLLECTIONS.profiles).doc(autor).get()).data();
    const nombre = perfil?.full_name as string | undefined;
    autores[autor] = nombre !== undefined && nombre !== '' ? nombre : null;
  }

  return {
    filas: filas.map((fila) => ({
      tipo: fila.tipo,
      employee_id: fila.employee_id,
      work_date: fila.work_date,
      author_name: fila.created_by === null ? null : (autores[fila.created_by] ?? null),
    })),
  };
});
