import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { useManagerMembership } from '@/hooks/use-manager-scope';
import { useKioskStore } from '@/stores/kiosk-store';
import { canUseAdminPanel, useSessionStore } from '@/stores/session-store';

/**
 * Resolución de arranque (especificación §6.1).
 *
 * El orden importa: el estado seguro local y la vinculación de kiosco ya se
 * hidrataron en el layout raíz, así que aquí solo decidimos destino. No se muestra
 * una pantalla equivocada mientras se resuelve la sesión: mientras `phase` es
 * `unknown` se ve una carga sobria, no el acceso ni el panel.
 */
export default function BootRoute() {
  const { t } = useTranslation();

  const kioskHydrated = useKioskStore((s) => s.hydrated);
  const binding = useKioskStore((s) => s.binding);

  const phase = useSessionStore((s) => s.phase);
  const role = useSessionStore((s) => s.role);
  const hydrateSession = useSessionStore((s) => s.hydrate);
  const subscribeSession = useSessionStore((s) => s.subscribe);

  useEffect(() => {
    void hydrateSession();
    return subscribeSession();
  }, [hydrateSession, subscribeSession]);

  /**
   * AQUÍ SE RESUELVE EL ROL, Y HACE FALTA QUE SEA AQUÍ.
   *
   * La sesión de Supabase dice quién eres, no qué puedes hacer: el rol vive en
   * `organization_memberships`. Sin esta consulta el arranque se quedaba
   * bloqueado para siempre en un caso concreto y nada raro: una persona con
   * sesión válida en un dispositivo que no es kiosco. Esta pantalla esperaba
   * `role !== null`, pero lo único que ponía el rol era el layout de `(manager)`,
   * al que no se llega sin rol. Un ciclo cerrado.
   *
   * La consulta comparte `queryKey` con `ManagerScopeProvider`, así que se hace
   * UNA vez: el layout y el provider leen este mismo resultado de la caché.
   *
   * `enabled` la limita a cuando de verdad hace falta. En un iPad de tienda no se
   * pregunta nada: el kiosco no tiene sesión personal ni la necesita.
   */
  const membership = useManagerMembership(
    phase === 'signedIn' && kioskHydrated && binding === null,
  );

  // Falta configuración de entorno: se explica qué falta en vez de reventar (§30).
  if (!kioskHydrated || phase === 'unknown') {
    return (
      <AppScreen tone="kiosk">
        <LoadingState label={t('boot.resolvingSession')} />
      </AppScreen>
    );
  }

  // 2 y 3: si el dispositivo es kiosco, el reloj compartido manda, incluso sin
  // conexión. Un iPad de tienda no debe pedir sesión personal para fichar.
  if (binding !== null) {
    return <Redirect href="/kiosk" />;
  }

  // 4: sesión personal válida → navegación por rol.
  if (phase === 'signedIn' && canUseAdminPanel(role)) {
    return <Redirect href="/(manager)" />;
  }

  // La membresía no se pudo leer: es una sesión válida sin pertenencia a ninguna
  // empresa, o RLS la negó. No se espera para siempre ni se manda al panel: se
  // devuelve al acceso, que es donde esa persona puede hacer algo (§20).
  if (phase === 'signedIn' && membership.isError) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Con sesión pero sin rol resuelto todavía, esperamos: mandar a (manager) sin
  // permisos daría una pantalla vacía y confusa.
  if (phase === 'signedIn' && role === null) {
    return (
      <AppScreen tone="kiosk">
        <LoadingState label={t('boot.resolvingSession')} />
      </AppScreen>
    );
  }

  // 5: sin sesión → acceso, con la opción separada de configurar el iPad.
  return <Redirect href="/(auth)/sign-in" />;
}
