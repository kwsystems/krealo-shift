import {
  clockDriftSeconds,
  computeDuration,
  formatClockTime,
  formatLongDate,
  isSignificantDrift,
  minutesBetween,
  minutesToDecimalHours,
  minutesToHHmm,
  shiftCrossesMidnight,
  splitRegularAndOvertime,
} from '../time';

const LIMA = 'America/Lima'; // UTC-5, sin horario de verano
const MADRID = 'Europe/Madrid'; // con horario de verano, útil para probar offsets

describe('formato de hora y fecha', () => {
  it('muestra la hora en la zona de la ubicación, no en UTC', () => {
    // 15:30 UTC son 10:30 en Lima.
    expect(formatClockTime('2026-08-26T15:30:00Z', LIMA, '24h')).toBe('10:30');
  });

  it('respeta el formato de 12 horas cuando la ubicación lo pide', () => {
    expect(formatClockTime('2026-08-26T15:30:00Z', LIMA, '12h')).toMatch(/10:30/);
  });

  it('formatea la fecha larga según el idioma', () => {
    const es = formatLongDate('2026-08-26T15:30:00Z', LIMA, 'es-PE');
    const en = formatLongDate('2026-08-26T15:30:00Z', LIMA, 'en');
    expect(es).toContain('agosto');
    expect(en).toContain('August');
  });

  it('no revienta con una fecha inválida', () => {
    expect(formatClockTime('no-es-una-fecha', LIMA)).toBe('--:--');
  });
});

describe('duración con instantes UTC', () => {
  it('calcula minutos entre dos instantes', () => {
    expect(minutesBetween('2026-08-26T13:00:00Z', '2026-08-26T21:30:00Z')).toBe(510);
  });

  it('nunca devuelve una duración negativa', () => {
    expect(minutesBetween('2026-08-26T21:00:00Z', '2026-08-26T13:00:00Z')).toBe(0);
  });

  it('resta solo los descansos no pagados del tiempo neto', () => {
    const result = computeDuration({
      startsAt: '2026-08-26T13:00:00Z',
      endsAt: '2026-08-26T22:00:00Z',
      unpaidBreakMinutes: 60,
      paidBreakMinutes: 15,
    });
    expect(result.grossMinutes).toBe(540);
    expect(result.netMinutes).toBe(480);
    expect(result.paidBreakMinutes).toBe(15);
  });

  it('trata una sesión abierta como cero minutos, sin inventar una salida', () => {
    const result = computeDuration({ startsAt: '2026-08-26T13:00:00Z', endsAt: null });
    expect(result.netMinutes).toBe(0);
    expect(result.grossMinutes).toBe(0);
  });

  it('mide bien un turno que cruza medianoche', () => {
    // 22:00 a 06:00 hora de Lima = 8 horas reales.
    const result = computeDuration({
      startsAt: '2026-08-27T03:00:00Z', // 22:00 del 26 en Lima
      endsAt: '2026-08-27T11:00:00Z', // 06:00 del 27 en Lima
    });
    expect(result.netMinutes).toBe(480);
  });

  it('mide bien un turno que cruza un cambio de horario de verano', () => {
    // Madrid pasa de UTC+2 a UTC+1 el 25/10/2026 a las 03:00 local.
    // Un turno de 8 horas de reloj UTC sigue siendo 8 horas de trabajo real.
    const result = computeDuration({
      startsAt: '2026-10-24T22:00:00Z',
      endsAt: '2026-10-25T06:00:00Z',
    });
    expect(result.netMinutes).toBe(480);
  });
});

describe('detección de cruce de medianoche', () => {
  it('detecta el cruce en la zona de la ubicación', () => {
    expect(shiftCrossesMidnight('2026-08-27T03:00:00Z', '2026-08-27T11:00:00Z', LIMA)).toBe(true);
  });

  it('no marca cruce en un turno diurno normal', () => {
    expect(shiftCrossesMidnight('2026-08-26T14:00:00Z', '2026-08-26T22:00:00Z', LIMA)).toBe(false);
  });

  it('el mismo instante puede cruzar o no según la zona', () => {
    const start = '2026-08-26T21:00:00Z';
    const end = '2026-08-27T01:00:00Z';
    // En Lima: 16:00 → 20:00 del mismo día.
    expect(shiftCrossesMidnight(start, end, LIMA)).toBe(false);
    // En Madrid: 23:00 → 03:00 del día siguiente.
    expect(shiftCrossesMidnight(start, end, MADRID)).toBe(true);
  });
});

describe('conversión de duración a texto y decimal', () => {
  it('usa HH:mm como formato principal', () => {
    expect(minutesToHHmm(90)).toBe('01:30');
    expect(minutesToHHmm(0)).toBe('00:00');
    expect(minutesToHHmm(605)).toBe('10:05');
  });

  it('convierte a decimal correctamente: 1h30 es 1.50, no 1.30', () => {
    expect(minutesToDecimalHours(90)).toBe(1.5);
    expect(minutesToDecimalHours(75)).toBe(1.25);
    expect(minutesToDecimalHours(20)).toBe(0.33);
    expect(minutesToDecimalHours(480)).toBe(8);
  });
});

describe('separación de horas extra informativas', () => {
  it('no reporta extra por debajo del umbral', () => {
    expect(splitRegularAndOvertime(420, 480)).toEqual({
      regularMinutes: 420,
      overtimeMinutes: 0,
    });
  });

  it('separa el excedente cuando se pasa del umbral diario', () => {
    expect(splitRegularAndOvertime(540, 480)).toEqual({
      regularMinutes: 480,
      overtimeMinutes: 60,
    });
  });
});

describe('desvío del reloj del dispositivo', () => {
  it('mide el desvío en segundos con signo', () => {
    expect(clockDriftSeconds('2026-08-26T15:00:30Z', '2026-08-26T15:00:00Z')).toBe(30);
    expect(clockDriftSeconds('2026-08-26T14:59:00Z', '2026-08-26T15:00:00Z')).toBe(-60);
  });

  it('marca como significativo solo un desvío grande', () => {
    expect(isSignificantDrift(45)).toBe(false);
    expect(isSignificantDrift(-600)).toBe(true);
  });
});
