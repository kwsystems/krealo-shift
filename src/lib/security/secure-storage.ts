import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Almacenamiento seguro del dispositivo (§22).
 *
 * Los datos sensibles —credencial del kiosco, verificadores de PIN ligados al
 * dispositivo, tokens de sesión— viven en SecureStore, nunca en AsyncStorage.
 *
 * En web, SecureStore no existe. La previsualización con `expo start --web` es una
 * herramienta de desarrollo para trabajar desde Windows (§29), así que usamos un
 * adaptador de respaldo sobre `localStorage` que:
 *   - deja constancia en consola de que NO es almacenamiento seguro;
 *   - se niega a funcionar en un build de producción web, para que nadie despliegue
 *     por accidente una web tratando `localStorage` como si fuera SecureStore.
 */

const WEB_PREFIX = 'krealo-shift.dev.';

let warnedAboutWeb = false;

function assertWebFallbackAllowed(): void {
  if (process.env.NODE_ENV === 'production' && process.env.EXPO_PUBLIC_APP_ENV === 'production') {
    throw new Error(
      'SecureStore no está disponible en web. La previsualización web es solo para desarrollo.',
    );
  }
  if (!warnedAboutWeb) {
    warnedAboutWeb = true;
    console.warn(
      '[krealo-shift] Web usa localStorage como respaldo de SecureStore. Solo para desarrollo: no es almacenamiento seguro.',
    );
  }
}

const webStorage = {
  async getItem(key: string): Promise<string | null> {
    assertWebFallbackAllowed();
    try {
      return globalThis.localStorage?.getItem(WEB_PREFIX + key) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    assertWebFallbackAllowed();
    try {
      globalThis.localStorage?.setItem(WEB_PREFIX + key, value);
    } catch {
      // Ventana privada o almacenamiento bloqueado: la app debe seguir usable.
    }
  },
  async removeItem(key: string): Promise<void> {
    assertWebFallbackAllowed();
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
