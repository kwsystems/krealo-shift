import { useState } from 'react';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton, pressHandledByLink, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { useSessionStore } from '@/stores/session-store';
import { spacing } from '@/theme/tokens';

/**
 * Sesión válida que no lleva a ningún panel (§6.2, §20).
 *
 * Existe porque este estado ES ALCANZABLE y antes no se contaba: una cuenta con
 * membresía de rol `employee`. Por §6.2 el empleado no tiene navegación personal
 * —ficha con su PIN en el iPad y nada más—, así que la ruta raíz no tenía destino
 * para ella y la mandaba a la pantalla de acceso. Ahí el acceso funcionaba, la
 * sesión ya era válida, y la ruta raíz la devolvía al acceso otra vez: encerrada,
 * sin un mensaje, intentando iniciar sesión en bucle contra una puerta que sí se
 * abría.
 *
 * Un estado sin salida se arregla diciendo lo que pasa y ofreciendo las dos salidas
 * que de verdad existen: fichar en el iPad de la tienda, o entrar con otra cuenta.
 */
export function NoAdminAccessScreen() {
  const { t } = useTranslation();
  const signOut = useSessionStore((s) => s.signOut);
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = () => {
    setSigningOut(true);
    // `signOut` limpia el estado local aunque el servidor no conteste, así que no
    // hace falta tratar el fallo aparte; lo que no se puede es dejar el botón
    // girando para siempre si algo revienta.
    void signOut().finally(() => setSigningOut(false));
  };

  return (
    <AppScreen tone="canvas" scroll testID="no-admin-access">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <Stack gap={spacing.xs}>
            <AppText variant="title">{t('boot.noAdminTitle')}</AppText>
            <AppText variant="help" tone="subtle">
              {t('boot.noAdminBody')}
            </AppText>
          </Stack>

          <Card>
            <Stack gap={spacing.sm}>
              <AppText variant="bodyStrong">{t('boot.noAdminClockInTitle')}</AppText>
              <AppText variant="help" tone="subtle">
                {t('boot.noAdminClockInBody')}
              </AppText>
            </Stack>
          </Card>

          <Stack gap={spacing.sm}>
            <SecondaryButton
              label={t('auth.signOut')}
              onPress={onSignOut}
              loading={signingOut}
              testID="no-admin-sign-out"
            />
            <Link href="/kiosk/setup" asChild>
              <GhostButton
                label={t('auth.setupKioskLink')}
                onPress={pressHandledByLink}
                testID="no-admin-setup-kiosk"
              />
            </Link>
          </Stack>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
