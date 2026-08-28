import { BACKOFF, backoffDelayMs, nextAttemptAt, resolutionFor, shouldRetry } from '../backoff';

/**
 * Pruebas de la política de reintentos (§17).
 *
 * Lo que importa aquí no es la fórmula: es que un fichaje nunca se pierda y que
 * veinte iPad que recuperan la red a la vez no golpeen el servidor en el mismo
 * instante.
 */

describe('backoffDelayMs', () => {
  // `random` fijo hace la prueba determinista sin renunciar a probar el jitter.
  const mid = () => 0.5;

  it('no espera nada antes del primer envío', () => {
    expect(backoffDelayMs(0, mid)).toBe(0);
  });

  it('crece exponencialmente entre intentos', () => {
    const first = backoffDelayMs(1, mid);
    const second = backoffDelayMs(2, mid);
    const third = backoffDelayMs(3, mid);

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(second / first).toBeCloseTo(2, 1);
  });

  it('aplica jitter: dos dispositivos no reintentan en el mismo instante', () => {
    // Este es el motivo de existir del jitter. Sin él, ambos devolverían lo mismo.
    const deviceA = backoffDelayMs(4, () => 0.1);
    const deviceB = backoffDelayMs(4, () => 0.9);
    expect(deviceA).not.toBe(deviceB);
  });

  it('el jitter nunca baja de la mitad del intervalo ni sube del total', () => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const exponential = Math.min(BACKOFF.baseMs * 2 ** (attempt - 1), BACKOFF.maxMs);
      const low = backoffDelayMs(attempt, () => 0);
      const high = backoffDelayMs(attempt, () => 0.999999);

      expect(low).toBeGreaterThanOrEqual(Math.floor(exponential / 2));
      expect(high).toBeLessThanOrEqual(exponential);
    }
  });

  it('tiene un techo: no espera horas entre intentos', () => {
    expect(backoffDelayMs(30, () => 0.999999)).toBeLessThanOrEqual(BACKOFF.maxMs);
  });
});

describe('nextAttemptAt', () => {
  it('programa el siguiente intento a futuro', () => {
    const from = new Date('2026-08-27T10:00:00Z');
    const next = nextAttemptAt(1, from, () => 0.5);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('shouldRetry', () => {
  it('reintenta mientras queden intentos', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(BACKOFF.maxAttempts - 1)).toBe(true);
  });

  it('deja de reintentar solo tras agotar los intentos', () => {
    // Deja de reintentar, pero el evento NO se borra: eso lo garantiza la outbox.
    expect(shouldRetry(BACKOFF.maxAttempts)).toBe(false);
    expect(shouldRetry(BACKOFF.maxAttempts + 5)).toBe(false);
  });
});

describe('resolutionFor', () => {
  it('trata un duplicado como éxito', () => {
    // Es exactamente lo que debe pasar al reintentar un evento ya registrado: la
    // idempotencia funcionó.
    expect(resolutionFor('duplicate')).toEqual({
      removeFromQueue: true,
      requiresAttention: false,
    });
  });

  it('saca de la cola lo aceptado', () => {
    expect(resolutionFor('accepted')).toEqual({
      removeFromQueue: true,
      requiresAttention: false,
    });
  });

  it('conserva en la cola lo que necesita revisión o fue rechazado', () => {
    // La regla que evita perder horas trabajadas: si el servidor no lo pudo
    // aplicar, el evento se queda visible hasta que una persona lo resuelva.
    for (const status of ['needs_review', 'rejected'] as const) {
      expect(resolutionFor(status)).toEqual({
        removeFromQueue: false,
        requiresAttention: true,
      });
    }
  });
});
