/**
 * El límite de intentos del PIN sin conexión SOBREVIVE a cerrar la app.
 *
 * ESTA PRUEBA EXISTE POR UN AGUJERO. El contador y el bloqueo vivían en dos
 * variables del módulo, y el comentario lo justificaba diciendo que "se reinicia si
 * alguien reinicia el iPad, que es aceptable porque reiniciar un iPad de pedestal es
 * visible y lento".
 *
 * El razonamiento estaba mal: no hace falta reiniciar el iPad, basta CERRAR LA APP
 * —dos segundos, y no se nota—. Y el límite existe justamente para que quedarse sin
 * red no sea la forma de saltarse el bloqueo del PIN: modo avión más cerrar la app
 * cada cuatro intentos dejaba probar PIN indefinidamente, con PIN de cuatro dígitos
 * permitidos, o sea 10.000 combinaciones.
 *
 * "Cerrar la app" se simula recargando el módulo con `jest.resetModules()`: eso tira
 * el estado en memoria y conserva el de la base, que es exactamente la diferencia
 * que se está comprobando.
 */

const mockAlmacen = new Map<string, string>();

jest.mock('../database', () => ({
  SYNC_KEYS: jest.requireActual<typeof import('../database')>('../database').SYNC_KEYS,
  getSyncMetadata: (key: string) => Promise.resolve(mockAlmacen.get(key) ?? null),
  setSyncMetadata: (key: string, value: string) => {
    mockAlmacen.set(key, value);
    return Promise.resolve();
  },
  // Sin verificadores: alcanza para contar intentos fallidos, que es lo que se mide.
  // Un PIN correcto necesitaría el binario de bcrypt contra un salt real, y eso ya
  // está cubierto en `pin-derivation.test.ts`.
  openOfflineDatabase: () =>
    Promise.resolve({
      getAllAsync: () =>
        Promise.resolve([
          {
            employee_opaque_id: 'abc',
            pin_salt: '$2b$10$abcdefghijklmnopqrstuu',
            pin_verifier: 'f'.repeat(64),
            pin_version: 1,
          },
        ]),
      getFirstAsync: () => Promise.resolve(null),
    }),
}));

// `expo-crypto` no existe en el entorno de Jest. Se respalda con el crypto de Node,
// que da el MISMO sha256: aqui no se esta probando la derivacion —eso lo hace
// `pin-derivation.test.ts` contra pgcrypto— sino el contador de intentos, y para eso
// hace falta que la derivacion funcione sin reventar.
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: (_algoritmo: string, datos: string) =>
    Promise.resolve(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('node:crypto') as typeof import('node:crypto'))
        .createHash('sha256')
        .update(datos)
        .digest('hex'),
    ),
}));

jest.mock('@/lib/security/secure-storage', () => ({
  secureStorage: { get: () => Promise.resolve('clave-del-dispositivo') },
  SECURE_KEYS: { kioskDeviceKey: 'kiosk.deviceKey' },
}));

/**
 * Recarga el módulo: simula que alguien cerró y volvió a abrir la app.
 *
 * `require` y no `await import()`: el import dinámico necesita
 * --experimental-vm-modules en este preset, y aquí hace falta justamente la
 * recarga sincrónica que `jest.resetModules()` prepara.
 */
function cerrarYAbrirLaApp(): typeof import('../pin') {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../pin') as typeof import('../pin');
}

describe('bloqueo del PIN sin conexión', () => {
  beforeEach(() => {
    mockAlmacen.clear();
    jest.resetModules();
  });

  it('cuenta los intentos fallidos y avisa cuántos quedan', async () => {
    const pin = cerrarYAbrirLaApp();

    const primero = await pin.verifyPinOffline('0000');
    expect(primero).toEqual({ ok: false, reason: 'incorrect', remainingAttempts: 4 });

    const segundo = await pin.verifyPinOffline('1111');
    expect(segundo).toEqual({ ok: false, reason: 'incorrect', remainingAttempts: 3 });
  });

  it('bloquea al quinto intento', async () => {
    const pin = cerrarYAbrirLaApp();

    for (let i = 0; i < 4; i += 1) await pin.verifyPinOffline(String(i).repeat(4));
    const quinto = await pin.verifyPinOffline('9999');

    expect(quinto).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('EL CONTADOR SOBREVIVE A CERRAR LA APP', async () => {
    // El agujero: antes esto devolvía `remainingAttempts: 4` otra vez, y repitiéndolo
    // se podían probar PIN sin límite.
    const antes = cerrarYAbrirLaApp();
    await antes.verifyPinOffline('0000');
    await antes.verifyPinOffline('1111');

    const despues = cerrarYAbrirLaApp();
    const tercero = await despues.verifyPinOffline('2222');

    expect(tercero).toEqual({ ok: false, reason: 'incorrect', remainingAttempts: 2 });
  });

  it('EL BLOQUEO SOBREVIVE A CERRAR LA APP', async () => {
    const antes = cerrarYAbrirLaApp();
    for (let i = 0; i < 5; i += 1) await antes.verifyPinOffline(String(i).repeat(4));

    const despues = cerrarYAbrirLaApp();
    const intento = await despues.verifyPinOffline('9999');

    expect(intento).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('un bloqueo caducado deja volver a intentar', async () => {
    const pin = cerrarYAbrirLaApp();
    for (let i = 0; i < 5; i += 1) await pin.verifyPinOffline(String(i).repeat(4));

    // Se envejece el bloqueo a mano, que es lo que haría el paso del tiempo.
    const { SYNC_KEYS: claves } = jest.requireActual<typeof import('../database')>('../database');
    mockAlmacen.set(claves.offlinePinLockedUntil, new Date(Date.now() - 60_000).toISOString());

    const despues = cerrarYAbrirLaApp();
    const intento = await despues.verifyPinOffline('0000');

    // Y con cinco intentos nuevos, no con los que quedaban antes de bloquear.
    expect(intento).toEqual({ ok: false, reason: 'incorrect', remainingAttempts: 4 });
  });

  it('un valor corrupto en el contador cuenta como cero, no como muchos', async () => {
    // Si contara como muchos, corromper esa fila bloquearía el kiosco entero, que es
    // un problema peor que el que se está evitando.
    const { SYNC_KEYS: claves } = jest.requireActual<typeof import('../database')>('../database');
    mockAlmacen.set(claves.offlinePinFailedAttempts, 'no-es-un-numero');

    const pin = cerrarYAbrirLaApp();
    const intento = await pin.verifyPinOffline('0000');

    expect(intento).toEqual({ ok: false, reason: 'incorrect', remainingAttempts: 4 });
  });

  it('un bloqueo con fecha ilegible no deja el kiosco bloqueado para siempre', async () => {
    const { SYNC_KEYS: claves } = jest.requireActual<typeof import('../database')>('../database');
    mockAlmacen.set(claves.offlinePinLockedUntil, 'fecha-rota');

    const pin = cerrarYAbrirLaApp();
    const intento = await pin.verifyPinOffline('0000');

    expect(intento).toMatchObject({ ok: false, reason: 'incorrect' });
  });
});
