import type { TFunction } from 'i18next';

import { minutosHasta, textoDelErrorDelPin } from '../errores-del-pin';

/**
 * Lo que dice el reloj cuando un PIN no entra, el mismo en la pantalla del PIN y en la de
 * salir (auditoría, 4-oct). Antes salir decía «PIN incorrecto» de un PIN bloqueado o de un
 * reloj revocado.
 */
const t = ((clave: string, opciones?: Record<string, unknown>) =>
  opciones === undefined ? clave : `${clave}:${JSON.stringify(opciones)}`) as unknown as TFunction;

describe('el texto de cada error del PIN', () => {
  it.each([
    [{ kind: 'invalid_pin', remainingAttempts: 2 } as const, 'kiosk.pinIncorrect'],
    [{ kind: 'revoked' } as const, 'errors.kioskRevoked'],
    [{ kind: 'wrong_location' } as const, 'errors.kioskWrongLocation'],
    [{ kind: 'not_configured' } as const, 'errors.notConfigured'],
    [{ kind: 'device_credential' } as const, 'errors.deviceCredential'],
    [{ kind: 'server', message: 'x' } as const, 'errors.generic'],
  ])('%j → %s', (error, clave) => {
    expect(textoDelErrorDelPin(t, error)).toBe(clave);
  });

  it('un PIN bloqueado dice cuántos minutos, no «PIN incorrecto»', () => {
    const dentroDe = new Date(Date.now() + 4.5 * 60_000).toISOString();
    expect(textoDelErrorDelPin(t, { kind: 'locked', lockedUntil: dentroDe })).toBe(
      'kiosk.pinLocked:{"minutes":5}',
    );
  });

  it('sin red no hay texto: cada pantalla decide', () => {
    expect(textoDelErrorDelPin(t, { kind: 'offline' })).toBeNull();
  });

  it('los minutos nunca bajan de 1', () => {
    expect(minutosHasta('2020-01-01T00:00:00.000Z')).toBe(1);
    expect(minutosHasta('no es fecha')).toBe(1);
  });
});
