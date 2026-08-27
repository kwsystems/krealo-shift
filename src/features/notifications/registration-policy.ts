import type { AppRole } from '@/stores/session-store';
import { canUseAdminPanel } from '@/stores/session-store';

/**
 * ¿Tiene sentido registrar un token de notificaciones en ESTE dispositivo?
 *
 * Función pura y separada del hook a propósito: es la regla que decide si un
 * iPad de tienda queda registrado para recibir avisos del gerente, y esa regla
 * hay que poder probarla sin montar la app.
 *
 * LAS CUATRO RAZONES POR LAS QUE SE DICE NO, EN ORDEN
 *
 *   1. `kiosk` — el dispositivo está vinculado como reloj de tienda. Es el caso
 *      importante y va primero: un iPad en modo kiosco vive sobre el mostrador,
 *      a la vista de clientes y de todo el personal. Una notificación de "2
 *      personas no han fichado" en esa pantalla es información laboral en un
 *      escaparate. Y §19 lo dice sin rodeos: el empleado en kiosco no recibe
 *      push en P0/P1.
 *
 *   2. `web` — la previsualización web existe para trabajar desde Windows (§29),
 *      no es una superficie de producción. `expo-notifications` no obtiene un
 *      token de Expo en web sin claves VAPID configuradas, así que registrar
 *      allí solo produciría un error.
 *
 *   3. `noSession` / `noRole` — sin sesión no hay a quién asociar el token, y sin
 *      rol administrativo no hay nada que notificar: en P0/P1 el empleado no
 *      tiene cuenta personal.
 *
 *   4. `noProjectId` — `getExpoPushTokenAsync` necesita el `projectId` de EAS.
 *      Sin él la llamada falla con un error que no dice nada útil; es mejor
 *      decirlo antes y explicar que falta configurar el proyecto.
 */

export type PushRegistrationBlock =
  | 'kiosk'
  | 'web'
  | 'noSession'
  | 'noRole'
  | 'noProjectId'
  | 'resolving';

export type PushRegistrationDecision =
  | { allowed: true }
  | { allowed: false; reason: PushRegistrationBlock };

export function pushRegistrationDecision(input: {
  platform: string;
  /** `false` mientras el estado de kiosco todavía se está leyendo del almacén seguro. */
  kioskHydrated: boolean;
  /** `true` si este dispositivo está vinculado como reloj de tienda. */
  isKioskDevice: boolean;
  sessionPhase: 'unknown' | 'signedOut' | 'signedIn';
  role: AppRole | null;
  hasProjectId: boolean;
}): PushRegistrationDecision {
  if (input.platform === 'web') return { allowed: false, reason: 'web' };

  // Antes de saber si es kiosco no se decide nada: preguntar el permiso de
  // notificaciones en el iPad de una tienda y luego arrepentirse no se deshace.
  if (!input.kioskHydrated || input.sessionPhase === 'unknown') {
    return { allowed: false, reason: 'resolving' };
  }

  if (input.isKioskDevice) return { allowed: false, reason: 'kiosk' };
  if (input.sessionPhase !== 'signedIn') return { allowed: false, reason: 'noSession' };
  if (!canUseAdminPanel(input.role)) return { allowed: false, reason: 'noRole' };
  if (!input.hasProjectId) return { allowed: false, reason: 'noProjectId' };

  return { allowed: true };
}
