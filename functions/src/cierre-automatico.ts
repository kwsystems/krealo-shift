import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { COLLECTIONS, db } from './shared/admin';
import { audit } from './shared/caller';
import { corregirSalidaConFichaje } from './shared/salida-a-mano';
import { zonaSegura } from './shared/zonas';

/**
 * LA JORNADA QUE NADIE CERRÓ SE CIERRA SOLA, A LA HORA DE SALIDA DE SU TURNO (5-oct).
 *
 * Quien se va sin marcar la salida seguía «dentro» para el reloj: al día siguiente no podía
 * marcar su entrada hasta que alguien cerrara la de ayer. Andree decidió: «que se pare solo
 * en el horario de salida, y luego el admin que haga lo que sea. Que se pare antes de que
 * termine el día».
 *
 * QUÉ HACE, cada hora:
 *   - mira las jornadas abiertas;
 *   - les toca a partir de las 23:00 de su sede, o enseguida si son de un día anterior;
 *   - con turno ya terminado, la salida es la hora de FIN DEL TURNO;
 *   - sin turno (o si entró después del fin del suyo), la de su ÚLTIMA MARCA: no hay hora
 *     de salida que tomar, y poner otra pagaría horas que nadie sabe si trabajó;
 *   - un turno que todavía no termina —el de noche que cruza la medianoche— no se toca.
 *
 * LA SALIDA ES UN FICHAJE, como la que pone quien gestiona (`salida-a-mano.ts`): así el
 * reloj, Inicio, Horario y Horas se enteran solos, porque todos leen los fichajes. Lleva
 * `origen: 'salida_automatica'`, la jornada queda con `auto_clock_out` y Horas la enseña en
 * «Por resolver» hasta que alguien corrija esa salida o la dé por buena.
 */

/** Desde esta hora de la sede, la jornada de hoy ya se puede cerrar. */
export const HORA_DEL_CIERRE = 23;

export type ResumenDelCierre = { miradas: number; cerradas: string[]; fallidas: string[] };

function enLaZona(instante: number, zona: string): { dia: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instante));
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return { dia: `${valor('year')}-${valor('month')}-${valor('day')}`, hora: Number(valor('hour')) };
}

/** La última marca de la jornada: su entrada, o la pausa que vino después. */
async function ultimaMarca(employeeId: string, desde: string, hasta: number): Promise<string> {
  const eventos = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', employeeId)
    .where('occurred_at', '>=', desde)
    .orderBy('occurred_at', 'asc')
    .get();
  const antesDeAhora = eventos.docs
    .map((doc) => String(doc.data().occurred_at))
    .filter((cuando) => Date.parse(cuando) <= hasta);
  return antesDeAhora.at(-1) ?? desde;
}

export async function cerrarJornadasOlvidadas(
  ahora: number = Date.now(),
): Promise<ResumenDelCierre> {
  const abiertas = await db
    .collection(COLLECTIONS.workSessions)
    .where('status', '==', 'open')
    .get();
  const zonas = new Map<string, string>();
  const resumen: ResumenDelCierre = { miradas: abiertas.size, cerradas: [], fallidas: [] };

  for (const doc of abiertas.docs) {
    const jornada = doc.data();
    // Con salida ya puesta y pasada la repara `repararSalidasPuestasAMano`: no es olvido.
    if (typeof jornada.ends_at === 'string') continue;
    const inicio = String(jornada.starts_at);
    if (Number.isNaN(Date.parse(inicio))) continue;

    const sedeId = String(jornada.location_id);
    if (!zonas.has(sedeId)) {
      const sede = (await db.collection(COLLECTIONS.locations).doc(sedeId).get()).data();
      zonas.set(sedeId, zonaSegura(sede?.timezone ?? 'America/Lima', 'cerrarJornadasOlvidadas'));
    }
    const zona = zonas.get(sedeId) as string;
    const hoy = enLaZona(ahora, zona);
    const deUnDiaAnterior = enLaZona(Date.parse(inicio), zona).dia < hoy.dia;
    if (!deUnDiaAnterior && hoy.hora < HORA_DEL_CIERRE) continue;

    const turno =
      typeof jornada.shift_id === 'string'
        ? (await db.collection(COLLECTIONS.shifts).doc(jornada.shift_id).get()).data()
        : undefined;
    const finDelTurno = typeof turno?.ends_at === 'string' ? Date.parse(turno.ends_at) : null;
    // Un turno que sigue en marcha —el de noche— no se cierra.
    if (finDelTurno !== null && finDelTurno > ahora) continue;

    const salida =
      finDelTurno !== null && finDelTurno > Date.parse(inicio)
        ? String(turno?.ends_at)
        : await ultimaMarca(String(jornada.employee_id), inicio, ahora);

    try {
      const hecho = await corregirSalidaConFichaje(doc.id, jornada, {
        uid: 'sistema',
        reason:
          'Salida automática: no marcó la salida y la jornada se cerró sola a la hora de fin de su turno. Revísala.',
        newEndsAt: salida,
        origen: 'salida_automatica',
        canal: 'automatico',
      });
      if (!hecho) continue;
      resumen.cerradas.push(doc.id);
      await audit({
        organizationId: String(jornada.organization_id),
        actorUserId: null,
        action: 'work_session_auto_closed',
        entityType: 'work_session',
        entityId: doc.id,
        after: { ends_at: salida, con_turno: finDelTurno !== null },
      });
    } catch (error) {
      // Una jornada que no se deja cerrar no puede parar las demás.
      resumen.fallidas.push(doc.id);
      logger.warn('No se pudo cerrar sola la jornada', { jornada: doc.id, error: String(error) });
    }
  }
  return resumen;
}

export const cerrarJornadasSinSalida = onSchedule(
  { schedule: '30 * * * *', timeZone: 'America/Lima', retryCount: 1 },
  async () => {
    const resumen = await cerrarJornadasOlvidadas();
    // Siempre, también cuando no cierra nada: así se ve que sigue corriendo.
    logger.info('Cierre de jornadas sin salida', {
      miradas: resumen.miradas,
      cerradas: resumen.cerradas.length,
      fallidas: resumen.fallidas.length,
    });
  },
);
