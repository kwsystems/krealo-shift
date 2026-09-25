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
              {/*
                ESTA FRASE —«la foto solo se toma si tu tienda la tiene activada»— ERA
                FALSA EN LA WEB HASTA EL 2026-09-25, y es la peor clase de falsedad: está
                en la única pantalla que el empleado puede abrir sin sesión, hecha
                precisamente para que la persona de quien se guardan los datos pueda leer
                qué se guarda. Mientras la web forzó la foto por encima del ajuste de la
                sede, aquí se le prometía a la gente algo que el código contradecía.

                Hoy es cierta, porque la foto volvió a depender solo del ajuste.

                QUIEN VUELVA A HACER LA FOTO OBLIGATORIA TIENE QUE TOCAR ESTE TEXTO, y por
                eso queda dicho aquí y no en el fichero de la regla: el que cambie la regla
                mirará la regla, no esta pantalla.
              */}
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
