import {
  addDaysToKey,
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  formatDateKeyShort,
  isValidLocalTime,
  localDateTimeToInstant,
  localTimeOf,
  localTimeToMinutes,
  minutesToLocalTime,
  shiftInstants,
  weekDays,
  weekEnd,
  weekPosition,
  weekStartOfKey,
} from '../week';

/**
 * El editor de horarios se apoya entero en estas funciones: si suman mal un día
 * o construyen mal un instante, los turnos aparecen el día equivocado o con una
 * hora de diferencia después de un cambio de horario de verano.
 */

describe('aritmética de fechas de calendario', () => {
  it('suma y resta días sin depender del huso del dispositivo', () => {
    expect(addDaysToKey('2026-08-27', 1)).toBe('2026-08-28');
    expect(addDaysToKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToKey('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('encuentra el inicio de semana según el primer día configurado', () => {
    // 2026-08-27 es jueves.
    expect(weekStartOfKey('2026-08-27', 1)).toBe('2026-08-24');
    expect(weekStartOfKey('2026-08-27', 0)).toBe('2026-08-23');
    expect(weekStartOfKey('2026-08-24', 1)).toBe('2026-08-24');
  });

  it('devuelve las siete fechas de la semana y su último día', () => {
    expect(weekDays('2026-08-24')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
    expect(weekEnd('2026-08-24')).toBe('2026-08-30');
    expect(addWeeks('2026-08-24', -1)).toBe('2026-08-17');
  });

  it('sitúa la semana en pasado, presente o futuro', () => {
    const now = '2026-08-27T14:00:00.000Z';
    expect(weekPosition('2026-08-24', now, 1, 'America/Lima')).toBe('current');
    expect(weekPosition('2026-08-17', now, 1, 'America/Lima')).toBe('past');
    expect(weekPosition('2026-08-31', now, 1, 'America/Lima')).toBe('future');
    expect(currentWeekStart(now, 1, 'America/Lima')).toBe('2026-08-24');
  });
});

describe('horas locales', () => {
  it('valida el formato HH:mm', () => {
    expect(isValidLocalTime('09:00')).toBe(true);
    expect(isValidLocalTime('23:59')).toBe(true);
    expect(isValidLocalTime('24:00')).toBe(false);
    expect(isValidLocalTime('9:0')).toBe(false);
    expect(isValidLocalTime('nueve')).toBe(false);
  });

  it('convierte a minutos y vuelve', () => {
    expect(localTimeToMinutes('09:30')).toBe(570);
    expect(localTimeToMinutes('00:00')).toBe(0);
    expect(localTimeToMinutes('mal')).toBeNull();
    expect(minutesToLocalTime(570)).toBe('09:30');
    expect(minutesToLocalTime(0)).toBe('00:00');
  });
});

describe('fecha local + hora local → instante', () => {
  it('respeta la zona horaria de la ubicación', () => {
    expect(localDateTimeToInstant('2026-08-27', '09:00', 'America/Lima')).toBe(
      '2026-08-27T14:00:00.000Z',
    );
  });

  it('no arrastra la hora al cruzar un cambio de horario de verano', () => {
    // En Nueva York el segundo domingo de marzo de 2026 se adelanta el reloj.
    // Las 09:00 locales del lunes siguiente NO son 168 horas después.
    expect(localDateTimeToInstant('2026-03-02', '09:00', 'America/New_York')).toBe(
      '2026-03-02T14:00:00.000Z',
    );
    expect(localDateTimeToInstant('2026-03-09', '09:00', 'America/New_York')).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });

  it('rechaza datos inválidos en lugar de inventar una hora', () => {
    expect(localDateTimeToInstant('2026-13-01', '09:00', 'America/Lima')).toBeNull();
    expect(localDateTimeToInstant('2026-08-27', '99:99', 'America/Lima')).toBeNull();
  });
});

describe('turno que cruza medianoche', () => {
  it('manda el fin al día siguiente cuando el fin es menor o igual al inicio', () => {
    const result = shiftInstants({
      dateKey: '2026-08-27',
      startTime: '22:00',
      endTime: '06:00',
      timezone: 'America/Lima',
    });

    expect(result).not.toBeNull();
    expect(result?.crossesMidnight).toBe(true);
    expect(result?.startsAt).toBe('2026-08-28T03:00:00.000Z');
    expect(result?.endsAt).toBe('2026-08-28T11:00:00.000Z');
  });

  it('deja el fin el mismo día en un turno normal', () => {
    const result = shiftInstants({
      dateKey: '2026-08-27',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'America/Lima',
    });

    expect(result?.crossesMidnight).toBe(false);
    expect(result?.startsAt).toBe('2026-08-27T14:00:00.000Z');
    expect(result?.endsAt).toBe('2026-08-27T22:00:00.000Z');
  });
});

describe('lectura de un instante en la zona de la ubicación', () => {
  it('devuelve la fecha y la hora locales, no las del dispositivo', () => {
    // 04:00 UTC del 28 es todavía el 27 a las 23:00 en Lima.
    expect(dateKeyOf('2026-08-28T04:00:00.000Z', 'America/Lima')).toBe('2026-08-27');
    expect(localTimeOf('2026-08-28T04:00:00.000Z', 'America/Lima')).toBe('23:00');
  });

  it('formatea la fecha corta en el idioma pedido', () => {
    expect(formatDateKeyShort('2026-08-27', 'en')).toBe('27 Aug');
    expect(formatDateKeyShort('2026-08-27', 'es-PE')).toContain('27');
  });
});
