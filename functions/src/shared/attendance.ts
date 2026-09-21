import { HttpsError } from 'firebase-functions/v2/https';

import {
  reduceEvents,
  transition,
  type AttendanceState,
  type TimeEventType,
} from '../../../src/domain/attendance-state-machine';
import { COLLECTIONS, db, nowISO } from './admin';

/**
 * Registro de fichajes y su proyeccion. Reemplaza a `submit_time_event`,
 * `apply_event_to_projection`, `rebuild_work_session` y `current_attendance_state`.
 *
 * LA MAQUINA DE ESTADOS NO SE REESCRIBE AQUI: se importa de `src/domain/`, la misma
 * que usa el iPad para decidir que botones enseña. En Postgres habia dos copias —una
 * en SQL y otra en TypeScript— y una prueba de paridad vigilando que no
 * discreparan. Con las dos partes en el mismo lenguaje, esa prueba deja de ser
 * necesaria porque el codigo es literalmente el mismo: no hay dos cosas que puedan
 * desalinearse.
 */

export type TimeEventInput = {
  organizationId: string;
  employeeId: string;
  locationId: string;
  eventType: TimeEventType;
  breakType?: string | null;
  breakReason?: string | null;
  breakNote?: string | null;
  occurredAt: string;
  occurredAtDevice?: string | null;
  idempotencyKey: string;
  deviceId?: string | null;
  deviceSequence?: number | null;
  isOffline?: boolean;
  source?: 'kiosk' | 'manager' | 'import';
  createdBy?: string | null;
  timezone?: string;
};

/**
 * Estado de asistencia de una persona EN UN INSTANTE, no solo ahora.
 *
 * El instante importa porque una correccion casi siempre se pone en el pasado: un
 * gerente que anade el fichaje que faltó ayer necesita saber si la transicion valia
 * ENTONCES, no si vale ahora. Era `attendance_state_at` y es el mismo motivo.
 */
export async function attendanceStateAt(
  employeeId: string,
  instant: string,
): Promise<AttendanceState> {
  const snapshot = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', employeeId)
    .where('occurred_at', '<=', instant)
    .orderBy('occurred_at', 'asc')
    .get();

  /**
   * `seq` DESEMPATA, y hace falta: dos eventos pueden compartir `occurred_at` al
   * milisegundo cuando se sincroniza un lote sin conexion, y sin un orden estable
   * la maquina de estados recibe «salida, entrada» en vez de «entrada, salida» y
   * concluye lo contrario de lo que paso.
   */
  const ordenados = snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => {
      const porInstante = String(a.occurred_at).localeCompare(String(b.occurred_at));
      return porInstante !== 0 ? porInstante : Number(a.seq ?? 0) - Number(b.seq ?? 0);
    });

  return reduceEvents(ordenados.map((row) => row.event_type as TimeEventType)).state;
}

/** Numero de secuencia global creciente. Es el `seq` de Postgres. */
async function nextSequence(): Promise<number> {
  const counter = db.collection('_counters').doc('time_events_seq');
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(counter);
    const next = ((snapshot.data()?.value as number | undefined) ?? 0) + 1;
    tx.set(counter, { value: next }, { merge: true });
    return next;
  });
}

/**
 * Registra un fichaje. Devuelve el evento creado, o el que ya existia.
 *
 * LA IDEMPOTENCIA ES LA MITAD DEL TRABAJO. La clave la genera el iPad ANTES de
 * guardar nada, asi que un doble toque, un reintento tras una red que se cayo a
 * medias o un lote offline que se sincroniza dos veces producen la MISMA clave, y
 * aqui se devuelve el evento original en vez de crear otro. Sin esto, la persona
 * aparece fichando dos entradas seguidas y sus horas del dia se duplican.
 *
 * Va en transaccion con la comprobacion de la clave DENTRO: comprobar antes y
 * escribir despues deja una ventana en la que dos peticiones simultaneas —que es
 * exactamente lo que es un doble toque— pasan las dos.
 */
export async function recordTimeEvent(input: TimeEventInput): Promise<{
  eventId: string;
  duplicated: boolean;
  state: AttendanceState;
}> {
  const idempotencyId = `${input.organizationId}_${input.idempotencyKey}`;
  const eventsRef = db.collection(COLLECTIONS.timeEvents);
  const existing = await eventsRef.doc(idempotencyId).get();

  if (existing.exists) {
    return {
      eventId: existing.id,
      duplicated: true,
      state: await attendanceStateAt(input.employeeId, input.occurredAt),
    };
  }

  const stateBefore = await attendanceStateAt(input.employeeId, input.occurredAt);
  const result = transition(stateBefore, input.eventType);
  if (!result.allowed) {
    throw new HttpsError(
      'failed-precondition',
      `No se puede registrar «${input.eventType}» estando en «${stateBefore}».`,
    );
  }

  const seq = await nextSequence();

  await eventsRef.doc(idempotencyId).create({
    id: idempotencyId,
    organization_id: input.organizationId,
    employee_id: input.employeeId,
    location_id: input.locationId,
    shift_id: null,
    event_type: input.eventType,
    break_type: input.breakType ?? null,
    break_reason: input.breakReason ?? null,
    break_note: input.breakNote ?? null,
    source: input.source ?? 'kiosk',
    occurred_at: input.occurredAt,
    occurred_at_device: input.occurredAtDevice ?? null,
    received_at: nowISO(),
    seq,
    timezone: input.timezone ?? 'America/Lima',
    idempotency_key: input.idempotencyKey,
    device_id: input.deviceId ?? null,
    device_sequence: input.deviceSequence ?? null,
    is_offline: input.isOffline ?? false,
    photo_path: null,
    metadata: {},
    created_by: input.createdBy ?? null,
  });

  await rebuildWorkSession(input.organizationId, input.employeeId, input.locationId);

  return { eventId: idempotencyId, duplicated: false, state: result.nextState };
}

/**
 * Recalcula la sesion de trabajo abierta de una persona a partir de sus eventos.
 *
 * Es una PROYECCION, no un dato propio: se puede tirar y reconstruir desde
 * `time_events`, que es la unica prueba de lo que paso. Esa es la razon de que
 * exista, igual que en Postgres — una correccion cambia la proyeccion y deja el
 * evento crudo intacto.
 */
export async function rebuildWorkSession(
  organizationId: string,
  employeeId: string,
  locationId: string,
): Promise<void> {
  const desde = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

  const snapshot = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', employeeId)
    .where('occurred_at', '>=', desde)
    .orderBy('occurred_at', 'asc')
    .get();

  const eventos = snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => {
      const porInstante = String(a.occurred_at).localeCompare(String(b.occurred_at));
      return porInstante !== 0 ? porInstante : Number(a.seq ?? 0) - Number(b.seq ?? 0);
    });

  // La sesion vigente empieza en el ultimo `clock_in` sin `clock_out` posterior.
  let inicio: Record<string, unknown> | undefined;
  const desdeUltimaEntrada: Record<string, unknown>[] = [];
  for (const evento of eventos) {
    if (evento.event_type === 'clock_in') {
      inicio = evento;
      desdeUltimaEntrada.length = 0;
    }
    if (inicio !== undefined) desdeUltimaEntrada.push(evento);
  }
  if (inicio === undefined) return;

  const salida = desdeUltimaEntrada.find((evento) => evento.event_type === 'clock_out');
  const abierta = salida === undefined;

  let pagados = 0;
  let noPagados = 0;
  let pausaAbierta: Record<string, unknown> | null = null;

  for (const evento of desdeUltimaEntrada) {
    if (evento.event_type === 'break_start') pausaAbierta = evento;
    if (evento.event_type === 'break_end' && pausaAbierta !== null) {
      const minutos = Math.floor(
        (new Date(String(evento.occurred_at)).getTime() -
          new Date(String(pausaAbierta.occurred_at)).getTime()) /
          60000,
      );
      if (pausaAbierta.break_type === 'paid') pagados += minutos;
      else noPagados += minutos;
      pausaAbierta = null;
    }
  }

  const startsAt = String(inicio.occurred_at);
  const endsAt = salida === undefined ? null : String(salida.occurred_at);
  /**
   * LOS SEGUNDOS SE TRUNCAN, NO SE REDONDEAN, y esto se paga en dinero. SQL
   * redondeaba y TypeScript truncaba, asi que las dos mitades del producto discrepaban
   * en hasta un minuto por sesion sobre lo que se le paga a alguien. Lo arreglo la
   * migracion `002100_truncar_minutos.sql` y la regla sobrevive al cambio de motor.
   */
  const brutos =
    endsAt === null
      ? null
      : Math.floor((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);

  const sessionId = `${employeeId}_${startsAt}`;
  await db
    .collection(COLLECTIONS.workSessions)
    .doc(sessionId)
    .set(
      {
        id: sessionId,
        organization_id: organizationId,
        employee_id: employeeId,
        location_id: locationId,
        shift_id: null,
        clock_in_event_id: inicio.id,
        clock_out_event_id: salida?.id ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        gross_minutes: brutos,
        paid_break_minutes: pagados,
        unpaid_break_minutes: noPagados,
        net_minutes: brutos === null ? null : brutos - noPagados,
        status: abierta ? 'open' : 'complete',
        flags: [],
        recomputed_at: nowISO(),
        updated_at: nowISO(),
      },
      { merge: true },
    );
}
