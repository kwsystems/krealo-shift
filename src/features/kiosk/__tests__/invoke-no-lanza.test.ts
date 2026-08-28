/**
 * `invoke` nunca lanza, ni cuando falla el Keychain (§16, §20).
 *
 * ESTA PRUEBA EXISTE POR EL PEOR FALLO DE LA SESIÓN. Las dos lecturas del Keychain
 * estaban FUERA del try de `invoke`, y `secureStorage.get` es
 * `SecureStore.getItemAsync` sin catch: puede rechazar si el Keychain no está
 * disponible antes del primer desbloqueo, si el item está corrupto, o si el grupo
 * de acceso todavía no está listo.
 *
 * Cuando rechazaba, `invoke` LANZABA en vez de devolver un resultado. Y quien llama
 * no lo espera:
 *
 *     const result = await verifyPin(...);   // <- lanzaba aquí
 *     setChecking(false);                    // <- nunca se ejecutaba
 *
 * O sea que el teclado del PIN se quedaba en "comprobando" para siempre y el
 * empleado no podía fichar, sin ningún mensaje.
 *
 * Se comprueban las dos mitades: que no lanza, y que el error que devuelve NO es
 * `offline`. Eso segundo importa igual: "sin conexión" manda a alguien a revisar el
 * wifi de la tienda durante una hora, y esto se arregla reiniciando el iPad.
 */

import { verifyPin } from '../api';

const mockGet = jest.fn();
const mockGetJson = jest.fn();
const mockInvoke = jest.fn();

jest.mock('@/lib/security/secure-storage', () => ({
  secureStorage: {
    get: (...args: unknown[]) => mockGet(...args),
    getJson: (...args: unknown[]) => mockGetJson(...args),
    set: jest.fn(),
    setJson: jest.fn(),
    remove: jest.fn(),
  },
  SECURE_KEYS: (jest.requireActual('@/lib/security/secure-storage') as { SECURE_KEYS: unknown })
    .SECURE_KEYS,
}));

jest.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } }),
}));

describe('invoke con el Keychain roto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetJson.mockResolvedValue({ devicePublicId: 'dev-1' });
  });

  it('NO lanza cuando la lectura de la credencial falla', async () => {
    mockGet.mockRejectedValue(new Error('Could not access keychain'));

    // `resolves` y no `rejects`: el contrato es que esta función no lanza nunca.
    await expect(verifyPin({ pin: '123456', locationId: 'loc-1' })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('devuelve device_credential y NO offline', async () => {
    // Los dos casos necesitan consejos opuestos. Antes el catch de `invoke` trataba
    // cualquier excepción como falta de red, así que este fallo habría dicho "sin
    // conexión" y el kiosco habría intentado validar el PIN contra el verificador
    // local, que se comprueba con la clave del Keychain: la misma que no se pudo
    // leer. El resultado habría sido "PIN incorrecto", que es una mentira redonda.
    mockGet.mockRejectedValue(new Error('Could not access keychain'));

    const result = await verifyPin({ pin: '123456', locationId: 'loc-1' });

    expect(result).toEqual({ ok: false, error: { kind: 'device_credential' } });
  });

  it('NO llama al servidor si no pudo leer la credencial', async () => {
    // Llamar sin la cabecera daría un rechazo del servidor indistinguible de un
    // dispositivo revocado, y el kiosco mostraría la pantalla de "reloj desactivado"
    // por un problema de Keychain.
    mockGet.mockRejectedValue(new Error('Could not access keychain'));

    await verifyPin({ pin: '123456', locationId: 'loc-1' });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('tampoco lanza si falla la lectura del binding', async () => {
    mockGet.mockResolvedValue('secreto');
    mockGetJson.mockRejectedValue(new Error('keychain busy'));

    await expect(verifyPin({ pin: '123456', locationId: 'loc-1' })).resolves.toEqual({
      ok: false,
      error: { kind: 'device_credential' },
    });
  });

  it('un fallo de red sigue siendo offline, que es lo que activa el camino sin conexión', async () => {
    // La otra mitad: no se puede arreglar lo anterior a costa de dejar de distinguir
    // la falta de red, que es la condición NORMAL en una tienda.
    mockGet.mockResolvedValue('secreto');
    mockInvoke.mockRejectedValue(new Error('Network request failed'));

    await expect(verifyPin({ pin: '123456', locationId: 'loc-1' })).resolves.toEqual({
      ok: false,
      error: { kind: 'offline' },
    });
  });
});
