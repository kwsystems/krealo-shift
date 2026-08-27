import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/**
 * Ayuda y accesibilidad del kiosco (§9.1, §21).
 *
 * Explica al empleado cómo fichar y por qué los dígitos del PIN no se leen en voz
 * alta en un dispositivo compartido.
 */
export default function KioskHelpScreen() {
  const { t } = useTranslation();

  return (
    <AppScreen tone="kiosk" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <AppText variant="title">{t('kiosk.helpLink')}</AppText>
          <Card>
            <AppText variant="bodyStrong">{t('kiosk.idleSubtitle')}</AppText>
            <AppText variant="help" tone="subtle">
              {t('a11y.pinHiddenNotice')}
            </AppText>
          </Card>
          <Card>
            <AppText variant="bodyStrong">{t('kiosk.forgotToClock')}</AppText>
            <AppText variant="help" tone="subtle">
              {t('kiosk.forgotSubmitted')}
            </AppText>
          </Card>
          <SecondaryButton label={t('common.back')} onPress={() => router.back()} />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
