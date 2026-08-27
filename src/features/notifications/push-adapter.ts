import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

/**
 * Adaptador de notificaciones por plataforma (§19, §29).
 *
 * MISMO PATRÓN QUE `src/lib/security/secure-storage.ts`, y por la misma razón: en
 * web la capacidad nativa no existe. `expo-notifications` sí se puede importar en
 * web —el paquete trae implementaciones de navegador— pero `getExpoPushTokenAsync`
 * necesita claves VAPID configuradas en el proyecto, así que en la
 * previsualización con `expo start --web` la llamada fallaría siempre.
 *
 * En vez de dejar que reviente, el adaptador web devuelve 'unsupported' y no
 * llama a nada. La previsualización sigue usable y el panel muestra un aviso
 * honesto en lugar de un botón que no puede funcionar.
 *
 * Todo lo que toca el módulo nativo pasa por aquí. Ningún componente importa
 * `expo-notifications` directamente: así el único sitio donde hay que mirar
 * cuando algo se comporta distinto en web es este archivo.
 */

export type PushPermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export type PushPlatform = 'ios' | 'android' | 'web';

const isWeb = Platform.OS === 'web';

export function pushPlatform(): PushPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * Etiqueta del dispositivo, para que la persona reconozca cuál es cuál si tiene
 * varios. Es un nombre que ella misma puso; solo lo lee ella, porque la política
 * RLS de `push_tokens` limita cada fila a su dueño.
 */
export function deviceLabel(): string {
  const name = Device.deviceName;
  if (typeof name === 'string' && name.trim() !== '') return name.trim().slice(0, 80);
  const model = Device.modelName;
  if (typeof model === 'string' && model.trim() !== '') return model.trim().slice(0, 80);
  return Platform.OS;
}

function toState(status: Notifications.NotificationPermissionsStatus): PushPermissionState {
  if (status.granted) return 'granted';
  // iOS "provisional": se pueden entregar avisos silenciosos. Cuenta como
  // concedido, porque el token sirve.
  if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (status.canAskAgain) return 'undetermined';
  return 'denied';
}

export const pushAdapter = {
  /** `false` en web: no hay nada que registrar allí. */
  supported: !isWeb,

  async getPermission(): Promise<PushPermissionState> {
    if (isWeb) return 'unsupported';
    try {
      return toState(await Notifications.getPermissionsAsync());
    } catch {
      // Un simulador sin capacidad de push, o el módulo no disponible. No es un
      // error que el usuario pueda arreglar.
      return 'unsupported';
    }
  },

  /**
   * Pide el permiso. Se llama SOLO después de que la persona haya leído la
   * explicación y haya pulsado el botón (§25): en iOS el diálogo del sistema se
   * puede mostrar una sola vez, así que gastarlo sin contexto deja la app sin
   * notificaciones para siempre y sin forma de recuperarlo desde dentro.
   */
  async requestPermission(): Promise<PushPermissionState> {
    if (isWeb) return 'unsupported';
    try {
      return toState(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        }),
      );
    } catch {
      return 'unsupported';
    }
  },

  /** Token de Expo, o `null` si no se pudo obtener. */
  async getExpoToken(projectId: string): Promise<string | null> {
    if (isWeb) return null;
    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      return typeof token.data === 'string' && token.data !== '' ? token.data : null;
    } catch {
      // Sin red, o sin credenciales de push en el proyecto de EAS. Se reintenta
      // en el siguiente arranque; no hay nada que explicar al usuario aquí.
      return null;
    }
  },

  /**
   * Suscribe el toque en una notificación. Devuelve el limpiador.
   *
   * El `data` llega sin validar: lo escribió el sistema operativo cuando entregó
   * la notificación, y puede venir de una versión anterior de la app.
   */
  addResponseListener(handler: (data: unknown) => void): () => void {
    if (isWeb) return () => undefined;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handler(response.notification.request.content.data);
    });
    return () => subscription.remove();
  },

  /**
   * Toque que abrió la app desde cerrada, si lo hubo. Se consume: se lee y se
   * limpia, para no volver a navegar en cada montaje.
   */
  takeInitialResponse(): unknown | null {
    if (isWeb) return null;
    try {
      const response = Notifications.getLastNotificationResponse();
      if (response === null) return null;
      Notifications.clearLastNotificationResponse();
      return response.notification.request.content.data;
    } catch {
      return null;
    }
  },

  /**
   * Comportamiento con la app abierta: se muestra el aviso igual.
   *
   * Sin esto, `expo-notifications` descarta la notificación cuando la app está en
   * primer plano, y el gerente que tiene el panel abierto no se entera de nada
   * hasta que sale de la app.
   */
  configureForeground(): void {
    if (isWeb) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        // La insignia se dejaría desincronizada: no hay nada que la baje cuando
        // el gerente resuelve la tardanza desde la app.
        shouldSetBadge: false,
      }),
    });
  },
};
