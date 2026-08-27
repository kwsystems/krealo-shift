import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { usePushRegistration } from './hooks';
import { InlineNotice } from '@/components/schedule/fields';
import { SecondaryButton } from '@/components/ui/buttons';
import { Stack } from '@/components/ui/layout';
import { PermissionExplainer } from '@/components/ui/states';
import { spacing } from '@/theme/tokens';

/**
 * Estado de las notificaciones de este dispositivo, dentro de la tarjeta de
 * Notificaciones de la configuración (§11.6, §19, §25).
 *
 * EL PERMISO SE PIDE CON EXPLICACIÓN PREVIA, SIEMPRE. En iOS el diálogo del
 * sistema se muestra una sola vez: si aparece de golpe al abrir el panel, la mitad
 * de la gente lo rechaza por reflejo y después no hay forma de volver a pedirlo
 * desde la app, solo desde los Ajustes del sistema. Por eso el permiso solo se
 * pide cuando la persona pulsa el botón de `PermissionExplainer`.
 *
 * Los ocho interruptores de abajo se guardan igual sin permiso: son la preferencia
 * de la cuenta, no de este dispositivo, y sirven aunque los avisos lleguen a otro
 * teléfono.
 */
export function PushPermissionCard() {
  const { t } = useTranslation();
  const push = usePushRegistration();

  if (!push.decision.allowed) {
    // Mientras se resuelve si el dispositivo es kiosco no se dice nada: un aviso
    // que aparece y desaparece confunde más que el silencio.
    if (push.decision.reason === 'resolving') return null;

    const bodyKey =
      push.decision.reason === 'web'
        ? 'notifications.unavailableWeb'
        : push.decision.reason === 'kiosk'
          ? 'notifications.unavailableKiosk'
          : push.decision.reason === 'noProjectId'
            ? 'notifications.unavailableProject'
            : 'notifications.unavailableSession';

    return (
      <InlineNotice
        tone="info"
        icon="information-circle-outline"
        title={t('notifications.unavailableTitle')}
        body={t(bodyKey)}
      />
    );
  }

  if (push.permission === 'denied') {
    return (
      <Stack gap={spacing.sm}>
        <InlineNotice
          tone="late"
          icon="notifications-off-outline"
          title={t('notifications.deniedTitle')}
          body={t('notifications.deniedBody')}
        />
        <SecondaryButton
          label={t('notifications.openSettings')}
          onPress={() => {
            // En web no existe; en un simulador puede fallar. Ni una cosa ni la
            // otra debe tumbar la pantalla de configuración.
            void Linking.openSettings().catch(() => undefined);
          }}
          testID="push-open-settings"
        />
      </Stack>
    );
  }

  if (push.permission === 'granted') {
    if (push.error !== null && push.error !== undefined) {
      return (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          title={t('states.errorTitle')}
          body={t('notifications.registerFailed')}
        />
      );
    }

    return push.registered ? (
      <InlineNotice
        tone="working"
        icon="notifications-outline"
        title={t('notifications.activeTitle')}
        body={t('notifications.activeBody')}
      />
    ) : (
      <InlineNotice
        tone="onBreak"
        icon="time-outline"
        title={t('notifications.pendingTitle')}
        body={t('notifications.pendingBody')}
      />
    );
  }

  // 'undetermined', o todavía sin respuesta del sistema: se explica antes de pedir.
  return (
    <PermissionExplainer
      icon="notifications-outline"
      title={t('notifications.explainTitle')}
      body={t('notifications.explainBody')}
      actionLabel={t('notifications.enable')}
      onAction={push.enable}
    />
  );
}
