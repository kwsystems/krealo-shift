import { cleanup } from '@testing-library/react-native';

/**
 * Setup global de Jest.
 *
 * Los módulos nativos se simulan aquí para que la lógica de dominio y los
 * componentes se puedan probar sin dispositivo. Las funciones exclusivamente
 * nativas (cámara, notificaciones, SecureStore) deben verificarse de verdad en
 * iPhone/iPad — estos mocks solo evitan que el entorno de pruebas se rompa (§29).
 */

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'es-PE', languageCode: 'es', regionCode: 'PE' }],
  getCalendars: () => [{ timeZone: 'America/Lima' }],
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  digestStringAsync: jest.fn(async (_alg: string, data: string) => `digest:${data}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: (n: number) => new Uint8Array(n).fill(7),
}));

/**
 * Limpieza entre pruebas de componentes.
 *
 * React Native Testing Library 14 no registra su propio `afterEach` con el preset
 * de jest-expo: sin esto, el segundo render de un archivo encuentra el arbol
 * anterior todavia montado. Se manifiesta como "no se encuentra el testID" solo a
 * partir de la segunda prueba del archivo, que apunta al sitio equivocado.
 *
 * `cleanup` tambien es asincrono en la version 14, igual que `render` y
 * `fireEvent`: sin el await el desmontaje no termina antes de la prueba siguiente.
 */
afterEach(async () => {
  await cleanup();
});
