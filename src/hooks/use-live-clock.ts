import { useEffect, useState } from 'react';

/**
 * Reloj vivo para el kiosco y las duraciones en curso (§9.1, §9.3).
 *
 * Se actualiza al segundo solo cuando hace falta —el reloj de reposo— y al minuto
 * en el resto, para no re-renderizar la pantalla 60 veces por minuto sin motivo.
 */
export function useLiveClock(resolution: 'second' | 'minute' = 'second'): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalMs = resolution === 'second' ? 1000 : 15_000;

    // Alineamos el primer tick al siguiente segundo para que el reloj no salte.
    const msToNextTick = resolution === 'second' ? 1000 - (Date.now() % 1000) : intervalMs;

    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), intervalMs);
    }, msToNextTick);

    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, [resolution]);

  return now;
}
