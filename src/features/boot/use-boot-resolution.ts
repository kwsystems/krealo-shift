import { useManagerMembership } from '@/hooks/use-manager-scope';
import { useKioskStore } from '@/stores/kiosk-store';
import { useSessionStore } from '@/stores/session-store';
import { resolveBootDestination, type BootDestination } from './resolve';

export type BootResolution = {
  destination: BootDestination;
  /** Reintento de la consulta de membresía, para el estado de error. */
  retry: () => void;
};

/**
 * Une el estado real con la resolución pura de `resolve.ts`.
 *
 * La consulta de membresía comparte `queryKey` con `ManagerScopeProvider`, así que
 * se hace UNA vez aunque la llamen la ruta raíz y el layout del panel: el segundo
 * lee el resultado de la caché.
 *
 * `enabled` la limita a cuando de verdad hace falta. En un iPad de tienda no se
 * pregunta nada: el kiosco no tiene sesión personal ni la necesita.
 */
export function useBootResolution(): BootResolution {
  const kioskHydrated = useKioskStore((s) => s.hydrated);
  const binding = useKioskStore((s) => s.binding);
  const phase = useSessionStore((s) => s.phase);
  const storedRole = useSessionStore((s) => s.role);

  const membership = useManagerMembership(
    phase === 'signedIn' && kioskHydrated && binding === null,
  );

  const destination = resolveBootDestination({
    kioskHydrated,
    isKioskDevice: binding !== null,
    phase,
    membershipRole: membership.data?.role ?? null,
    membershipError: membership.error,
    storedRole,
  });

  return { destination, retry: () => void membership.refetch() };
}
