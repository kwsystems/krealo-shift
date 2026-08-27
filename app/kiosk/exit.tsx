import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { NumericKeypad, PinDots } from '@/components/attendance/pin-pad';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { verifyPin } from '@/features/kiosk/api';
import { refreshOfflinePackage, runSync } from '@/lib/offline/sync';
import { DEFAULT_KIOSK_POLICIES, useKioskStore } from '@/stores/kiosk-store';
import { useNetworkStore } from '@/stores/network-store';
import { spacing } from '@/theme/tokens';
import { formatClockTime } from '@/utils/time';

/**
 * Salida y opciones del kiosco (§6.4, §31).
 *
 * Se llega aquí solo con una pulsación larga de 3 segundos sobre el logotipo, y
 * hace falta el PIN de un GERENTE de esta tienda para continuar. El menú aparece
 * únicamente después de esa autorización: un empleado no debe poder revocar el
 * dispositivo ni cambiar la ubicación.
 *
 * QUIÉN DECIDE SI ALGUIEN ES GERENTE
 * Lo decide el servidor, en `canManageLocation`. El kiosco no lo deduce: no tiene
 * con qué, y una comprobación local sería adivinar. Un PIN correcto de una
 * empleada normal identifica bien a esa persona pero NO abre este menú.
 *
 * Por eso este menú no funciona sin conexión: la sesión offline pone
 * `canManageLocation: false` a propósito, porque el iPad no puede confirmar
 * permisos por su cuenta. Se dice claramente en pantalla en vez de dejar pasar.
 *
 * El diagnóstico se puede copiar sin datos personales (§31).
 */
export default function KioskExitScreen() {
  const { t } = useTranslation();

  const binding = useKioskStore((s) => s.binding);
  const deactivate = useKioskStore((s) => s.deactivate);
  const { online, pendingCount, lastSyncAt, needsReviewCount } = useNetworkStore();

  const [pin, setPin] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policies = binding?.policies ?? DEFAULT_KIOSK_POLICIES;
  const timezone = binding?.timezone ?? 'America/Lima';

  const tryAuthorize = async (candidate: string) => {
    if (binding === null) return;
    setChecking(true);
    const result = await verifyPin({ pin: candidate, locationId: binding.locationId });
    setChecking(false);
    setPin('');

    if (result.ok) {
      // EL PIN CORRECTO NO ALCANZA. Antes esta pantalla se abría con cualquier PIN
      // válido, así que la PIN de una empleada llegaba al botón que desactiva el
      // kiosco. §6.4 pide PIN de gerente, y quien lo determina es el servidor.
      if (!result.data.employee.canManageLocation) {
        setError(t('kiosk.exitNotManager'));
        return;
      }
      setAuthorized(true);
      setError(null);
      return;
    }

    if (result.error.kind === 'offline') {
      // Sin red no hay forma de confirmar que quien teclea es gerente, y esta
      // pantalla puede desactivar el reloj. Se dice por qué, no un error genérico.
      setError(t('kiosk.exitNeedsConnection'));
      return;
    }

    setError(t('kiosk.pinIncorrect'));
  };

  const appendDigit = (digit: string) => {
    setError(null);
    const next = pin.length >= policies.pinLength ? pin : pin + digit;
    setPin(next);
    if (next.length === policies.pinLength) void tryAuthorize(next);
  };

  if (!authorized) {
    return (
      <AppScreen tone="kiosk" scroll>
        <ResponsiveContainer width="form">
          <Stack gap={spacing.lg} style={styles.centered}>
            <AppText variant="title">{t('kiosk.exitTitle')}</AppText>
            <AppText variant="body" tone="muted">
              {t('kiosk.exitEnterManagerPin')}
            </AppText>
            <PinDots length={policies.pinLength} entered={pin.length} error={error !== null} />
            {error !== null ? (
              <AppText variant="help" tone="danger" accessibilityRole="alert">
                {error}
              </AppText>
            ) : null}
            <NumericKeypad
              onDigit={appendDigit}
              onBackspace={() => setPin((c) => c.slice(0, -1))}
              onClear={() => setPin('')}
              size="mobile"
              disabled={checking}
            />
            <SecondaryButton label={t('common.cancel')} onPress={() => router.back()} />
          </Stack>
        </ResponsiveContainer>
      </AppScreen>
    );
  }

  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <AppText variant="title">{t('settings.diagnostics')}</AppText>

          <Card>
            <DiagnosticRow label={t('settings.kioskDeviceName')} value={binding?.displayName ?? '—'} />
            <DiagnosticRow label={t('settings.locations')} value={binding?.locationName ?? '—'} />
            <DiagnosticRow
              label={t('a11y.syncIndicator')}
              value={online ? t('a11y.connectionOnline') : t('a11y.connectionOffline')}
            />
            <DiagnosticRow label={t('settings.kioskPendingEvents')} value={String(pendingCount)} />
            <DiagnosticRow label={t('states.needsReviewBadge')} value={String(needsReviewCount)} />
            <DiagnosticRow
              label={t('settings.kioskLastSeen')}
              value={
                lastSyncAt === null
                  ? '—'
                  : formatClockTime(lastSyncAt, timezone, policies.timeFormat)
              }
            />
            <DiagnosticRow
              label={t('settings.appVersion')}
              value={Constants.expoConfig?.version ?? '—'}
            />
          </Card>

          <Stack gap={spacing.md}>
            <SecondaryButton
              label={t('kiosk.menuSync')}
              onPress={() => {
                void runSync();
              }}
              testID="kiosk-sync-now"
            />
            <SecondaryButton
              label={t('kiosk.menuRefreshRoster')}
              onPress={() => {
                void refreshOfflinePackage();
              }}
              testID="kiosk-refresh-roster"
            />
            <SecondaryButton label={t('common.back')} onPress={() => router.back()} />
            <DangerButton
              label={t('kiosk.menuExit')}
              onPress={() => {
                void deactivate().then(() => router.replace('/'));
              }}
              testID="kiosk-exit-confirm"
            />
          </Stack>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justify="space-between" gap={spacing.md}>
      <AppText variant="help" tone="subtle">
        {label}
      </AppText>
      <AppText variant="bodyStrong" tabular>
        {value}
      </AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center' },
});
