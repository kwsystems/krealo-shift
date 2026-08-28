import {
  allowedEvents,
  canTransition,
  closesOpenBreak,
  evaluateClockInEligibility,
  isLateArrival,
  primaryEvent,
  reduceEvents,
  secondaryEvent,
  transition,
  type TimeEventType,
} from '../attendance-state-machine';

describe('transiciones válidas', () => {
  it('permite fichar entrada solo estando fuera de turno', () => {
    expect(transition('OFF_SHIFT', 'clock_in')).toEqual({
      allowed: true,
      nextState: 'WORKING',
      requiresConfirmation: false,
    });
    expect(canTransition('WORKING', 'clock_in')).toBe(false);
    expect(canTransition('ON_BREAK', 'clock_in')).toBe(false);
  });

  it('permite iniciar descanso solo trabajando', () => {
    expect(canTransition('WORKING', 'break_start')).toBe(true);
    expect(canTransition('OFF_SHIFT', 'break_start')).toBe(false);
    expect(canTransition('ON_BREAK', 'break_start')).toBe(false);
  });

  it('permite terminar descanso solo estando en descanso', () => {
    expect(canTransition('ON_BREAK', 'break_end')).toBe(true);
    expect(canTransition('WORKING', 'break_end')).toBe(false);
  });

  it('rechaza toda transición imposible con un motivo, sin lanzar', () => {
    expect(transition('OFF_SHIFT', 'clock_out')).toEqual({
      allowed: false,
      reason: 'invalid_transition',
    });
    expect(transition('OFF_SHIFT', 'break_end')).toEqual({
      allowed: false,
      reason: 'invalid_transition',
    });
  });

  it('exige confirmación al marcar salida estando en descanso', () => {
    const result = transition('ON_BREAK', 'clock_out');
    expect(result).toEqual({
      allowed: true,
      nextState: 'OFF_SHIFT',
      requiresConfirmation: true,
    });
    expect(closesOpenBreak('ON_BREAK', 'clock_out')).toBe(true);
    expect(closesOpenBreak('WORKING', 'clock_out')).toBe(false);
  });
});

describe('acciones que ofrece la interfaz', () => {
  it('en descanso la acción principal es terminar el descanso, no marcar salida', () => {
    // Esta es la regla que evita que alguien cierre su jornada creyendo que
    // vuelve del almuerzo (§9.3, §33).
    expect(primaryEvent('ON_BREAK')).toBe('break_end');
    expect(secondaryEvent('ON_BREAK')).toBe('clock_out');
  });

  it('trabajando la principal es iniciar descanso y la secundaria marcar salida', () => {
    expect(primaryEvent('WORKING')).toBe('break_start');
    expect(secondaryEvent('WORKING')).toBe('clock_out');
  });

  it('fuera de turno solo ofrece marcar entrada', () => {
    expect(primaryEvent('OFF_SHIFT')).toBe('clock_in');
    expect(secondaryEvent('OFF_SHIFT')).toBeNull();
    expect(allowedEvents('OFF_SHIFT')).toEqual(['clock_in']);
  });
});

describe('reconstrucción del estado desde los eventos crudos', () => {
  it('deriva el estado de una jornada completa', () => {
    const events: TimeEventType[] = ['clock_in', 'break_start', 'break_end', 'clock_out'];
    expect(reduceEvents(events)).toEqual({ state: 'OFF_SHIFT', rejected: [] });
  });

  it('deja al empleado trabajando si aún no marcó salida', () => {
    expect(reduceEvents(['clock_in', 'break_start', 'break_end']).state).toBe('WORKING');
  });

  it('ignora un evento imposible y lo reporta en vez de corregirlo en silencio', () => {
    // Doble entrada: la segunda no puede aplicarse. No se descarta sin dejar
    // rastro — su índice se devuelve para que el gerente lo revise (§17).
    const result = reduceEvents(['clock_in', 'clock_in', 'clock_out']);
    expect(result.state).toBe('OFF_SHIFT');
    expect(result.rejected).toEqual([1]);
  });

  it('una secuencia vacía deja al empleado fuera de turno', () => {
    expect(reduceEvents([])).toEqual({ state: 'OFF_SHIFT', rejected: [] });
  });

  it('parte del estado inicial que se le pase, para el kiosco sin conexión', () => {
    // Alguien fichó entrada con red y después se cayó la conexión. Partir de
    // OFF_SHIFT diría que está fuera de turno y le ofrecería marcar entrada otra
    // vez; partiendo del estado confirmado por el servidor, la cola local se
    // aplica encima y el estado es el correcto (§9.7).
    expect(reduceEvents(['break_start'], 'WORKING')).toEqual({
      state: 'ON_BREAK',
      rejected: [],
    });

    expect(reduceEvents([], 'ON_BREAK')).toEqual({ state: 'ON_BREAK', rejected: [] });

    // Y una transición imposible sobre el estado inicial sigue rechazándose.
    expect(reduceEvents(['clock_in'], 'WORKING')).toEqual({
      state: 'WORKING',
      rejected: [0],
    });
  });

  it('una jornada completa encolada sobre un estado confirmado cuadra', () => {
    expect(reduceEvents(['break_start', 'break_end', 'clock_out'], 'WORKING').state).toBe(
      'OFF_SHIFT',
    );
  });
});

describe('política de entrada temprana', () => {
  const base = { earlyClockInMinutes: 10, allowUnscheduledShifts: true };

  it('bloquea la entrada antes de la tolerancia y dice desde cuándo se puede', () => {
    const result = evaluateClockInEligibility({
      ...base,
      now: new Date('2026-08-26T13:30:00Z'),
      shiftStartsAt: new Date('2026-08-26T14:00:00Z'),
    });
    expect(result).toEqual({
      eligible: false,
      reason: 'too_early',
      earliestAt: '2026-08-26T13:50:00.000Z',
    });
  });

  it('permite la entrada dentro de la tolerancia', () => {
    expect(
      evaluateClockInEligibility({
        ...base,
        now: new Date('2026-08-26T13:52:00Z'),
        shiftStartsAt: new Date('2026-08-26T14:00:00Z'),
      }),
    ).toEqual({ eligible: true });
  });

  it('permite trabajar sin turno solo si la ubicación lo autoriza', () => {
    const now = new Date('2026-08-26T14:00:00Z');
    expect(evaluateClockInEligibility({ ...base, now, shiftStartsAt: null })).toEqual({
      eligible: true,
    });

    expect(
      evaluateClockInEligibility({
        ...base,
        allowUnscheduledShifts: false,
        now,
        shiftStartsAt: null,
      }),
    ).toEqual({ eligible: false, reason: 'no_shift_and_not_allowed' });
  });
});

describe('tardanza', () => {
  it('no marca tardanza dentro de la tolerancia', () => {
    expect(
      isLateArrival({
        clockInAt: new Date('2026-08-26T14:04:00Z'),
        shiftStartsAt: new Date('2026-08-26T14:00:00Z'),
        lateGraceMinutes: 5,
      }),
    ).toBe(false);
  });

  it('marca tardanza pasada la tolerancia', () => {
    expect(
      isLateArrival({
        clockInAt: new Date('2026-08-26T14:06:00Z'),
        shiftStartsAt: new Date('2026-08-26T14:00:00Z'),
        lateGraceMinutes: 5,
      }),
    ).toBe(true);
  });
});
