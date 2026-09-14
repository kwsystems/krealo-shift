import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/**
 * El modo kiosco no está disponible en esta plataforma (§20).
 *
 * Es distinto de `KioskNotSetUpState`, y la diferencia importa: aquel dice «este
 * dispositivo todavía no es un reloj» y ofrece configurarlo, que es una situación
 * que se arregla. Esta dice «aquí no va a poder serlo», y ofrecer configurarlo sería
 * mandar a alguien a un callejón sin salida.
 *
 * El límite es real y está explicado en `src/lib/kiosk/disponibilidad.ts`. Lo que se
 * hacía antes era lanzar una excepción al arrancar, que tumbaba la aplicación entera
 * —panel incluido— con un error técnico. Un límite que se puede explicar se explica.
 *
 * Se dice POR QUÉ y no solo QUE NO: quien lee esto está intentando montar el reloj de
 * una tienda, y la pregunta que le va a quedar es si se trata de un fallo o de una
 * decisión. Y se le dice qué sí funciona aquí, para que no se vaya creyendo que la
 * aplicación no sirve.
 */
export function KioskUnavailableHere() {
  const { t } = useTranslation();

  return (
    <AppScreen tone="kiosk" testID="kiosk-unavailable-here">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.md} style={estilos.centrado}>
          <AppText variant="kioskTitle" style={estilos.textoCentrado}>
            {t('kiosk.unavailableHereTitle')}
          </AppText>
          <AppText variant="body" tone="muted" style={estilos.textoCentrado}>
            {t('kiosk.unavailableHereBody')}
          </AppText>
          <SecondaryButton
            label={t('kiosk.unavailableHereAction')}
            onPress={() => router.replace('/')}
            testID="kiosk-unavailable-go-home"
          />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

const estilos = StyleSheet.create({
  centrado: { flex: 1, justifyContent: 'center' },
  textoCentrado: { textAlign: 'center' },
});
