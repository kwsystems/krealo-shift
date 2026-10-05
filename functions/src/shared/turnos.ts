import { COLLECTIONS, db, nowISO } from './admin';
import { marcasDeLaSesion, marcasDentroDelTurno, type MarcaDeSesion } from './marcas';
import { politicasDe } from './politicas';

/**
 * EL TURNO DE UNA JORNADA, que no es siempre el que se eligió al fichar (30-sep).
 *
 * POR QUÉ EXISTE. Andree cambió el turno de una vendedora, lo publicó, le aprobó la
 * marcación, y Horas seguía diciendo «Sin turno programado». La jornada guardaba el turno
 * —y sus marcas— del momento de fichar: si a esa hora no había turno publicado, o era otro,
 * se quedaba así para siempre. Nada la volvía a mirar al publicar, y lo que depende de ese
 * dato —«a tiempo», las tardanzas de Reportes, el bono— quedaba igual de viejo.
 *
 * Ahora vale el que ELIGIÓ si sigue en pie, y si no —no eligió ninguno, o se canceló— el
 * turno PUBLICADO que le corresponde: el que más se solapa con la jornada, o, si ninguno
 * se solapa, el que empieza más cerca de su entrada dentro de tres horas. Ni un borrador
 * —todavía no es un turno que la persona conozca— ni uno de otra sede.
 */

export type TurnoDeJornada = { id: string; starts_at: string; ends_at: string };

const HORA_MS = 3600_000;
/** Lo más lejos que puede empezar un turno de la entrada para contar como suyo sin solaparse. */
const CERCANIA_MAXIMA_MS = 3 * HORA_MS;
/** Cuánto antes y después de la entrada se buscan turnos: cubre el turno de noche. */
const VENTANA_DE_BUSQUEDA_MS = 16 * HORA_MS;

/** Elige entre turnos publicados de la persona. PURA, para poder probar cada caso. */
export function elegirTurno(
  turnos: readonly TurnoDeJornada[],
  entrada: string,
  salida: string | null,
  ahora: string = nowISO(),
): TurnoDeJornada | null {
  const inicio = Date.parse(entrada);
  // Una jornada abierta dura, de momento, hasta ahora; y nunca menos de un minuto.
  const fin = Math.max(Date.parse(salida ?? ahora), inicio + 60_000);

  let mejor: { turno: TurnoDeJornada; solape: number; distancia: number } | null = null;
  for (const turno of turnos) {
    const desde = Date.parse(turno.starts_at);
    const hasta = Date.parse(turno.ends_at);
    if (Number.isNaN(desde) || Number.isNaN(hasta)) continue;
    const solape = Math.max(0, Math.min(fin, hasta) - Math.max(inicio, desde));
    const distancia = Math.abs(desde - inicio);
    if (solape === 0 && distancia > CERCANIA_MAXIMA_MS) continue;
    const gana =
      mejor === null ||
      solape > mejor.solape ||
      (solape === mejor.solape && distancia < mejor.distancia);
    if (gana) mejor = { turno, solape, distancia };
  }
  return mejor?.turno ?? null;
}

/** El turno de la jornada: el elegido si sigue en pie; si no, el publicado que le toca. */
export async function turnoDeLaJornada(params: {
  employeeId: string;
  locationId: string;
  turnoElegido: string | null;
  entrada: string;
  salida: string | null;
}): Promise<TurnoDeJornada | null> {
  if (params.turnoElegido !== null) {
    const elegido = (await db.collection(COLLECTIONS.shifts).doc(params.turnoElegido).get()).data();
    /*
     * Y QUE SEA DE ESA JORNADA (4-oct). El reloj ofrecía el turno de hoy y el de mañana sin
     * decir el día, y si había uno solo —el de mañana— lo elegía por la persona. Una
     * entrada de hoy quedaba atada al turno de mañana: hoy salía como falta, mañana como
     * cubierto, y las marcas medían una tardanza de un día entero. El elegido vale si
     * empieza dentro de la misma ventana en la que se buscan los candidatos; si no, se
     * busca el que le toca, como cuando no se elige ninguno.
     */
    const cerca =
      elegido !== undefined &&
      Math.abs(Date.parse(String(elegido.starts_at)) - Date.parse(params.entrada)) <=
        VENTANA_DE_BUSQUEDA_MS;
    if (elegido !== undefined && elegido.status !== 'cancelled' && cerca) {
      return {
        id: params.turnoElegido,
        starts_at: String(elegido.starts_at),
        ends_at: String(elegido.ends_at),
      };
    }
  }

  const inicio = Date.parse(params.entrada);
  const candidatos = await db
    .collection(COLLECTIONS.shifts)
    .where('employee_id', '==', params.employeeId)
    // Con `status` en la consulta usa el índice (employee_id, status, starts_at), que ya
    // existe: sin él, producción pediría uno nuevo y el emulador —que no los exige— no avisa.
    .where('status', '==', 'published')
    .where('starts_at', '>=', new Date(inicio - VENTANA_DE_BUSQUEDA_MS).toISOString())
    .where('starts_at', '<=', new Date(inicio + VENTANA_DE_BUSQUEDA_MS).toISOString())
    .get();

  return elegirTurno(
    candidatos.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>)
      .filter((fila) => fila.location_id === params.locationId)
      .map((fila) => ({
        id: String(fila.id),
        starts_at: String(fila.starts_at),
        ends_at: String(fila.ends_at),
      })),
    params.entrada,
    params.salida,
  );
}

/**
 * VUELVE A MIRAR EL TURNO Y LAS MARCAS de las jornadas de una persona en una franja, sin
 * tocar sus horas. Lo llaman publicar el horario y cancelar un turno publicado.
 *
 * NO RECONSTRUYE LA JORNADA DESDE LOS FICHAJES, y es a propósito: una hora corregida en
 * Horas vive en la sesión y no en los fichajes (ver `managerAdjustTime`), así que
 * reconstruir al publicar el horario borraría en silencio las correcciones de la semana.
 * Aquí solo cambian `shift_id` y `flags`, medidas contra las horas que la sesión ya tiene.
 *
 * La diferencia de reloj no se puede volver a medir sin los fichajes, así que se conserva
 * la que hubiera.
 */
export async function revisarTurnoDeLasJornadas(params: {
  employeeId: string;
  locationId: string;
  desde: string;
  hasta: string;
}): Promise<number> {
  const sesiones = await db
    .collection(COLLECTIONS.workSessions)
    .where('employee_id', '==', params.employeeId)
    .where('starts_at', '>=', params.desde)
    .where('starts_at', '<=', params.hasta)
    .get();
  return revisarSesiones(sesiones.docs, params.locationId);
}

/**
 * LO MISMO PARA TODAS LAS JORNADAS DE UNA SEDE EN UNA FRANJA: lo que hace publicar una
 * semana. Así cualquier publicación de esa semana deja al día las marcas viejas de todas
 * sus jornadas, también las de quien fichó antes de que su turno existiera.
 */
export async function revisarJornadasDeLaSede(params: {
  locationId: string;
  desde: string;
  hasta: string;
}): Promise<number> {
  const sesiones = await db
    .collection(COLLECTIONS.workSessions)
    .where('location_id', '==', params.locationId)
    .where('starts_at', '>=', params.desde)
    .where('starts_at', '<=', params.hasta)
    .get();
  return revisarSesiones(sesiones.docs, params.locationId);
}

async function revisarSesiones(
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  locationId: string,
): Promise<number> {
  if (docs.length === 0) return 0;
  const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const politicas = politicasDe(sede ?? {});

  /*
   * PRIMERO SE MIDE CADA UNA, DESPUÉS POR TURNO (5-oct): de las jornadas de un mismo turno
   * —la salida a almorzar marcada en el reloj— la tardanza es de la primera y la salida antes
   * de la última. Sin esta segunda pasada, publicar la semana volvía a poner las dos marcas
   * que `rebuildWorkSession` ya había quitado. Ver `marcasDentroDelTurno`.
   */
  const medidas: {
    doc: FirebaseFirestore.QueryDocumentSnapshot;
    antes: string[];
    marcas: MarcaDeSesion[];
    turnoId: string | null;
    mismoTurno: boolean;
  }[] = [];
  for (const doc of docs) {
    const sesion = doc.data();
    if (sesion.location_id !== locationId || typeof sesion.employee_id !== 'string') continue;
    const entrada = String(sesion.starts_at);
    const salida = (sesion.ends_at as string | null) ?? null;

    const turno = await turnoDeLaJornada({
      employeeId: sesion.employee_id,
      locationId,
      turnoElegido: (sesion.shift_id as string | null) ?? null,
      entrada,
      salida,
    });
    const antes = Array.isArray(sesion.flags) ? (sesion.flags as string[]) : [];
    const marcas: MarcaDeSesion[] = marcasDeLaSesion({
      turno: turno === null ? null : { starts_at: turno.starts_at, ends_at: turno.ends_at },
      entrada,
      salida,
      // Sin los fichajes no hay hora del aparato: la deriva se conserva, no se mide.
      sinConexion: true,
      politicas,
    });
    if (antes.includes('clock_drift')) marcas.push('clock_drift');

    medidas.push({
      doc,
      antes,
      marcas,
      turnoId: turno?.id ?? null,
      mismoTurno: ((sesion.shift_id as string | null) ?? null) === (turno?.id ?? null),
    });
  }

  const delTurno = new Map<string, typeof medidas>();
  for (const medida of medidas) {
    if (medida.turnoId === null) continue;
    const clave = `${String(medida.doc.data().employee_id)}|${medida.turnoId}`;
    delTurno.set(clave, [...(delTurno.get(clave) ?? []), medida]);
  }
  for (const grupo of delTurno.values()) {
    grupo.sort((a, b) =>
      String(a.doc.data().starts_at).localeCompare(String(b.doc.data().starts_at)),
    );
    grupo.forEach((medida, i) => {
      medida.marcas = marcasDentroDelTurno(medida.marcas, {
        esLaPrimera: i === 0,
        esLaUltima: i === grupo.length - 1,
      });
    });
  }

  let cambiadas = 0;
  for (const { doc, antes, marcas, turnoId, mismoTurno } of medidas) {
    const mismasMarcas =
      antes.length === marcas.length &&
      antes.every((marca) => marcas.includes(marca as MarcaDeSesion));
    if (mismoTurno && mismasMarcas) continue;

    await doc.ref.update({
      shift_id: turnoId,
      flags: marcas,
      recomputed_at: nowISO(),
      updated_at: nowISO(),
    });
    cambiadas += 1;
  }
  return cambiadas;
}
