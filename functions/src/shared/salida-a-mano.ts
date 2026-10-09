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
  /**
   * De dónde sale la salida, en los metadatos del fichaje: `salida_corregida` (quien
   * gestiona) o `salida_automatica` (el cierre de las jornadas olvidadas). La jornada lo
   * hereda al reconstruirse: ver `auto_clock_out` en `attendance.ts`.
   */
  origen?: 'salida_corregida' | 'salida_automatica';
  /** El canal de la fila de `time_adjustments`: `manager_app` o `automatico`. */
  canal?: 'manager_app' | 'automatico';
};


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
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc(idSalida)
      .update({
        occurred_at: correccion.newEndsAt,
        corregido_at: ahora,
        corregido_por: correccion.uid,
        // Una salida automática que alguien corrige deja de serlo: ya la miró una persona.
        'metadata.origen': correccion.origen ?? 'salida_corregida',
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
          { origen: correccion.origen ?? 'salida_corregida', work_session_id: sessionId },
        ),
      );
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
    channel: correccion.canal ?? 'manager_app',
  };
  /*
   * LA ENTRADA CORREGIDA VA ANTES DE RECONSTRUIR (8-oct). Se escribía después: la jornada se
   * rehacía con la entrada vieja —tardanza, turno y jornadas hermanas medidos desde las 08:31
   * cuando se había corregido a las 08:00— y luego se parcheaba solo la hora. Escrita antes,
   * la reconstrucción la aplica (`correccionesDeLaJornada`, en cadena con las anteriores) y lo
   * mide todo con ella.
   */
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
  await rebuildJornadaDe(organizationId, employeeId, locationId, horaDeEntrada);

  await db.collection(COLLECTIONS.timeAdjustments).add({
    ...comun,
    target_type: 'time_event',
    target_id: idDelFichaje,
    before_value: {
      event_type: 'clock_out',
      occurred_at: salida === undefined ? null : (salida.occurred_at ?? null),
      ends_at: previa.ends_at ?? null,
    },
    after_value: {
      event_type: 'clock_out',
      occurred_at: correccion.newEndsAt,
      // La puso el sistema (5-oct): Reportes la cuenta aparte, como «salida automática».
      ...(correccion.origen === 'salida_automatica' ? { origen: 'salida_automatica' } : {}),
    },
  });
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

/**
 * LA JORNADA QUE CERRÓ EL SISTEMA Y EN LA QUE CAE ESTA SALIDA (8-oct), o `null`.
 *
 * El cierre automático de la noche pone la salida a la hora de fin del turno. Si al día
 * siguiente se aprueba «olvidé marcar la salida» a las 19:30 —o se añade a mano—, esa salida
 * llegaba con la persona ya «fuera» y se rechazaba («a esa hora ya estaba en otro estado»):
 * la única forma de arreglarlo era «Corregir hora» en Horas. Ahora quien la pide o la añade
 * mueve ESA salida, la del sistema, que no la marcó nadie.
 */
/** La jornada más larga que se toma por una sola: la misma alerta de 16 h de «sin cerrar». */
const JORNADA_MAS_LARGA_MS = 16 * 60 * 60_000;

export async function jornadaCerradaSolaEn(
  employeeId: string,
  instante: string,
): Promise<{ id: string; datos: Record<string, unknown> } | null> {
  const suyas = (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', employeeId).get()
  ).docs
    .map((doc) => ({ id: doc.id, datos: doc.data() as Record<string, unknown> }))
    .filter((j) => Date.parse(String(j.datos.starts_at)) < Date.parse(instante))
    .sort((a, b) => String(b.datos.starts_at).localeCompare(String(a.datos.starts_at)));
  // La última que empezó antes de esa salida: si no la cerró el sistema, no es este caso.
  const ultima = suyas[0];
  if (ultima === undefined || ultima.datos.auto_clock_out !== true) return null;
  // Y de esa misma jornada: una salida añadida por error al día siguiente no mueve la de ayer.
  const desdeQueEntro = Date.parse(instante) - Date.parse(String(ultima.datos.starts_at));
  return desdeQueEntro <= JORNADA_MAS_LARGA_MS ? ultima : null;
}
