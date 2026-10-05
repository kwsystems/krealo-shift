import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminErrorState } from '@/components/schedule/data-states';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import {
  motivoSinFicha,
  textoDelMotivo,
  type MotivoSinFicha,
} from '@/features/acceso/motivo-sin-ficha';
import { AdminError, adminErrorCode } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { spacing } from '@/theme/tokens';

/**
 * UNA CUENTA QUE ENTRÓ Y NO TIENE ACCESO A NINGUNA EMPRESA (30-sep).
 *
 * Antes esto caía en el error genérico de permisos: «Sin permiso · Tu rol no permite ver
 * esto. Pídeselo a un administrador». Lo vio así una administradora recién invitada cuyo
 * canje fallaba, y era falso en las dos mitades: no tenía ningún rol, y pedírselo a un
 * administrador no servía, porque el administrador ya la había invitado. Tampoco decía
 * con qué correo había entrado, que es la causa más común —invitada a un correo, entra
 * con otro— y no tenía cómo salir para probar con el bueno.
 *
 * Ahora dice lo que pasa, con qué correo entró, qué hacer, y ofrece las dos salidas:
 * volver a intentar —el canje se reintenta en cada carga— o entrar con otro correo.
 *
 * Y POR QUÉ NO SE UNIÓ A SU FICHA, si el servidor lo sabe (5-oct): su correo está en dos
 * fichas, la ficha ya es de otra cuenta, o está desactivada. Ver `motivo-sin-ficha.ts`.
 */
export function SinAccesoScreen({
  onRetry,
  motivo = null,
}: {
  onRetry: () => void;
  motivo?: MotivoSinFicha | null;
}) {
  const { t } = useTranslation();
  const correo = useSessionStore((s) => s.user?.email ?? null);
  const signOut = useSessionStore((s) => s.signOut);
  const [saliendo, setSaliendo] = useState(false);

  const salir = () => {
    setSaliendo(true);
    void signOut().finally(() => setSaliendo(false));
  };

  return (
    <AppScreen tone="canvas" scroll testID="sin-acceso">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <Stack gap={spacing.xs}>
            <AppText variant="title">{t('boot.noAccessTitle')}</AppText>
            <AppText variant="body" tone="muted" testID="sin-acceso-correo">
              {correo === null
                ? t('boot.noAccessBodyNoEmail')
                : t('boot.noAccessBody', { email: correo })}
            </AppText>
          </Stack>

          {motivo === null ? null : (
            <Card testID={`sin-acceso-motivo-${motivo}`}>
              <Stack gap={spacing.sm}>
                <AppText variant="bodyStrong">{textoDelMotivo(t, motivo, correo).titulo}</AppText>
                <AppText variant="body" tone="muted">
                  {textoDelMotivo(t, motivo, correo).cuerpo}
                </AppText>
              </Stack>
            </Card>
          )}

          {motivo !== null && motivo !== 'sin-invitacion' ? null : (
            <Card>
              <Stack gap={spacing.sm}>
                <AppText variant="bodyStrong">{t('boot.noAccessInvitedTitle')}</AppText>
                <AppText variant="body" tone="muted">
                  {t('boot.noAccessInvitedBody')}
                </AppText>
                <AppText variant="body" tone="muted">
                  {t('boot.noAccessAskAdmin')}
                </AppText>
              </Stack>
            </Card>
          )}

          <Stack gap={spacing.sm}>
            <SecondaryButton
              label={t('common.retry')}
              onPress={onRetry}
              testID="sin-acceso-retry"
            />
            <GhostButton
              label={t('boot.noAccessOtherAccount')}
              onPress={salir}
              loading={saliendo}
              testID="sin-acceso-sign-out"
            />
          </Stack>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

/** ¿Es «tu cuenta no tiene ninguna membresía»? Lo lanza `use-manager-scope` tras intentar el canje. */
export function esSinMembresia(error: unknown): boolean {
  return (
    error instanceof AdminError && error.kind === 'forbidden' && error.message === 'NO_MEMBERSHIP'
  );
}

/**
 * Lo que se pinta cuando la membresía no se pudo leer: la pantalla de «sin acceso» si es
 * que no hay ninguna, y el error de siempre para todo lo demás (red, servidor…).
 */
export function ErrorDeMembresia({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (esSinMembresia(error)) {
    return <SinAccesoScreen onRetry={onRetry} motivo={motivoSinFicha(adminErrorCode(error))} />;
  }
  return (
    <AppScreen tone="canvas">
      <AdminErrorState error={error} onRetry={onRetry} />
    </AppScreen>
  );
}
