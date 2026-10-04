import { TZDate } from '@date-fns/tz';
import { differenceInMinutes, format, isValid, parseISO } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

import type { SupportedLanguage } from '@/i18n';

/**
 * Fecha, hora y duración (especificación §13).
 *
 * Regla central: las duraciones se calculan con instantes UTC, nunca restando
 * cadenas de hora local. Restar "22:00" de "06:00" da un número negativo y
 * absurdo cuando el turno cruza medianoche o cambia la zona horaria.
 */

export type TimeFormatPreference = '12h' | '24h';

const dateFnsLocales = { 'es-PE': es, en: enUS } as const;

function localeFor(language: SupportedLanguage) {
  return dateFnsLocales[language];
}

/** Convierte una fecha a la zona horaria de la ubicación, sin perder el instante. */
export function inZone(instant: Date | string, timezone: string): TZDate {
  const date = typeof instant === 'string' ? parseISO(instant) : instant;
  return new TZDate(date, timezone);
}

/** Hora de reloj: 09:05 o 9:05 a. m. según la preferencia de la ubicación. */
export function formatClockTime(
  instant: Date | string,
  timezone: string,
  preference: TimeFormatPreference = '24h',
  language: SupportedLanguage = 'es-PE',
): string {
  const zoned = inZone(instant, timezone);
  if (!isValid(zoned)) return '--:--';
  const pattern = preference === '24h' ? 'HH:mm' : 'h:mm a';
  return format(zoned, pattern, { locale: localeFor(language) });
}

/** Fecha completa para la pantalla de reposo del kiosco: "martes, 26 de agosto". */
export function formatLongDate(
  instant: Date | string,
  timezone: string,
  language: SupportedLanguage = 'es-PE',
): string {
  const zoned = inZone(instant, timezone);
  if (!isValid(zoned)) return '';
  const pattern = language === 'es-PE' ? "EEEE, d 'de' MMMM" : 'EEEE, MMMM d';
  return format(zoned, pattern, { locale: localeFor(language) });
}

/**
 * El día en corto, para ponerlo junto a unas horas: «sáb 3 oct» o «Sat, Oct 3».
 *
 * Existe por el reloj (4-oct): ofrecía «10:00 – 22:00» y «10:00 – 21:00» para elegir, y
 * uno era de hoy y el otro de mañana sin que nada lo dijera.
 */
export function formatShortDay(
  instant: Date | string,
  timezone: string,
  language: SupportedLanguage = 'es-PE',
): string {
  const zoned = inZone(instant, timezone);
  if (!isValid(zoned)) return '';
  const pattern = language === 'es-PE' ? 'EEE d MMM' : 'EEE, MMM d';
  return format(zoned, pattern, { locale: localeFor(language) }).replace(/\./g, '');
}

export function formatShiftRange(
  startsAt: Date | string,
  endsAt: Date | string,
  timezone: string,
  preference: TimeFormatPreference = '24h',
  language: SupportedLanguage = 'es-PE',
): string {
  return `${formatClockTime(startsAt, timezone, preference, language)} – ${formatClockTime(
    endsAt,
    timezone,
    preference,
    language,
  )}`;
}

/**
 * Duración en minutos entre dos instantes. Devuelve 0 si el fin es anterior al
 * inicio: un valor negativo nunca es una duración válida y esconder el problema
 * sería peor que mostrarlo como cero y marcarlo para revisión.
 */
export function minutesBetween(from: Date | string, to: Date | string): number {
  const start = typeof from === 'string' ? parseISO(from) : from;
  const end = typeof to === 'string' ? parseISO(to) : to;
  if (!isValid(start) || !isValid(end)) return 0;
  return Math.max(0, differenceInMinutes(end, start));
}

/** Formato principal de duración: HH:mm (§13). 90 minutos → "01:30". */
export function minutesToHHmm(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Conversión a decimal para exportaciones (§13).
 * 1 h 30 min = 1.50 h, NO 1.30. Este es un error clásico de nómina.
 */
export function minutesToDecimalHours(totalMinutes: number): number {
  const safe = Math.max(0, Math.round(totalMinutes));
  return Math.round((safe / 60) * 100) / 100;
}

export type DurationBreakdown = {
  grossMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  netMinutes: number;
};

/**
 * Desglose de una sesión de trabajo (§13):
 * tiempo trabajado = salida - entrada - descansos no pagados.
 *
 * Los descansos pagados se informan aparte pero no se restan del neto.
 */
export function computeDuration(params: {
  startsAt: Date | string;
  endsAt: Date | string | null;
  paidBreakMinutes?: number;
  unpaidBreakMinutes?: number;
}): DurationBreakdown {
  const { startsAt, endsAt, paidBreakMinutes = 0, unpaidBreakMinutes = 0 } = params;

  if (endsAt === null) {
    return { grossMinutes: 0, paidBreakMinutes, unpaidBreakMinutes, netMinutes: 0 };
  }

  const grossMinutes = minutesBetween(startsAt, endsAt);
  const netMinutes = Math.max(0, grossMinutes - Math.max(0, unpaidBreakMinutes));

  return {
    grossMinutes,
    paidBreakMinutes: Math.max(0, paidBreakMinutes),
    unpaidBreakMinutes: Math.max(0, unpaidBreakMinutes),
    netMinutes,
  };
}

/**
 * Separa los minutos de un día en regulares y extra.
 *
 * EXTRA ES LO APROBADO, NO LO QUE PASA DE UN UMBRAL (30-sep). Antes el segundo argumento
 * era el umbral diario —8 h— y todo lo que lo pasaba salía como extra: diez minutos de
 * antes al entrar, o el turno programado de 12 h de alguien que solo cumplió su horario.
 * Ahora son los minutos que quien gestiona aprobó para esa persona ese día (ver
 * `horas-extra.ts`), y nunca más que lo trabajado. La app resume tiempo: no calcula
 * remuneración (§13).
 */
export function splitRegularAndOvertime(
  netMinutes: number,
  approvedOvertimeMinutes: number,
): { regularMinutes: number; overtimeMinutes: number } {
  const safe = Math.max(0, netMinutes);
  const extra = Math.min(safe, Math.max(0, approvedOvertimeMinutes));
  return { regularMinutes: safe - extra, overtimeMinutes: extra };
}

/** Un turno cruza medianoche cuando su fin cae en otro día local que su inicio. */
export function shiftCrossesMidnight(
  startsAt: Date | string,
  endsAt: Date | string,
  timezone: string,
): boolean {
  const start = inZone(startsAt, timezone);
  const end = inZone(endsAt, timezone);
  return format(start, 'yyyy-MM-dd') !== format(end, 'yyyy-MM-dd');
}

/**
 * Diferencia entre el reloj del dispositivo y el del servidor, en segundos.
 * Se conserva para mostrarle al gerente cualquier desvío significativo (§12).
 */
export function clockDriftSeconds(
  deviceInstant: Date | string,
  serverInstant: Date | string,
): number {
  const device = typeof deviceInstant === 'string' ? parseISO(deviceInstant) : deviceInstant;
  const server = typeof serverInstant === 'string' ? parseISO(serverInstant) : serverInstant;
  if (!isValid(device) || !isValid(server)) return 0;
  return Math.round((device.getTime() - server.getTime()) / 1000);
}

/** Umbral a partir del cual el desvío de reloj se considera digno de revisión. */
export const SIGNIFICANT_CLOCK_DRIFT_SECONDS = 120;

export function isSignificantDrift(driftSeconds: number): boolean {
  return Math.abs(driftSeconds) > SIGNIFICANT_CLOCK_DRIFT_SECONDS;
}
