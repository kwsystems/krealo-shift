import { HttpsError } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './admin';
import { filaDelEvento, rebuildJornadaDe, reservarSecuencias } from './attendance';
import { enOrden, recorrer } from './secuencia';

/**
 * LA SALIDA QUE PONE QUIEN GESTIONA ES UN FICHAJE, no un número de la jornada (1-oct).
 *
 * Andree arregló la salida de una vendedora que se fue sin marcar, y al día siguiente
 * Inicio y Horario seguían diciendo «Trabajando desde 16:50». Tenía razón en lo que pidió:
 * «cada vez que yo cambio en un lado debería sincronizarse con los otros».
 *
 * Fallaba por dos sitios:
 *
 *  1. «CORREGIR HORA» SOBRE UNA JORNADA ABIERTA solo escribía `ends_at` en la jornada. El
 *     estado seguía en `open` —que es lo que mira «quién está trabajando ahora»— y no había
 *     fichaje de salida, que es lo que mira el reloj: la tablet le habría ofrecido «Marcar
 *     salida» en su siguiente turno en vez de «Marcar entrada».
 *  2. UNA HORA EN EL FUTURO SE ACEPTABA. Pasada la medianoche, «hoy» ya es el día
 *     siguiente, y una salida «de hoy a las 21:00» quedaba para la noche de mañana: la
 *     jornada seguía viva hasta entonces en todas las pantallas.
 *
 * Ahora, cuando la jornada no tiene salida o la salida la puso quien gestiona, corregirla
 * escribe —o mueve— ESE fichaje y reconstruye la jornada desde los fichajes, como hace el
 * reloj. Todo lo demás se entera solo porque todo lee de ahí. Una salida que marcó la
 * propia persona en el reloj no se toca: es la única prueba de lo que pasó, y se corrige
 * en la jornada como siempre.
 */

/** Lo que se tolera de reloj adelantado en el aparato de quien corrige. */
const MARGEN_FUTURO_MS = 5 * 60_000;

/**
 * Nadie sale ni entra en una hora que todavía no llegó. `motivo: 'FUTURO'` para que la
 * pantalla diga qué revisar —casi siempre el día— y no un «no se pudo guardar».
 */
export function noEnElFuturo(
  iso: string | null | undefined,
  que: 'entrada' | 'salida' | 'fichaje',
): void {
  if (iso === null || iso === undefined) return;
  const nombre = que === 'fichaje' ? 'del fichaje' : `de ${que}`;
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) {
    throw new HttpsError('invalid-argument', `La hora ${nombre} no es válida.`);
  }
  if (instante > Date.now() + MARGEN_FUTURO_MS) {
    throw new HttpsError(
      'invalid-argument',
      `Esa hora ${nombre} todavía no llegó. Revisa el día: pasada la medianoche, «hoy» ya es el día siguiente.`,
      { motivo: 'FUTURO' },
    );
  }
}

type Correccion = {
  uid: string;
  reason: string;
  newEndsAt: string;
  newStartsAt?: string | null;
  requestId?: string;
};

const minutos = (desde: string, hasta: string) =>
  Math.floor((Date.parse(hasta) - Date.parse(desde)) / 60_000);

/**
 * Corrige la salida con un fichaje si toca —jornada sin salida, o salida puesta por
 * quien gestiona—. Devuelve `false` si no toca, y entonces se corrige la jornada como
 * siempre (`ajustarSesion`).
 */
export async function corregirSalidaConFichaje(
  sessionId: string,
  previa: Record<string, unknown>,
  correccion: Correccion,
): Promise<boolean> {
  const idEntrada = previa.clock_in_event_id;
  if (typeof idEntrada !== 'string') return false;
  const entrada = (await db.collection(COLLECTIONS.timeEvents).doc(idEntrada).get()).data();
  if (entrada === undefined) return false;

  const idSalida = typeof previa.clock_out_event_id === 'string' ? previa.clock_out_event_id : null;
  const salida =
    idSalida === null
      ? undefined
      : (await db.collection(COLLECTIONS.timeEvents).doc(idSalida).get()).data();
  const abierta = previa.status === 'open' || previa.ends_at === null || salida === undefined;
  const salidaDeGerente = salida !== undefined && salida.source === 'manager';
  if (!abierta && !salidaDeGerente) return false;

  const organizationId = String(previa.organization_id);
  const employeeId = String(previa.employee_id);
  const locationId = String(previa.location_id);
  const horaDeEntrada = String(entrada.occurred_at);
  const inicio = correccion.newStartsAt ?? String(previa.starts_at);
  if (Date.parse(correccion.newEndsAt) < Date.parse(inicio)) {
    throw new HttpsError('invalid-argument', 'La salida no puede ser anterior a la entrada.');
  }

  // Los fichajes de esa jornada: desde su entrada hasta la entrada siguiente, si la hay.
  const eventos = enOrden(
    (
      await db
        .collection(COLLECTIONS.timeEvents)
        .where('employee_id', '==', employeeId)
        .where('occurred_at', '>=', horaDeEntrada)
        .orderBy('occurred_at', 'asc')
        .get()
    ).docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Record<string, unknown>),
  );
  const siguienteEntrada = recorrer(eventos.filter((e) => e.id !== idSalida)).find(
    (paso) =>
      paso.cuenta &&
      paso.tipo === 'clock_in' &&
      paso.evento.id !== idEntrada &&
      String(paso.evento.occurred_at) > horaDeEntrada,
  );
  if (
    siguienteEntrada !== undefined &&
    correccion.newEndsAt >= String(siguienteEntrada.evento.occurred_at)
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Esa salida cae después de su siguiente entrada: revisa el día.',
      { motivo: 'DESPUES_DE_OTRA_ENTRADA' },
    );
  }

  const ahora = nowISO();
  let idDelFichaje: string;
  if (salidaDeGerente && idSalida !== null) {
    /*
     * MOVER EL FICHAJE DE QUIEN GESTIONA, y no apilar otro. Es su propia afirmación —«se
     * fue a tal hora»— y no una prueba de la persona: dos salidas para la misma jornada
     * dejarían a la máquina de estados eligiendo cuál cuenta. Lo de antes queda en
     * `time_adjustments`, con el autor.
     */
    idDelFichaje = idSalida;
    await db.collection(COLLECTIONS.timeEvents).doc(idSalida).update({
      occurred_at: correccion.newEndsAt,
      corregido_at: ahora,
      corregido_por: correccion.uid,
    });
  } else {
    idDelFichaje = `${organizationId}_salida_${sessionId}`;
    const seq = await reservarSecuencias(1);
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc(idDelFichaje)
      .set(
        filaDelEvento(
          {
            organizationId,
            employeeId,
            locationId,
            shiftId: (previa.shift_id as string | null | undefined) ?? null,
            eventType: 'clock_out',
            occurredAt: correccion.newEndsAt,
            idempotencyKey: `salida_${sessionId}`,
            source: 'manager',
            createdBy: correccion.uid,
          },
          idDelFichaje,
          seq,
          { origen: 'salida_corregida', work_session_id: sessionId },
        ),
      );
  }

  await rebuildJornadaDe(organizationId, employeeId, locationId, horaDeEntrada);

  /*
   * UNA ENTRADA YA CORREGIDA EN LA JORNADA SE CONSERVA. Reconstruir parte del fichaje de
   * entrada, así que sin esto una corrección anterior de la entrada se perdería al poner
   * la salida.
   */
  const entradaCorregida =
    correccion.newStartsAt ??
    (String(previa.starts_at) !== horaDeEntrada ? String(previa.starts_at) : null);
  if (entradaCorregida !== null) {
    const ref = db.collection(COLLECTIONS.workSessions).doc(`${employeeId}_${horaDeEntrada}`);
    const reconstruida = (await ref.get()).data();
    const fin = (reconstruida?.ends_at as string | null | undefined) ?? correccion.newEndsAt;
    const brutos = minutos(entradaCorregida, fin);
    const sinPagar = Number(reconstruida?.unpaid_break_minutes ?? 0);
    await ref.update({
      starts_at: entradaCorregida,
      gross_minutes: brutos,
      net_minutes: brutos - sinPagar,
      updated_at: nowISO(),
    });
  }

  const comun = {
    organization_id: organizationId,
    location_id: locationId,
    employee_id: employeeId,
    work_session_id: sessionId,
    ...(correccion.requestId === undefined ? {} : { request_id: correccion.requestId }),
    reason: correccion.reason,
    created_by: correccion.uid,
    created_at: ahora,
    channel: 'manager_app',
  };
  await db.collection(COLLECTIONS.timeAdjustments).add({
    ...comun,
    target_type: 'time_event',
    target_id: idDelFichaje,
    before_value: {
      event_type: 'clock_out',
      occurred_at: salida === undefined ? null : (salida.occurred_at ?? null),
      ends_at: previa.ends_at ?? null,
    },
    after_value: { event_type: 'clock_out', occurred_at: correccion.newEndsAt },
  });
  if (
    correccion.newStartsAt !== null &&
    correccion.newStartsAt !== undefined &&
    correccion.newStartsAt !== previa.starts_at
  ) {
    await db.collection(COLLECTIONS.timeAdjustments).add({
      ...comun,
      target_type: 'work_session',
      target_id: sessionId,
      before_value: { starts_at: previa.starts_at },
      after_value: { starts_at: correccion.newStartsAt },
    });
  }
  return true;
}

/**
 * LAS JORNADAS QUE YA QUEDARON MAL antes de este arreglo: abiertas, con una salida puesta
 * a mano en la jornada y sin su fichaje. Se registra el fichaje que faltaba a la hora que
 * escribió quien la corrigió, y se reconstruye. Solo las de salida ya pasada: una salida a
 * futuro no se puede adivinar y sale en «Por resolver» de Horas.
 *
 * Lo llaman «quién está trabajando ahora» y el reloj antes de decir qué botones enseña,
 * que son los dos sitios donde una jornada así hace daño.
 */
export async function repararSalidasPuestasAMano(
  sesiones: readonly { id: string; data: Record<string, unknown> }[],
): Promise<Set<string>> {
  const reparadas = new Set<string>();
  const ahora = Date.now();
  for (const { id, data } of sesiones) {
    if (data.status !== 'open' || typeof data.ends_at !== 'string') continue;
    if (Date.parse(data.ends_at) > ahora) continue;
    const autor = (
      await db.collection(COLLECTIONS.timeAdjustments).where('work_session_id', '==', id).get()
    ).docs
      .map((doc) => doc.data())
      .filter((fila) => fila.target_type === 'work_session')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    try {
      const hecho = await corregirSalidaConFichaje(id, data, {
        uid: typeof autor?.created_by === 'string' ? autor.created_by : 'sistema',
        reason:
          'Salida corregida a mano en la jornada: se registra el fichaje de salida que faltaba.',
        newEndsAt: data.ends_at,
      });
      if (hecho) reparadas.add(id);
    } catch (error) {
      // Una jornada que no se deja reparar no puede tumbar la vista que la lista.
      console.warn('repararSalidasPuestasAMano', id, error);
    }
  }
  return reparadas;
}

/** ¿Esta jornada está cerrada de hecho aunque diga `open`? (salida puesta y ya pasada) */
export function cerradaDeHecho(data: Record<string, unknown>): boolean {
  return typeof data.ends_at === 'string' && Date.parse(data.ends_at) <= Date.now();
}
