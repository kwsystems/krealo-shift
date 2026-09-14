import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { CLAVES_DE_KIOSCO, kioskModeAvailable } from '@/lib/kiosk/disponibilidad';

/**
 * Almacenamiento seguro del dispositivo (§22).
 *
 * Los datos sensibles —credencial del kiosco, verificadores de PIN ligados al
 * dispositivo, tokens de sesión— viven en SecureStore, nunca en AsyncStorage.
 *
 * En web, SecureStore no existe, así que hay un adaptador de respaldo sobre
 * `localStorage` que deja constancia en consola de que NO es almacenamiento seguro.
 *
 * El respaldo NO es igual para todo, y el porqué está en `webFallbackPermitido`: la
 * sesión y las preferencias sí pasan por él, las tres claves del kiosco no.
 */

const WEB_PREFIX = 'krealo-shift.dev.';

let warnedAboutWeb = false;

/**
 * Qué se permite guardar en el respaldo de `localStorage`, y qué no.
 *
 * ANTES ESTO LANZABA PARA TODO en un build web de producción, y tiraba la app entera
 * al publicarla: el panel de administración no llegaba ni a pintar. La intención era
 * buena —que nadie despliegue una web tratando `localStorage` como si fuera el
 * Keychain— pero el corte estaba en el sitio equivocado.
 *
 * Ahora el corte va por CLAVE, que es donde de verdad está la diferencia:
 *   - la sesión y las preferencias son del panel, y en web viven en `localStorage`
 *     igual que en cualquier aplicación web: quien protege los datos es RLS;
 *   - las tres claves del kiosco —credencial del dispositivo y clave de validación de
 *     PIN sin conexión— NO, porque ahí `localStorage` sí regala secretos.
 *
 * Y no lanza al LEER, solo al escribir. Leer la credencial del kiosco ocurre en el
 * arranque, antes de que nadie haya pedido nada: devolver `null` ahí significa «este
 * dispositivo no es un reloj», que es exactamente la verdad, y deja que la pantalla
 * del kiosco lo explique. Lanzar en el arranque es lo que rompía la app.
 */
function webFallbackPermitido(key: string): boolean {
  if (kioskModeAvailable) return true;
  return !CLAVES_DE_KIOSCO.includes(key);
}

function avisarUnaVez(): void {
  if (warnedAboutWeb) return;
  warnedAboutWeb = true;
  console.warn(
    '[krealo-shift] Web usa localStorage como respaldo de SecureStore. No es almacenamiento seguro: ' +
      'las claves del kiosco no se guardan aquí.',
  );
}

const webStorage = {
  async getItem(key: string): Promise<string | null> {
    avisarUnaVez();
    if (!webFallbackPermitido(key)) return null;
    try {
      return globalThis.localStorage?.getItem(WEB_PREFIX + key) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    avisarUnaVez();
    if (!webFallbackPermitido(key)) {
      throw new Error(
        'Un navegador no puede guardar la credencial de un reloj de fichaje: localStorage no es ' +
          'almacenamiento seguro. El modo kiosco necesita la app instalada en el dispositivo.',
      );
    }
    try {
      globalThis.localStorage?.setItem(WEB_PREFIX + key, value);
    } catch {
      // Ventana privada o almacenamiento bloqueado: la app debe seguir usable.
    }
  },
  async removeItem(key: string): Promise<void> {
    avisarUnaVez();
    // Borrar siempre se permite, incluso lo que no se puede escribir: si quedó algo
    // de una versión anterior, poder limpiarlo es justo lo que uno quiere.
    try {
      globalThis.localStorage?.removeItem(WEB_PREFIX + key);
    } catch {
      // Igual que arriba: no romper por no poder limpiar.
    }
  },
};

const nativeStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const storage = Platform.OS === 'web' ? webStorage : nativeStorage;

export const secureStorage = {
  get: (key: string) => storage.getItem(key),
  set: (key: string, value: string) => storage.setItem(key, value),
  remove: (key: string) => storage.removeItem(key),

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await storage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Un valor corrupto se descarta en silencio: es caché, no la fuente de verdad.
      await storage.removeItem(key);
      return null;
    }
  },

  async setJson(key: string, value: unknown): Promise<void> {
    await storage.setItem(key, JSON.stringify(value));
  },
};

/** Claves usadas en almacenamiento seguro. Centralizadas para no duplicar strings. */
export const SECURE_KEYS = {
  kioskCredential: 'kiosk.credential',
  kioskDeviceKey: 'kiosk.deviceKey',
  kioskInstallationId: 'kiosk.installationId',
  authSession: 'auth.session',
  preferences: 'app.preferences',
} as const;
