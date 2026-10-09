import { COLLECTIONS, db, nowISO } from './admin';
import {
  marcasDeLaSesion,
  marcasDentroDelTurno,
  sinSalidaAntesSiEsDeCorrido,
  type MarcaDeSesion,
} from './marcas';
import { politicasDe } from './politicas';
import {
  elegirTurno,
  VENTANA_DE_BUSQUEDA_MS,
  type TurnoDeJornada,
} from '../../../src/domain/elegir-turno';

export { elegirTurno, type TurnoDeJornada };

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
 * nunca publicado —todavía no es un turno que la persona conozca— ni uno de otra sede; el
 * publicado que se editó sin republicar, sí (8-oct).
 */

/** El refrigerio de un turno guardado, en minutos: 0 si no lo trae o no es un número. */
function refrigerioDe(turno: Record<string, unknown>): number {
  const minutos = Number(turno.planned_unpaid_break_minutes);
  return Number.isFinite(minutos) && minutos > 0 ? minutos : 0;
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
        planned_unpaid_break_minutes: refrigerioDe(elegido),
      };
    }
  }

  const inicio = Date.parse(params.entrada);
  /*
   * Los publicados y los que, ya publicados, se editaron sin volver a publicar (8-oct): las
   * pantallas los cuentan como turno (`src/features/schedules/turno-en-pie.ts`), y el elegido
   * al fichar ya valía aunque estuviera así. Un borrador nunca publicado, no.
   */
  const consulta = (estado: 'published' | 'draft') =>
    db
      .collection(COLLECTIONS.shifts)
      .where('employee_id', '==', params.employeeId)
      // Con `status` en la consulta usa el índice (employee_id, status, starts_at), que ya
      // existe: sin él, producción pediría uno nuevo y el emulador —que no los exige— no avisa.
      .where('status', '==', estado)
      .where('starts_at', '>=', new Date(inicio - VENTANA_DE_BUSQUEDA_MS).toISOString())
      .where('starts_at', '<=', new Date(inicio + VENTANA_DE_BUSQUEDA_MS).toISOString())
      .get();
  const [publicados, editados] = await Promise.all([consulta('published'), consulta('draft')]);
  const candidatos = [
    ...publicados.docs,
    ...editados.docs.filter((doc) => Number(doc.data().publication_version ?? 0) > 0),
  ];

  return elegirTurno(
    candidatos
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>)
      .filter((fila) => fila.location_id === params.locationId)
      .map((fila) => ({
        id: String(fila.id),
        starts_at: String(fila.starts_at),
        ends_at: String(fila.ends_at),
        planned_unpaid_break_minutes: refrigerioDe(fila),
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
    turno: TurnoDeJornada | null;
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
      turno,
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
    // De corrido no es salir antes (7-oct): con todas las jornadas del turno, que un hueco
    // entre dos ya es su almuerzo. Así una jornada ya guardada se corrige al mirar la semana.
    const ultima = grupo[grupo.length - 1]!;
    ultima.marcas = sinSalidaAntesSiEsDeCorrido(
      ultima.marcas,
      ultima.turno,
      grupo.map(({ doc }) => {
        const sesion = doc.data();
        return {
          starts_at: String(sesion.starts_at),
          ends_at: (sesion.ends_at as string | null) ?? null,
          paid_break_minutes: Number(sesion.paid_break_minutes ?? 0),
          unpaid_break_minutes: Number(sesion.unpaid_break_minutes ?? 0),
        };
      }),
    );
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
