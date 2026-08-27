import {
  collectScheduleWarnings,
  detectOverlaps,
  detectShortRest,
  detectWeeklyExcess,
  scheduledMinutesByEmployee,
  shiftScheduledMinutes,
  warningsForShift,
  type ScheduledShift,
} from '../conflicts';

/**
 * Los conflictos son la red de seguridad antes de publicar: un solapamiento que
 * no se detecta llega al empleado como dos turnos a la vez, y un total semanal
 * mal sumado se convierte en una discusión de nómina.
 */

function shift(overrides: Partial<ScheduledShift> & { id: string }): ScheduledShift {
  return {
    employeeId: 'e1',
    employeeName: 'Ana',
    startsAt: '2026-08-24T14:00:00.000Z',
    endsAt: '2026-08-24T22:00:00.000Z',
    plannedUnpaidBreakMinutes: 0,
    status: 'draft',
    ...overrides,
  };
}

describe('minutos programados', () => {
  it('resta el descanso no pagado planificado', () => {
    expect(shiftScheduledMinutes(shift({ id: 'a' }))).toBe(480);
    expect(shiftScheduledMinutes(shift({ id: 'a', plannedUnpaidBreakMinutes: 60 }))).toBe(420);
  });

  it('nunca devuelve un total negativo', () => {
    expect(shiftScheduledMinutes(shift({ id: 'a', plannedUnpaidBreakMinutes: 600 }))).toBe(0);
  });

  it('suma por empleado e ignora los turnos cancelados', () => {
    const totals = scheduledMinutesByEmployee([
      shift({ id: 'a' }),
      shift({ id: 'b', startsAt: '2026-08-25T14:00:00.000Z', endsAt: '2026-08-25T20:00:00.000Z' }),
      shift({ id: 'c', status: 'cancelled' }),
      shift({ id: 'd', employeeId: 'e2', employeeName: 'Luis' }),
    ]);

    expect(totals.get('e1')).toBe(480 + 360);
    expect(totals.get('e2')).toBe(480);
  });
});

describe('solapamientos', () => {
  it('detecta dos turnos que se pisan del mismo empleado', () => {
    const warnings = detectOverlaps([
      shift({ id: 'a' }),
      shift({ id: 'b', startsAt: '2026-08-24T20:00:00.000Z', endsAt: '2026-08-25T02:00:00.000Z' }),
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'overlap', employeeId: 'e1' });
  });

  it('no marca un relevo que solo se toca en el minuto de cambio', () => {
    const warnings = detectOverlaps([
      shift({ id: 'a' }),
      shift({ id: 'b', startsAt: '2026-08-24T22:00:00.000Z', endsAt: '2026-08-25T02:00:00.000Z' }),
    ]);

    expect(warnings).toEqual([]);
  });

  it('no confunde turnos simultáneos de personas distintas', () => {
    const warnings = detectOverlaps([
      shift({ id: 'a' }),
      shift({ id: 'b', employeeId: 'e2', employeeName: 'Luis' }),
    ]);

    expect(warnings).toEqual([]);
  });

  it('ignora los turnos cancelados', () => {
    const warnings = detectOverlaps([
      shift({ id: 'a' }),
      shift({
        id: 'b',
        status: 'cancelled',
        startsAt: '2026-08-24T20:00:00.000Z',
        endsAt: '2026-08-25T02:00:00.000Z',
      }),
    ]);

    expect(warnings).toEqual([]);
  });
});

describe('descanso insuficiente', () => {
  it('advierte cuando entre dos turnos queda menos del mínimo', () => {
    const warnings = detectShortRest(
      [
        shift({ id: 'a', endsAt: '2026-08-24T22:00:00.000Z' }),
        shift({
          id: 'b',
          startsAt: '2026-08-25T04:00:00.000Z',
          endsAt: '2026-08-25T12:00:00.000Z',
        }),
      ],
      // 11 horas de descanso mínimo.
      660,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'shortRest', restMinutes: 360 });
  });

  it('no advierte cuando el descanso alcanza el mínimo', () => {
    const warnings = detectShortRest(
      [
        shift({ id: 'a', endsAt: '2026-08-24T22:00:00.000Z' }),
        shift({
          id: 'b',
          startsAt: '2026-08-25T09:00:00.000Z',
          endsAt: '2026-08-25T17:00:00.000Z',
        }),
      ],
      660,
    );

    expect(warnings).toEqual([]);
  });

  it('con el mínimo en cero no advierte nunca', () => {
    const warnings = detectShortRest(
      [
        shift({ id: 'a' }),
        shift({
          id: 'b',
          startsAt: '2026-08-24T23:00:00.000Z',
          endsAt: '2026-08-25T03:00:00.000Z',
        }),
      ],
      0,
    );

    expect(warnings).toEqual([]);
  });
});

describe('exceso semanal', () => {
  it('advierte al pasar el límite configurado', () => {
    const warnings = detectWeeklyExcess(
      [
        shift({ id: 'a' }),
        shift({
          id: 'b',
          startsAt: '2026-08-25T14:00:00.000Z',
          endsAt: '2026-08-26T02:00:00.000Z',
        }),
      ],
      // 16 horas de límite semanal para el ejemplo.
      960,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'weeklyExcess', minutes: 1200, limitMinutes: 960 });
  });

  it('no advierte si el límite es cero, porque no hay límite configurado', () => {
    expect(detectWeeklyExcess([shift({ id: 'a' })], 0)).toEqual([]);
  });
});

describe('advertencias combinadas', () => {
  it('reúne solapamiento, descanso y exceso, y las asocia a sus turnos', () => {
    const shifts = [
      shift({ id: 'a' }),
      shift({ id: 'b', startsAt: '2026-08-24T20:00:00.000Z', endsAt: '2026-08-25T06:00:00.000Z' }),
    ];

    const warnings = collectScheduleWarnings(shifts, {
      minimumRestMinutes: 660,
      weeklyLimitMinutes: 600,
    });

    expect(warnings.map((warning) => warning.kind)).toContain('overlap');
    expect(warnings.map((warning) => warning.kind)).toContain('weeklyExcess');

    // El total semanal no se ancla a un turno concreto y no debe marcar tarjetas.
    const forShift = warningsForShift(warnings, 'a');
    expect(forShift).toHaveLength(1);
    expect(forShift[0]?.kind).toBe('overlap');
  });
});
