import { keepScreenAwake, releaseScreenAwake } from '../screen-awake';

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const keepAwake = require('expo-keep-awake') as {
  activateKeepAwakeAsync: jest.Mock;
  deactivateKeepAwake: jest.Mock;
};

/**
 * Pantalla siempre encendida en el kiosco (§4).
 *
 * Lo que fija esto es el fallo concreto que tuvo: el permiso se pedía con
 * `void activateKeepAwakeAsync()`, así que un rechazo era una excepción sin
 * capturar. En el navegador, donde Wake Lock está negado por defecto, eso tumbaba
 * el render de las cinco rutas del kiosco.
 */
describe('keepScreenAwake', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('devuelve true cuando el sistema concede el bloqueo', async () => {
    keepAwake.activateKeepAwakeAsync.mockResolvedValue(undefined);
    await expect(keepScreenAwake()).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('NO propaga cuando el sistema lo niega, y devuelve false', async () => {
    // Este es el caso que reventaba. `resolves` y no `rejects`: el contrato es
    // que esta función no lanza nunca.
    keepAwake.activateKeepAwakeAsync.mockRejectedValue(
      new Error('NotAllowedError: Wake Lock permission request denied'),
    );
    await expect(keepScreenAwake()).resolves.toBe(false);
  });

  it('avisa por consola con el motivo, para que se pueda diagnosticar', async () => {
    keepAwake.activateKeepAwakeAsync.mockRejectedValue(new Error('sin permiso'));
    await keepScreenAwake();
    expect(warn).toHaveBeenCalledTimes(1);
    const mensaje = String(warn.mock.calls[0]?.[0]);
    // El motivo y la instrucción concreta: sin ellos el aviso no sirve de nada.
    expect(mensaje).toContain('sin permiso');
    expect(mensaje).toContain('Bloqueo');
  });
});

describe('releaseScreenAwake', () => {
  beforeEach(() => jest.clearAllMocks());

  it('libera el bloqueo', () => {
    keepAwake.deactivateKeepAwake.mockReturnValue(undefined);
    releaseScreenAwake();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });

  it('no lanza si el sistema falla al liberar', () => {
    // Corre al desmontar: salir del modo kiosco no puede fallar por esto.
    keepAwake.deactivateKeepAwake.mockImplementation(() => {
      throw new Error('no habia bloqueo');
    });
    expect(() => releaseScreenAwake()).not.toThrow();
  });
});
