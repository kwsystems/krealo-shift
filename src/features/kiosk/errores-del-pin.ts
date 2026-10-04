import type { TFunction } from 'i18next';

import type { KioskApiError } from './api';

/** Minutos que faltan hasta un instante, redondeando hacia arriba y nunca menos de 1. */
export function minutosHasta(iso: string, ahora: number = Date.now()): number {
  const objetivo = Date.parse(iso);
  if (Number.isNaN(objetivo)) return 1;
  return Math.max(1, Math.ceil((objetivo - ahora) / 60_000));
}

/**
 * LO QUE DICE EL RELOJ CUANDO UN PIN NO ENTRA, en un solo sitio (auditoría, 4-oct).
 *
 * La pantalla de salir del modo reloj tenía su propia versión y todo lo que no fuera red o
 * credencial lo llamaba «PIN incorrecto»: un PIN bloqueado, un reloj revocado o uno de otra
 * tienda mandaban a probar PIN distintos durante minutos. Ahora la pantalla del PIN y la de
 * salir dicen lo mismo del mismo error.
 *
 * `null` sin red: ahí cada pantalla hace lo suyo —el PIN prueba sin conexión; salir pide
 * conexión—, y eso no es un texto.
 */
export function textoDelErrorDelPin(t: TFunction, error: KioskApiError): string | null {
  switch (error.kind) {
    case 'offline':
      return null;
    case 'invalid_pin':
      return t('kiosk.pinIncorrect');
    case 'locked':
      // No se revela a quién corresponde el PIN bloqueado (§8).
      return t('kiosk.pinLocked', { minutes: minutosHasta(error.lockedUntil) });
    case 'revoked':
      return t('errors.kioskRevoked');
    case 'wrong_location':
      return t('errors.kioskWrongLocation');
    case 'not_configured':
      return t('errors.notConfigured');
    case 'device_credential':
      // No es «PIN incorrecto»: el aparato no pudo leer su credencial.
      return t('errors.deviceCredential');
    default:
      return t('errors.generic');
  }
}
