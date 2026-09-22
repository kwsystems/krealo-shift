/**
 * Las politicas de una ubicacion, en UN solo sitio.
 *
 * POR QUE SALE DE `kiosk-api.ts`. `pinLength` la usan dos lados que no se hablan: el
 * reloj, para saber cuantos digitos pedir en el teclado, y `setEmployeePin`, para saber
 * de cuantos digitos generar el PIN. Estaban separados, y el teclado envia EXACTAMENTE
 * al llegar a su longitud —no hay boton de aceptar—, asi que un PIN de 4 digitos en una
 * sede configurada a 6 no se puede teclear: la persona marca sus cuatro digitos y no
 * pasa absolutamente nada. Ni error, ni aviso, ni forma de enterarse.
 *
 * Con una sola fuente, el generador y el teclado no pueden discrepar.
 */

export const POLITICAS_POR_DEFECTO = {
  pinLength: 6,
  photoEnabled: false,
  earlyClockInMinutes: 10,
  lateGraceMinutes: 5,
  allowUnscheduledShifts: true,
  timeFormat: '24h' as const,
  requiredBreakMinutes: 0,
};

export function politicasDe(location: Record<string, unknown>) {
  const settings = (location.settings ?? {}) as Record<string, unknown>;
  return {
    pinLength: Number(settings.pinLength ?? POLITICAS_POR_DEFECTO.pinLength),
    photoEnabled: Boolean(settings.photoEnabled ?? POLITICAS_POR_DEFECTO.photoEnabled),
    earlyClockInMinutes: Number(
      settings.earlyClockInMinutes ?? POLITICAS_POR_DEFECTO.earlyClockInMinutes,
    ),
    lateGraceMinutes: Number(settings.lateGraceMinutes ?? POLITICAS_POR_DEFECTO.lateGraceMinutes),
    allowUnscheduledShifts: Boolean(
      settings.allowUnscheduledShifts ?? POLITICAS_POR_DEFECTO.allowUnscheduledShifts,
    ),
    timeFormat: (settings.timeFormat ?? POLITICAS_POR_DEFECTO.timeFormat) as '12h' | '24h',
    requiredBreakMinutes: Number(
      settings.requiredBreakMinutes ?? POLITICAS_POR_DEFECTO.requiredBreakMinutes,
    ),
  };
}
