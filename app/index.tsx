import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NoAdminAccessScreen } from '@/components/boot/no-admin-access';
import { AdminErrorState } from '@/components/schedule/data-states';
import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { useBootResolution } from '@/features/boot/use-boot-resolution';

/**
 * Resolución de arranque (§6.1).
 *
 * Aquí no hay lógica: la decisión la toma `resolveBootDestination`, que comparte
 * con `app/(manager)/_layout.tsx`. Estaba escrita dos veces y las dos copias
 * divergían —el motivo largo está en `src/features/boot/resolve.ts`—.
 *
 * Lo que la app necesita para arrancar tampoco vive aquí: la comprobación de
 * configuración y el arranque de la sesión están en `app/_layout.tsx`, que sí
 * cubre todas las rutas.
 */
export default function BootRoute() {
  const { t } = useTranslation();
  const { destination, retry } = useBootResolution();

  switch (destination.kind) {
    case 'resolving':
      return (
        <AppScreen tone="kiosk">
          <LoadingState label={t('boot.resolvingSession')} />
        </AppScreen>
      );
    case 'kiosk':
      return <Redirect href="/kiosk" />;
    case 'signIn':
      return <Redirect href="/(auth)/sign-in" />;
    case 'membershipError':
      // Mismo trato que en el panel: se explica y se puede reintentar. Antes esto
      // redirigía al acceso, que no arregla una consulta que falla y además deja
      // a quien ya tiene sesión iniciándola otra vez para nada.
      return (
        <AppScreen tone="canvas">
          <AdminErrorState error={destination.error} onRetry={retry} />
        </AppScreen>
      );
    case 'noAdminRole':
      return <NoAdminAccessScreen />;
    case 'adminPanel':
      return <Redirect href="/(manager)" />;
  }
}
