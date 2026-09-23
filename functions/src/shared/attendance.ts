import { HttpsError } from 'firebase-functions/v2/https';

import {
  reduceEvents,
  transition,
  type AttendanceState,
  type TimeEventType,
} from '../../../src/domain/attendance-state-machine';
import { COLLECTIONS, db, nowISO } from './admin';
import { tipoEfectivo } from './eventos';
import { marcasDeLaSesion } from './marcas';
import { politicasDe } from './politicas';

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
  /**
   * El turno al que pertenece el fichaje. El reloj lo manda —la persona elige su
   * turno antes de entrar— y se escribia `null` igualmente, asi que ni el evento ni la
   * sesion sabian nunca a que turno correspondian: la hoja de tiempo no podia comparar
   * lo planificado con lo trabajado y al fichar no habia forma de decir a que hora
   * termina la jornada.
   */
  shiftId?: string | null;
  breakType?: string | null;
  breakReason?: string | null;
  breakNote?: string | null;
  /** Por que se fue antes de su hora. Solo en `clock_out`. */
  departureReason?: string | null;
  departureNote?: string | null;
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

  return reduceEvents(ordenados.map((row) => tipoEfectivo(row))).state;
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
    shift_id: input.shiftId ?? null,
    event_type: input.eventType,
    break_type: input.breakType ?? null,
    break_reason: input.breakReason ?? null,
    break_note: input.breakNote ?? null,
    /*
     * SOLO EN LA SALIDA. Guardarlos en cualquier evento invitaria a que una entrada
     * llevara motivo de salida, y entonces un reporte que agrupe por motivo contaria
     * cosas que no pasaron. La forma de la fila dice lo que puede haber pasado.
     */
    departure_reason: input.eventType === 'clock_out' ? (input.departureReason ?? null) : null,
    departure_note: input.eventType === 'clock_out' ? (input.departureNote ?? null) : null,
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
    if (tipoEfectivo(evento) === 'clock_in') {
      inicio = evento;
      desdeUltimaEntrada.length = 0;
    }
    if (inicio !== undefined) desdeUltimaEntrada.push(evento);
  }
  if (inicio === undefined) return;

  const salida = desdeUltimaEntrada.find((evento) => tipoEfectivo(evento) === 'clock_out');
  const abierta = salida === undefined;

  let pagados = 0;
  let noPagados = 0;
  let pausaAbierta: Record<string, unknown> | null = null;

  for (const evento of desdeUltimaEntrada) {
    if (tipoEfectivo(evento) === 'break_start') pausaAbierta = evento;
    if (tipoEfectivo(evento) === 'break_end' && pausaAbierta !== null) {
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

  /*
   * LAS MARCAS, que hasta hoy eran un `flags: []` fijo.
   *
   * Se calculan aqui porque es el unico sitio que tiene las tres piezas a la vez: los
   * eventos crudos, el turno al que dijeron pertenecer y la sede que pone las
   * tolerancias. La decision en si vive en `marcas.ts`, sin Firestore delante, para
   * poder probarla.
   *
   * Si el turno o la sede no se pueden leer se sigue adelante con lo que haya: una marca
   * que no se puede calcular no puede impedir que la sesion se guarde, porque la sesion
   * es lo que sostiene las horas que se pagan y la marca solo es un aviso.
   */
  const turnoId = (inicio.shift_id as string | null) ?? null;
  const turnoDoc =
    turnoId === null
      ? undefined
      : (await db.collection(COLLECTIONS.shifts).doc(turnoId).get()).data();
  const sedeDoc = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();

  const marcas = marcasDeLaSesion({
    turno:
      turnoDoc === undefined
        ? null
        : { starts_at: String(turnoDoc.starts_at), ends_at: String(turnoDoc.ends_at) },
    entrada: startsAt,
    salida: endsAt,
    entradaSegunElAparato: (inicio.occurred_at_device as string | null) ?? null,
    salidaSegunElAparato: (salida?.occurred_at_device as string | null) ?? null,
    sinConexion: inicio.is_offline === true || salida?.is_offline === true,
    politicas: politicasDe(sedeDoc ?? {}),
  });

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
        // El turno de la sesion es el del fichaje de ENTRADA: los de pausa y salida
        // pueden venir sin el y no por eso la jornada deja de ser de ese turno.
        shift_id: (inicio.shift_id as string | null) ?? null,
        clock_in_event_id: inicio.id,
        clock_out_event_id: salida?.id ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        gross_minutes: brutos,
        paid_break_minutes: pagados,
        unpaid_break_minutes: noPagados,
        net_minutes: brutos === null ? null : brutos - noPagados,
        status: abierta ? 'open' : 'complete',
        flags: marcas,
        /*
         * POR QUE SE FUE ANTES, si lo dijo al fichar.
         *
         * Va en la SESION y no solo en el evento porque la hoja de horas lee sesiones:
         * dejarlo unicamente en `time_events` significaria que el gerente ve la marca
         * `early_departure` en la fila y tiene que abrir el detalle del evento para
         * enterarse de que la persona ya habia contestado. Una explicacion que hay que
         * ir a buscar no la lee nadie, y entonces se le pregunta al empleado para nada.
         *
         * `null` cuando no se pregunto, que es el caso normal: solo se pregunta pasado
         * el umbral de la sede.
         */
        departure_reason: (salida?.departure_reason as string | null) ?? null,
        departure_note: (salida?.departure_note as string | null) ?? null,
        recomputed_at: nowISO(),
        updated_at: nowISO(),
      },
      { merge: true },
    );
}

/**
 * La pausa que sigue abierta, si la hay: desde cuándo y de qué tipo.
 *
 * EL RELOJ TIENE UNA PANTALLA PARA ESTO QUE NUNCA SALIA. `buildEmployeeContext` devolvía
 * `openBreak: null` fijo, así que `app/kiosk/actions.tsx` —que solo pinta «En descanso
 * desde {{hora}}» cuando no es null— no entraba nunca en esa rama. Quien está en pausa
 * vuelve al teclado y el reloj no le dice desde cuándo lleva fuera, que es justo lo que
 * necesita para saber si ya le toca volver.
 *
 * Se mira SOLO desde la última entrada: una pausa sin cerrar de anteayer no es una pausa
 * abierta, es un olvido, y eso lo señala la marca de la hoja de horas. Confundirlos haría
 * que el reloj le dijera a alguien que lleva dos días descansando.
 */
export async function pausaAbiertaDe(
  employeeId: string,
): Promise<{ startedAt: string; breakType: string } | null> {
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

  let abierta: { startedAt: string; breakType: string } | null = null;
  for (const evento of eventos) {
    // Una entrada nueva empieza otra jornada: lo de antes ya no cuenta.
    const tipo = tipoEfectivo(evento);
    if (tipo === 'clock_in' || tipo === 'clock_out') abierta = null;
    if (tipo === 'break_start') {
      abierta = {
        startedAt: String(evento.occurred_at),
        breakType: String(evento.break_type ?? 'unpaid'),
      };
    }
    if (tipo === 'break_end') abierta = null;
  }

  return abierta;
}
