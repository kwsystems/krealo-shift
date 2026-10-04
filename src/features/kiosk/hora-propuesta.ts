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
  /**
   * La entrada de la jornada que sigue abierta, si lo olvidado es su salida o su pausa.
   *
   * LA HORA ES DE ESA JORNADA (auditoría, 4-oct). Con la del sábado abierta, el lunes el
   * reloj decía «Tu jornada de sáb 3 oct sigue abierta», la persona escribía 19:00 y se
   * guardaba el DOMINGO a las 19:00: una jornada de 34 h si se aprobaba. Ahora es la
   * primera vez que es esa hora después de la entrada, con la misma regla que el servidor
   * (`deLaJornada` en `functions/src/kiosk-api.ts`). `null` si todavía no llegó.
   */
  desde: string | null = null,
): string | null {
  const hora = horaTecleada(tecleada);
  if (hora === null) return null;
  if (desde !== null) {
    const desdeMs = Date.parse(desde);
    let dia = dateKeyOf(desde, timezone);
    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
      const candidato = localDateTimeToInstant(dia, hora, timezone);
      if (candidato !== null && Date.parse(candidato) > desdeMs) {
        return Date.parse(candidato) <= ahora.getTime() + 5 * 60 * 1000 ? candidato : null;
      }
      dia = addDaysToKey(dia, 1);
    }
    return null;
  }
  const hoy = dateKeyOf(ahora, timezone);
  const deHoy = localDateTimeToInstant(hoy, hora, timezone);
  if (deHoy === null) return null;
  if (Date.parse(deHoy) <= ahora.getTime() + 5 * 60 * 1000) return deHoy;
  return localDateTimeToInstant(addDaysToKey(hoy, -1), hora, timezone);
}

/** «14:30», «8.30» o «0830» como «HH:MM»; `null` si no es una hora. */
export function horaTecleada(tecleada: string): string | null {
  const limpia = tecleada.trim().replace(/[.h]/, ':');
  const minutos = localTimeToMinutes(
    /^\d{3,4}$/.test(limpia) ? `${limpia.slice(0, -2)}:${limpia.slice(-2)}` : limpia,
  );
  if (minutos === null || minutos >= 24 * 60) return null;
  return minutesToLocalTime(minutos);
}
