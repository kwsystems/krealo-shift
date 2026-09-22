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
  earlyDepartureReasonMinutes: 30,
};

/**
 * Los motivos de pausa que el reloj sabe pintar.
 *
 * Esta lista esta DUPLICADA a proposito de `src/domain/break-reason.ts`: las funciones
 * son otro paquete y no importan del cliente. Lo unico que hace con ella es filtrar
 * claves inventadas antes de mandarlas; si el cliente añade un motivo y aqui no se
 * añade, ese motivo usara el valor de fabrica en vez del configurado, que es el fallo
 * seguro y no uno que rompa el reloj.
 */
const MOTIVOS_DE_PAUSA = [
  'meal',
  'rest',
  'permit',
  'meeting',
  'training',
  'errand',
  'other',
] as const;

/**
 * Que motivos de pausa cuentan como trabajado en esta sede.
 *
 * ESTE CAMPO ESTABA MUERTO. El reloj lo declaraba en `KioskPolicies`, lo leia al
 * pausar y traia valores de fabrica, pero NADIE lo llenaba nunca: el servidor no lo
 * mandaba y el esquema del cliente ni siquiera lo parseaba. O sea que una sede que
 * configurara «aqui la comida se paga» seguia viendo «no cuenta como trabajado» en el
 * reloj, para siempre, sin ningun error. Es el quinto caso del mismo patron y salio al
 * tender este mismo cable para el umbral de salida anticipada.
 *
 * Devuelve solo lo que la sede haya cambiado. Vacio significa «manda lo de fabrica», y
 * de eso ya se encarga `breakTypeForReason` en el cliente.
 */
function motivosPagadosDe(settings: Record<string, unknown>): Record<string, boolean> {
  const crudo = settings.paidBreakReasons;
  if (crudo === null || typeof crudo !== 'object') return {};

  const entrada = crudo as Record<string, unknown>;
  const salida: Record<string, boolean> = {};
  for (const motivo of MOTIVOS_DE_PAUSA) {
    const valor = entrada[motivo];
    if (typeof valor === 'boolean') salida[motivo] = valor;
  }
  return salida;
}

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
    earlyDepartureReasonMinutes: Number(
      settings.earlyDepartureReasonMinutes ?? POLITICAS_POR_DEFECTO.earlyDepartureReasonMinutes,
    ),
    paidBreakReasons: motivosPagadosDe(settings),
  };
}
