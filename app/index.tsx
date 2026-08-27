import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { isEnvConfigured, missingEnvKeys } from '@/lib/env';
import { useKioskStore } from '@/stores/kiosk-store';
import { canUseAdminPanel, useSessionStore } from '@/stores/session-store';
import { spacing } from '@/theme/tokens';

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

  // Falta configuración de entorno: se explica qué falta en vez de reventar (§30).
  if (!isEnvConfigured) {
    return <MissingConfigScreen />;
  }

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

  // Con sesión pero sin rol administrativo resuelto todavía, esperamos: mandar a
  // (manager) sin permisos daría una pantalla vacía y confusa.
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

function MissingConfigScreen() {
  const { t } = useTranslation();
  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.base}>
          <AppText variant="title">{t('common.appName')}</AppText>
          <Card>
            <AppText variant="bodyStrong" tone="danger">
              {t('errors.configMissing', { keys: missingEnvKeys.join(', ') })}
            </AppText>
            <AppText variant="help" tone="subtle">
              .env.example → .env
            </AppText>
          </Card>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
