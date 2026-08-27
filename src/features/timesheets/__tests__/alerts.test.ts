import { alertsForSession, overlappingSessionIds } from '../alerts';
import type { DailySummary, WorkSession } from '../api';
import { computeTotals } from '../hooks';

/**
 * Las alertas y los totales deciden qué revisa un gerente. Una alerta que no
 * salta es una hora que nadie mira; un total mal separado convierte horas
 * normales en horas extra informativas que no son.
 */

function session(overrides: Partial<WorkSession> & { id: string }): WorkSession {
  return {
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: null,
    starts_at: '2026-08-27T14:00:00.000Z',
    ends_at: '2026-08-27T22:00:00.000Z',
    gross_minutes: 480,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: 480,
    status: 'complete',
    flags: [],
    updated_at: '2026-08-27T22:00:01.000Z',
    ...overrides,
  };
}

const NOW = '2026-08-28T14:00:00.000Z';

describe('alertas de una sesión', () => {
  it('una jornada normal no genera alertas', () => {
    expect(alertsForSession(session({ id: 'a' }), NOW)).toEqual([]);
  });

  it('traduce las marcas del servidor', () => {
    const alerts = alertsForSession(
      session({ id: 'a', flags: ['late_arrival', 'clock_drift', 'unscheduled'] }),
      NOW,
    );

    expect(alerts).toContain('lateArrival');
    expect(alerts).toContain('clockDrift');
    expect(alerts).toContain('unscheduled');
  });

  it('marca falta de salida cuando la sesión sigue abierta demasiadas horas', () => {
    const alerts = alertsForSession(
      session({ id: 'a', ends_at: null, net_minutes: null, status: 'open' }),
      NOW,
    );

    expect(alerts).toContain('missingClockOut');
  });

  it('no marca falta de salida en un turno abierto que empezó hace poco', () => {
    const alerts = alertsForSession(
      session({
        id: 'a',
        starts_at: '2026-08-28T12:00:00.000Z',
        ends_at: null,
        net_minutes: null,
        status: 'open',
      }),
      NOW,
    );

    expect(alerts).not.toContain('missingClockOut');
  });

  it('marca duración inusual y necesidad de revisión', () => {
    const alerts = alertsForSession(
      session({ id: 'a', net_minutes: 15 * 60, status: 'needs_review' }),
      NOW,
    );

    expect(alerts).toContain('abnormalDuration');
    expect(alerts).toContain('needsReview');
  });

  it('no repite una alerta que llega dos veces', () => {
    const alerts = alertsForSession(
      session({ id: 'a', flags: ['late_arrival', 'late_arrival'] }),
      NOW,
    );

    expect(alerts).toEqual(['lateArrival']);
  });
});

describe('solapamiento entre sesiones', () => {
  it('marca las dos sesiones que se pisan', () => {
    const ids = overlappingSessionIds([
      session({ id: 'a' }),
      session({
        id: 'b',
        starts_at: '2026-08-27T20:00:00.000Z',
        ends_at: '2026-08-28T02:00:00.000Z',
      }),
    ]);

    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('no marca sesiones consecutivas de la misma persona', () => {
    const ids = overlappingSessionIds([
      session({ id: 'a' }),
      session({
        id: 'b',
        starts_at: '2026-08-27T22:00:00.000Z',
        ends_at: '2026-08-28T02:00:00.000Z',
      }),
    ]);

    expect(ids.size).toBe(0);
  });

  it('no cruza empleados distintos', () => {
    const ids = overlappingSessionIds([
      session({ id: 'a' }),
      session({ id: 'b', employee_id: 'e2' }),
    ]);

    expect(ids.size).toBe(0);
  });

  it('una sesión abierta seguida de otra siempre es solapamiento', () => {
    const ids = overlappingSessionIds([
      session({ id: 'a', ends_at: null, status: 'open' }),
      session({ id: 'b', starts_at: '2026-08-28T14:00:00.000Z' }),
    ]);

    expect([...ids].sort()).toEqual(['a', 'b']);
  });
});

describe('totales del periodo', () => {
  function day(overrides: Partial<DailySummary> = {}): DailySummary {
    return {
      employee_id: 'e1',
      location_id: 'l1',
      work_date: '2026-08-27',
      sessions: 1,
      gross_minutes: 480,
      paid_break_minutes: 0,
      unpaid_break_minutes: 0,
      net_minutes: 480,
      needs_review: false,
      flags: [],
      ...overrides,
    };
  }

  it('separa regulares y extra informativas contra el umbral diario', () => {
    const totals = computeTotals(
      [day(), day({ work_date: '2026-08-28', net_minutes: 600, gross_minutes: 600 })],
      480,
    );

    expect(totals.netMinutes).toBe(1080);
    expect(totals.regularMinutes).toBe(960);
    expect(totals.overtimeMinutes).toBe(120);
  });

  it('cuenta los días que necesitan revisión', () => {
    const totals = computeTotals(
      [day({ needs_review: true }), day({ work_date: '2026-08-28' })],
      480,
    );
    expect(totals.needsReviewDays).toBe(1);
  });

  it('suma descansos pagados y no pagados por separado', () => {
    const totals = computeTotals([day({ paid_break_minutes: 15, unpaid_break_minutes: 60 })], 480);

    expect(totals.paidBreakMinutes).toBe(15);
    expect(totals.unpaidBreakMinutes).toBe(60);
  });
});
