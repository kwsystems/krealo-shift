import { Platform } from 'react-native';
import { Camera } from 'expo-camera';

import { pushAdapter } from '@/features/notifications/push-adapter';

/**
 * Estado de los permisos para el diagnóstico del kiosco (§31).
 *
 * §31 lo pide en la lista de lo que hay que mostrar, y no estaba. Importa
 * exactamente cuando algo va mal en una tienda: "la foto no se guarda" y "no llegan
 * los avisos" tienen casi siempre la misma causa —un permiso denegado— y sin verlo en
 * pantalla nadie puede saberlo sin pedirle a alguien que camine hasta el iPad.
 *
 * NINGUNA DE LAS DOS LECTURAS LANZA. Es una pantalla de diagnóstico: si falla al leer
 * un permiso tiene que decir que no lo sabe, no reventar. Reventar aquí dejaría sin
 * diagnóstico justo cuando se necesita.
 */

export type PermissionLabel = 'granted' | 'denied' | 'undetermined' | 'unsupported' | 'unknown';

export async function readCameraPermission(): Promise<PermissionLabel> {
  // En web `expo-camera` existe pero el permiso solo se resuelve al abrir la cámara,
  // y el kiosco de verdad no corre en web.
  if (Platform.OS === 'web') return 'unsupported';

  try {
    const estado = await Camera.getCameraPermissionsAsync();
    if (estado.granted) return 'granted';
    return estado.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unknown';
  }
}

export async function readNotificationsPermission(): Promise<PermissionLabel> {
  try {
    // `pushAdapter.getPermission` ya devuelve 'unsupported' en vez de lanzar.
    return await pushAdapter.getPermission();
  } catch {
    return 'unknown';
  }
}
