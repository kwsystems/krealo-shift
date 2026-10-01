import { MINUTOS_FUERA_DEL_TURNO_POR_DEFECTO } from '../../../src/domain/fuera-del-turno';

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
  /**
   * Desde cuántos minutos fuera del turno —entrar antes o salir después— se avisa en
   * Horario (1-oct). Ver `src/domain/fuera-del-turno.ts`.
   */
  unusualClockMinutes: MINUTOS_FUERA_DEL_TURNO_POR_DEFECTO,
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

/**
 * Un numero guardado, o el de fabrica. NUNCA `NaN`.
 *
 * `Number('seis')` es `NaN`, y un `NaN` aqui no se queda aqui: viaja dentro de
 * `policies`, el esquema del reloj lo rechaza —un numero tiene que ser un numero— y con
 * el se cae la respuesta ENTERA de activar o de arrancar. O sea que un solo valor mal
 * guardado en los ajustes de una sede —y la primera organizacion de esta app se escribio
 * a mano en la consola de Firestore— deja el reloj de esa tienda sin poder activarse, con
 * un mensaje que no menciona ningun ajuste.
 *
 * El servidor es el sitio para atajarlo: es el que sabe cual es el valor de fabrica y el
 * unico por el que pasan las dos respuestas.
 */
function numeroDeAjuste(valor: unknown, porDefecto: number): number {
  if (valor === null || valor === undefined || valor === '') return porDefecto;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : porDefecto;
}

/** Igual que el numero: un `timeFormat` inventado no puede tumbar la respuesta. */
function formatoDeHora(valor: unknown): '12h' | '24h' {
  return valor === '12h' || valor === '24h' ? valor : POLITICAS_POR_DEFECTO.timeFormat;
}

export function politicasDe(location: Record<string, unknown>) {
  const settings = (location.settings ?? {}) as Record<string, unknown>;
  return {
    pinLength: numeroDeAjuste(settings.pinLength, POLITICAS_POR_DEFECTO.pinLength),
    photoEnabled: Boolean(settings.photoEnabled ?? POLITICAS_POR_DEFECTO.photoEnabled),
    earlyClockInMinutes: numeroDeAjuste(
      settings.earlyClockInMinutes,
      POLITICAS_POR_DEFECTO.earlyClockInMinutes,
    ),
    lateGraceMinutes: numeroDeAjuste(
      settings.lateGraceMinutes,
      POLITICAS_POR_DEFECTO.lateGraceMinutes,
    ),
    allowUnscheduledShifts: Boolean(
      settings.allowUnscheduledShifts ?? POLITICAS_POR_DEFECTO.allowUnscheduledShifts,
    ),
    timeFormat: formatoDeHora(settings.timeFormat),
    requiredBreakMinutes: numeroDeAjuste(
      settings.requiredBreakMinutes,
      POLITICAS_POR_DEFECTO.requiredBreakMinutes,
    ),
    earlyDepartureReasonMinutes: numeroDeAjuste(
      settings.earlyDepartureReasonMinutes,
      POLITICAS_POR_DEFECTO.earlyDepartureReasonMinutes,
    ),
    unusualClockMinutes: numeroDeAjuste(
      settings.unusualClockMinutes,
      POLITICAS_POR_DEFECTO.unusualClockMinutes,
    ),
    paidBreakReasons: motivosPagadosDe(settings),
  };
}
