/**
 * Máquina de estados de asistencia (especificación §12).
 *
 *   OFF_SHIFT --clock_in--> WORKING
 *   WORKING   --break_start--> ON_BREAK
 *   WORKING   --clock_out--> OFF_SHIFT
 *   ON_BREAK  --break_end--> WORKING
 *   ON_BREAK  --clock_out--> OFF_SHIFT  (requiere confirmación explícita)
 *
 * Esta implementación es la referencia del cliente y debe ser idéntica a la del
 * servidor. El servidor es la autoridad —rechaza transiciones imposibles aunque
 * el cliente las envíe— pero el cliente necesita la misma lógica para no ofrecer
 * un botón que va a fallar, y para funcionar sin conexión (§9.7).
 */

export const ATTENDANCE_STATES = ['OFF_SHIFT', 'WORKING', 'ON_BREAK'] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export const TIME_EVENT_TYPES = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const;
export type TimeEventType = (typeof TIME_EVENT_TYPES)[number];

export type TransitionResult =
  | { allowed: true; nextState: AttendanceState; requiresConfirmation: boolean }
  | { allowed: false; reason: 'invalid_transition' };

/**
 * Tabla de transiciones. `requiresConfirmation` marca los casos en que la acción
 * no puede ejecutarse sin un paso explícito adicional: marcar salida estando en
 * descanso cierra el descanso, y eso el empleado tiene que confirmarlo (§12).
 */
const TRANSITIONS: Record<
  AttendanceState,
  Partial<Record<TimeEventType, { nextState: AttendanceState; requiresConfirmation: boolean }>>
> = {
  OFF_SHIFT: {
    clock_in: { nextState: 'WORKING', requiresConfirmation: false },
  },
  WORKING: {
    break_start: { nextState: 'ON_BREAK', requiresConfirmation: false },
    clock_out: { nextState: 'OFF_SHIFT', requiresConfirmation: false },
  },
  ON_BREAK: {
    break_end: { nextState: 'WORKING', requiresConfirmation: false },
    clock_out: { nextState: 'OFF_SHIFT', requiresConfirmation: true },
  },
};

export function transition(state: AttendanceState, event: TimeEventType): TransitionResult {
  const target = TRANSITIONS[state][event];
  if (target === undefined) return { allowed: false, reason: 'invalid_transition' };
  return { allowed: true, ...target };
}

export function canTransition(state: AttendanceState, event: TimeEventType): boolean {
  return transition(state, event).allowed;
}

/** Eventos válidos desde un estado, en orden de importancia para la interfaz. */
export function allowedEvents(state: AttendanceState): TimeEventType[] {
  return TIME_EVENT_TYPES.filter((event) => canTransition(state, event));
}

/**
 * Acción principal de cada estado (§9.3).
 *
 * En descanso la acción principal es "Terminar descanso", nunca "Marcar salida":
 * la salida queda como opción secundaria con confirmación explícita, para que
 * nadie cierre su jornada creyendo que vuelve del almuerzo (§9.3, §33).
 */
export function primaryEvent(state: AttendanceState): TimeEventType {
  switch (state) {
    case 'OFF_SHIFT':
      return 'clock_in';
    case 'WORKING':
      return 'break_start';
    case 'ON_BREAK':
      return 'break_end';
  }
}

/** Acción secundaria, si el estado tiene una. */
export function secondaryEvent(state: AttendanceState): TimeEventType | null {
  return state === 'OFF_SHIFT' ? null : 'clock_out';
}

/** Un `clock_out` desde `ON_BREAK` obliga a cerrar el descanso abierto (§12). */
export function closesOpenBreak(state: AttendanceState, event: TimeEventType): boolean {
  return state === 'ON_BREAK' && event === 'clock_out';
}

/**
 * Reconstruye el estado a partir de la secuencia cruda de eventos.
 *
 * Los eventos son append-only (§14): el estado nunca se guarda como verdad
 * independiente, se deriva. Una secuencia imposible no se "corrige" en silencio:
 * se ignora el evento que no aplica y se devuelve en `rejected` para que el
 * gerente lo revise (§17).
 */
export function reduceEvents(events: readonly TimeEventType[]): {
  state: AttendanceState;
  rejected: number[];
} {
  let state: AttendanceState = 'OFF_SHIFT';
  const rejected: number[] = [];

  events.forEach((event, index) => {
    const result = transition(state, event);
    if (result.allowed) {
      state = result.nextState;
    } else {
      rejected.push(index);
    }
  });

  return { state, rejected };
}

export type ClockInEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'too_early'; earliestAt: string }
  | { eligible: false; reason: 'no_shift_and_not_allowed' };

/**
 * Reglas de entrada temprana (§13).
 *
 * Si es demasiado temprano no se bloquea en silencio: se explica a qué hora podrá
 * marcar, y un gerente puede autorizar la excepción con su PIN si la política lo
 * permite. `earlyClockInMinutes` es 10 por defecto.
 */
export function evaluateClockInEligibility(params: {
  now: Date;
  shiftStartsAt: Date | null;
  earlyClockInMinutes: number;
  allowUnscheduledShifts: boolean;
}): ClockInEligibility {
  const { now, shiftStartsAt, earlyClockInMinutes, allowUnscheduledShifts } = params;

  if (shiftStartsAt === null) {
    return allowUnscheduledShifts
      ? { eligible: true }
      : { eligible: false, reason: 'no_shift_and_not_allowed' };
  }

  const earliest = new Date(shiftStartsAt.getTime() - earlyClockInMinutes * 60_000);
  if (now < earliest) {
    return { eligible: false, reason: 'too_early', earliestAt: earliest.toISOString() };
  }

  return { eligible: true };
}

/**
 * ¿La entrada cuenta como tardanza? Se mide contra el turno publicado vigente en
 * ese momento, con la tolerancia configurada (`late_grace_minutes`, 5 por
 * defecto) (§13).
 */
export function isLateArrival(params: {
  clockInAt: Date;
  shiftStartsAt: Date;
  lateGraceMinutes: number;
}): boolean {
  const limit = new Date(params.shiftStartsAt.getTime() + params.lateGraceMinutes * 60_000);
  return params.clockInAt > limit;
}
