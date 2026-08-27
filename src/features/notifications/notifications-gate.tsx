import { useNotificationRouter, usePushRegistration } from './hooks';

/**
 * Punto único donde las notificaciones se enganchan a la app (§19).
 *
 * No pinta nada. Existe porque hay dos cosas que tienen que ocurrir en cada
 * arranque y en ningún sitio concreto de la interfaz:
 *
 *   1. refrescar el token de este dispositivo si el permiso YA está concedido, sin
 *      preguntar nada. Un token de Expo puede cambiar tras una reinstalación o una
 *      actualización del sistema, y un token viejo significa notificaciones que se
 *      envían y no llegan, sin ningún error visible en ninguna parte;
 *   2. atender el toque en una notificación, incluido el que abre la app estando
 *      cerrada.
 *
 * VA EN EL LAYOUT RAÍZ Y NO EN EL DE `(manager)` aunque solo sirva al panel. El
 * layout de `(manager)` se desmonta al salir de las pestañas, y el toque de una
 * notificación puede llegar cuando la app está en cualquier pantalla, o abriéndose
 * desde cerrada. Las dos guardas que importan —dispositivo que no es kiosco y rol
 * administrativo— están dentro de los hooks, no en dónde se monta el componente:
 * `usePushRegistration` no pide nada si el dispositivo es un kiosco, y
 * `useNotificationRouter` no navega hasta que la sesión y el rol están resueltos.
 *
 * NUNCA pide el permiso. Pedirlo es una acción de la persona en la configuración,
 * con su explicación delante (§25).
 */
export function NotificationsGate() {
  usePushRegistration();
  useNotificationRouter();
  return null;
}
