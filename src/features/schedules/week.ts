import { TZDate } from '@date-fns/tz';
import { format, isValid, parseISO } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

import type { SupportedLanguage } from '@/i18n';

/**
 * Aritmética de semanas y de fechas locales del editor de horarios (§11.3, §13).
 *
 * Reglas que impone este archivo:
 *   - una fecha de calendario ("2026-08-27") se manipula como calendario, con
 *     aritmética en UTC, para que sumar un día nunca dependa del huso del
 *     dispositivo ni del horario de verano;
 *   - una hora local ("09:00") solo se convierte a instante junto con su fecha y
 *     su zona horaria. Nunca se restan cadenas de hora local (§13);
 *   - el primer día de la semana es configurable por organización (§13).
 */

/** Fecha de calendario en formato `yyyy-MM-dd`. No lleva hora ni zona. */
export type DateKey = string;

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateFnsLocales = { 'es-PE': es, en: enUS } as const;

function parseKey(key: DateKey): { year: number; month: number; day: number } | null {
  const match = KEY_PATTERN.exec(key);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function keyToUtc(key: DateKey): Date | null {
  const parts = parseKey(key);
  if (parts === null) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function utcToKey(date: Date): DateKey {
  return date.toISOString().slice(0, 10);
}

/** Suma (o resta) días de calendario a una fecha `yyyy-MM-dd`. */
export function addDaysToKey(key: DateKey, days: number): DateKey {
  const utc = keyToUtc(key);
  if (utc === null) return key;
  utc.setUTCDate(utc.getUTCDate() + days);
  return utcToKey(utc);
}

/** Día de la semana de una fecha de calendario: 0 domingo … 6 sábado. */
export function dayOfWeek(key: DateKey): number {
  const utc = keyToUtc(key);
  return utc === null ? 0 : utc.getUTCDay();
}

/** Fecha de calendario de un instante, en la zona horaria de la ubicación. */
export function dateKeyOf(instant: Date | string, timezone: string): DateKey {
  const parsed = typeof instant === 'string' ? parseISO(instant) : instant;
  if (!isValid(parsed)) return '';
  return format(new TZDate(parsed, timezone), 'yyyy-MM-dd');
}

/** Hora local `HH:mm` de un instante, para precargar el formulario de turno. */
export function localTimeOf(instant: Date | string, timezone: string): string {
  const parsed = typeof instant === 'string' ? parseISO(instant) : instant;
  if (!isValid(parsed)) return '';
  return format(new TZDate(parsed, timezone), 'HH:mm');
}

/** Inicio de la semana que contiene esa fecha, según el primer día configurado. */
export function weekStartOfKey(key: DateKey, weekStartsOn: number): DateKey {
  const first = ((weekStartsOn % 7) + 7) % 7;
  const diff = (dayOfWeek(key) - first + 7) % 7;
  return addDaysToKey(key, -diff);
}

/** Inicio de la semana actual en la zona horaria de la ubicación. */
export function currentWeekStart(
  now: Date | string,
  weekStartsOn: number,
  timezone: string,
): DateKey {
  return weekStartOfKey(dateKeyOf(now, timezone), weekStartsOn);
}

/** Las siete fechas de una semana, en orden. */
export function weekDays(weekStart: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStart, index));
}

export function addWeeks(weekStart: DateKey, weeks: number): DateKey {
  return addDaysToKey(weekStart, weeks * 7);
}

/** Último día de la semana: lo usan los filtros de rango. */
export function weekEnd(weekStart: DateKey): DateKey {
  return addDaysToKey(weekStart, 6);
}

export type WeekPosition = 'past' | 'current' | 'future';

export function weekPosition(
  weekStart: DateKey,
  now: Date | string,
  weekStartsOn: number,
  timezone: string,
): WeekPosition {
  const current = currentWeekStart(now, weekStartsOn, timezone);
  if (weekStart === current) return 'current';
  return weekStart < current ? 'past' : 'future';
}

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidLocalTime(value: string): boolean {
  return TIME_PATTERN.test(value.trim());
}

/** Minutos desde medianoche de una hora local `HH:mm`. */
export function localTimeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToLocalTime(minutes: number): string {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(safe / 60);
  return `${String(hours).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Convierte fecha de calendario + hora local + zona horaria en un instante UTC.
 *
 * Es la única forma correcta de guardar un turno: la base almacena
 * `timestamptz`, así que "09:00 en Lima" y "09:00 en Madrid" son instantes
 * distintos y no se pueden confundir.
 */
export function localDateTimeToInstant(
  dateKey: DateKey,
  localTime: string,
  timezone: string,
): string | null {
  const parts = parseKey(dateKey);
  const minutes = localTimeToMinutes(localTime);
  if (parts === null || minutes === null) return null;

  const zoned = new TZDate(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutes / 60),
    minutes % 60,
    timezone,
  );
  if (!isValid(zoned)) return null;
  return new Date(zoned.getTime()).toISOString();
}

/**
 * Instantes de inicio y fin de un turno. Si el fin es menor o igual al inicio,
 * el turno cruza medianoche y el fin cae al día siguiente (§11.3).
 */
export function shiftInstants(params: {
  dateKey: DateKey;
  startTime: string;
  endTime: string;
  timezone: string;
}): { startsAt: string; endsAt: string; crossesMidnight: boolean } | null {
  const { dateKey, startTime, endTime, timezone } = params;
  const startMinutes = localTimeToMinutes(startTime);
  const endMinutes = localTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) return null;

  const crossesMidnight = endMinutes <= startMinutes;
  const endDateKey = crossesMidnight ? addDaysToKey(dateKey, 1) : dateKey;

  const startsAt = localDateTimeToInstant(dateKey, startTime, timezone);
  const endsAt = localDateTimeToInstant(endDateKey, endTime, timezone);
  if (startsAt === null || endsAt === null) return null;

  return { startsAt, endsAt, crossesMidnight };
}

/** Rango de instantes que cubre una semana completa, para consultar turnos. */
export function weekRangeInstants(
  weekStart: DateKey,
  timezone: string,
): { fromISO: string; toISO: string } {
  const from = localDateTimeToInstant(weekStart, '00:00', timezone);
  const to = localDateTimeToInstant(addDaysToKey(weekStart, 7), '00:00', timezone);
  return {
    fromISO: from ?? new Date(0).toISOString(),
    toISO: to ?? new Date(0).toISOString(),
  };
}

/** Nombre corto del día para las columnas del iPad: "lun 25". */
export function formatDayColumn(key: DateKey, language: SupportedLanguage): string {
  const utc = keyToUtc(key);
  if (utc === null) return key;
  return format(utc, 'EEE d', { locale: dateFnsLocales[language] });
}

/** Fecha larga del encabezado: "27 de agosto de 2026". */
export function formatDateKeyLong(key: DateKey, language: SupportedLanguage): string {
  const utc = keyToUtc(key);
  if (utc === null) return key;
  const pattern = language === 'es-PE' ? "d 'de' MMMM 'de' yyyy" : 'MMMM d, yyyy';
  return format(utc, pattern, { locale: dateFnsLocales[language] });
}

/** Fecha corta para tarjetas y filtros: "25 ago". */
export function formatDateKeyShort(key: DateKey, language: SupportedLanguage): string {
  const utc = keyToUtc(key);
  if (utc === null) return key;
  return format(utc, 'd MMM', { locale: dateFnsLocales[language] });
}
