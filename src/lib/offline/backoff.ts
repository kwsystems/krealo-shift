/**
 * Reintentos de sincronización (especificación §17).
 *
 * Backoff exponencial con jitter. El jitter no es un detalle estético: sin él,
 * veinte iPad que perdieron la red a la vez la recuperan a la vez y golpean el
 * servidor en el mismo instante, una y otra vez.
 *
 * Lógica pura y sin dependencias, para poder probarla de verdad.
 */

export const BACKOFF = {
  baseMs: 2_000,
  maxMs: 5 * 60_000,
  /** A partir de aquí el evento deja de reintentarse solo y espera al gerente. */
  maxAttempts: 8,
} as const;

/**
 * Espera antes del intento número `attempt` (1 = primer reintento).
 *
 * `random` se inyecta para que las pruebas sean deterministas; en producción es
 * `Math.random`.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  if (attempt <= 0) return 0;

  const exponential = Math.min(BACKOFF.baseMs * 2 ** (attempt - 1), BACKOFF.maxMs);
  // Jitter completo: un valor uniforme entre la mitad y el total. Mantiene el
  // crecimiento exponencial pero dispersa los reintentos entre dispositivos.
  const jittered = exponential / 2 + random() * (exponential / 2);
  return Math.round(jittered);
}

export function nextAttemptAt(
  attempt: number,
  from: Date,
  random: () => number = Math.random,
): Date {
  return new Date(from.getTime() + backoffDelayMs(attempt, random));
}

/**
 * ¿Se sigue reintentando este evento?
 *
 * Un error permanente no se reintenta indefinidamente (§17): tras `maxAttempts`
 * el evento queda para que lo resuelva una persona. Lo que NO se hace nunca es
 * borrarlo: el fichaje ocurrió.
 */
export function shouldRetry(attempts: number): boolean {
  return attempts < BACKOFF.maxAttempts;
}

/** Estados que el servidor puede devolver por evento (§16 `sync-offline-events`). */
export type ServerEventStatus = 'accepted' | 'duplicate' | 'needs_review' | 'rejected';

/**
 * Qué hacer con un evento según lo que respondió el servidor.
 *
 * `duplicate` se trata como éxito: significa que el evento ya estaba registrado,
 * que es exactamente lo que la idempotencia debe producir en un reintento.
 *
 * `needs_review` y `rejected` NO se borran de la cola: se conservan visibles hasta
 * que un gerente los resuelva, porque el fichaje sucedió aunque el servidor no lo
 * pueda aplicar solo.
 */
export function resolutionFor(status: ServerEventStatus): {
  removeFromQueue: boolean;
  requiresAttention: boolean;
} {
  switch (status) {
    case 'accepted':
    case 'duplicate':
      return { removeFromQueue: true, requiresAttention: false };
    case 'needs_review':
    case 'rejected':
      return { removeFromQueue: false, requiresAttention: true };
  }
}
