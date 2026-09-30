import {
  addDaysToKey,
  dateKeyOf,
  localDateTimeToInstant,
  localTimeToMinutes,
  minutesToLocalTime,
} from '@/features/schedules/week';

/**
 * «14:30» COMO INSTANTE, en la zona de la tienda (30-sep).
 *
 * Se mandaba lo tecleado tal cual y la solicitud llegaba a la Bandeja sin fecha y con la
 * hora en «--:--». Hoy a esa hora, o AYER si hoy todavía no llegó: lo que se olvida marcar
 * ya pasó, y quien olvidó la salida de las 19:00 lo cuenta a la mañana siguiente. `null`
 * si no se entiende como hora, para decirlo antes de enviar.
 */
export function horaPropuestaComoInstante(
  tecleada: string,
  timezone: string,
  ahora: Date = new Date(),
): string | null {
  const limpia = tecleada.trim().replace(/[.h]/, ':');
  const minutos = localTimeToMinutes(
    /^\d{3,4}$/.test(limpia) ? `${limpia.slice(0, -2)}:${limpia.slice(-2)}` : limpia,
  );
  if (minutos === null || minutos >= 24 * 60) return null;
  const hora = minutesToLocalTime(minutos);
  const hoy = dateKeyOf(ahora, timezone);
  const deHoy = localDateTimeToInstant(hoy, hora, timezone);
  if (deHoy === null) return null;
  if (Date.parse(deHoy) <= ahora.getTime() + 5 * 60 * 1000) return deHoy;
  return localDateTimeToInstant(addDaysToKey(hoy, -1), hora, timezone);
}
