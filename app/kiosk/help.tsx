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

          {/*
            PRIVACIDAD, PARA QUIEN LE AFECTA (§22).

            §22 pide una pantalla que explique la cámara opcional y los fichajes. Había un
            aviso justo antes de tomar la foto —«se tomará una foto para verificar tu
            fichaje»— y un enlace a la política en Ajustes, pero Ajustes vive DETRÁS del
            acceso: el empleado, que es de quien se guardan los datos, no puede llegar
            nunca. Esta pantalla sí: se abre desde el reposo del kiosco, sin sesión.

            Se dice también lo que NO se hace. Un reloj de fichaje en una tienda levanta
            exactamente esas dos sospechas —que graba todo el rato y que sabe dónde
            estás—, y no responderlas no las quita, solo las deja sin respuesta.
          */}
          <Card>
            <Stack gap={spacing.sm}>
              <AppText variant="bodyStrong">{t('kiosk.privacyTitle')}</AppText>
              <AppText variant="help" tone="subtle">
                {t('kiosk.privacyRecorded')}
              </AppText>
              <AppText variant="help" tone="subtle">
                {t('kiosk.privacyPhoto')}
              </AppText>
              <AppText variant="help" tone="subtle">
                {t('kiosk.privacyNot')}
              </AppText>
            </Stack>
          </Card>

          <SecondaryButton label={t('common.back')} onPress={() => router.back()} />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
