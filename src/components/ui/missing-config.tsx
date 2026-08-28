import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { missingEnvKeys } from '@/lib/env';
import { spacing } from '@/theme/tokens';

/**
 * Falta configuración del entorno: la app no tiene a dónde conectarse (§20).
 *
 * VIVE APARTE PORQUE LA PINTA EL LAYOUT RAÍZ, no una pantalla. Antes esta
 * comprobación estaba solo en `app/index.tsx`, o sea en la ruta `/`, y cualquier otra
 * ruta la saltaba entera: abrir `/kiosk` directamente en una app sin credenciales de
 * Supabase pintaba el kiosco completo —reloj, teclado, todo— y al teclear el PIN
 * respondía "No pudimos completar la acción. Inténtalo otra vez.", que es un consejo
 * imposible: reintentar no arregla que no haya servidor.
 *
 * Se llega ahí por un enlace directo, por la restauración de ruta al reiniciar la app,
 * y sobre todo por la previsualización web, que es como se revisa esto desde Windows.
 *
 * Una precondición que solo comprueba una pantalla no es una precondición.
 */
export function MissingConfigScreen() {
  const { t } = useTranslation();

  return (
    <AppScreen tone="canvas" scroll testID="missing-config">
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
