import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { NumericKeypad, PinDots } from '@/components/attendance/pin-pad';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { AppScreen, Row, Stack } from '@/components/ui/layout';
import { SyncIndicator } from '@/components/ui/states';
import { verifyPin } from '@/features/kiosk/api';
import { buildOfflineSession, cacheAttendanceState } from '@/features/kiosk/offline-session';
import { useKioskVerificationStore } from '@/features/kiosk/verification-store';
import { verifyPinOffline } from '@/lib/offline/pin';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useResponsive } from '@/hooks/use-responsive';
import { DEFAULT_KIOSK_POLICIES, useKioskStore } from '@/stores/kiosk-store';
import { useNetworkStore } from '@/stores/network-store';
import { usePreferencesStore } from '@/stores/preferences-store';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { formatClockTime, formatLongDate } from '@/utils/time';

/**
 * Pantalla de reposo del kiosco (especificación §9.1).
 *
 * Decisiones que se ven aquí:
 * - la hora es el elemento dominante y se lee a un brazo de distancia (§33);
 * - el PIN se valida solo al completarse, sin botón "Aceptar" (§9.1);
 * - nunca se muestra la lista de personal antes de validar un PIN (§9.2);
 * - el logotipo con pulsación larga de 3 segundos es la única salida del kiosco,
 *   y existe alternativa administrativa, así que no es un gesto oculto
 *   imprescindible para tareas normales (§21).
 */

const EXIT_LONG_PRESS_MS = 3000;

export default function KioskIdleScreen() {
  const { t } = useTranslation();
  const { scaleFont, isWide, isCompact } = useResponsive();
  const now = useLiveClock('second');

  const binding = useKioskStore((s) => s.binding);
  const revoked = useKioskStore((s) => s.revoked);
  const markRevoked = useKioskStore((s) => s.markRevoked);
  const language = usePreferencesStore((s) => s.language);
  const toggleLanguage = usePreferencesStore((s) => s.toggleLanguage);
  const { online, syncing, pendingCount } = useNetworkStore();
  const setFromOnline = useKioskVerificationStore((s) => s.setFromOnline);
  const setFromOffline = useKioskVerificationStore((s) => s.setFromOffline);

  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policies = binding?.policies ?? DEFAULT_KIOSK_POLICIES;
  const timezone = binding?.timezone ?? 'America/Lima';
  const pinLength = policies.pinLength;

  const clearPin = useCallback(() => {
    setPin('');
    setError(null);
  }, []);

  const submit = useCallback(
    async (candidate: string) => {
      if (binding === null) return;
      setChecking(true);

      const result = await verifyPin({ pin: candidate, locationId: binding.locationId });

      setChecking(false);
      setPin('');

      if (result.ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFromOnline(result.data);
        // Se cachea el estado que confirmo el servidor: es de donde parte la
        // reconstruccion si despues se cae la red (§9.7).
        void cacheAttendanceState({
          employeeOpaqueId: result.data.employee.opaqueId,
          attendanceState: result.data.attendanceState,
          shiftId: result.data.eligibleShifts[0]?.id ?? null,
          sessionStartedAt: result.data.openSession?.startedAt ?? null,
          takenBreakMinutes: result.data.openSession?.takenBreakMinutes ?? 0,
        });
        router.push('/kiosk/actions');
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      switch (result.error.kind) {
        case 'invalid_pin':
          setError(t('kiosk.pinIncorrect'));
          break;
        case 'locked': {
          // No revelamos a quién corresponde el PIN bloqueado (§8).
          const minutes = minutesUntil(result.error.lockedUntil);
          setError(t('kiosk.pinLocked', { minutes }));
          break;
        }
        case 'revoked':
          // Se marca el estado, no solo el mensaje: el servidor acaba de decir que
          // este reloj ya no existe para el. Sin esto la pantalla de "reloj
          // desactivado" era inalcanzable y el iPad seguia pidiendo PIN que
          // siempre iban a fallar, sin decir por que.
          markRevoked();
          setError(t('errors.kioskRevoked'));
          break;
        case 'wrong_location':
          setError(t('errors.kioskWrongLocation'));
          break;
        case 'offline': {
          // Sin red se valida el PIN contra el verificador local del dispositivo,
          // que el servidor entrego al activar el kiosco (§9.7).
          const offline = await verifyPinOffline(candidate);

          if (offline.ok) {
            const session = await buildOfflineSession(offline.employeeOpaqueId);

            if (session.status === 'ready') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setFromOffline({
                employeeOpaqueId: offline.employeeOpaqueId,
                pinVersion: offline.pinVersion,
                session,
              });
              router.push('/kiosk/actions');
              return;
            }

            // No se conoce su estado: no se adivina. Ofrecerle una accion que el
            // servidor va a rechazar es peor que decirle la verdad.
            setError(t('kiosk.offlineStateUnknown'));
            break;
          }

          if (offline.reason === 'locked') {
            setError(t('kiosk.pinLocked', { minutes: minutesUntil(offline.lockedUntil) }));
          } else if (offline.reason === 'no_verifiers') {
            setError(t('kiosk.offlineNotReady'));
          } else if (offline.reason === 'no_device_key') {
            // Falta la clave del Keychain con la que se comprueban los
            // verificadores. Pasa en un iPad activado antes de este cambio: valida
            // online sin problema y hay que reactivarlo para volver a fichar sin
            // red. Se dice eso y no "PIN incorrecto", que seria mentira.
            setError(t('kiosk.offlineNeedsReactivation'));
          } else {
            setError(t('kiosk.pinIncorrect'));
          }
          break;
        }
        default:
          setError(t('errors.generic'));
      }
    },
    [binding, markRevoked, setFromOnline, setFromOffline, t],
  );

  // Validación automática al completar el PIN, sin botón "Aceptar" (§9.1).
  // Se dispara desde el manejador de la tecla y no desde un efecto: llamar a
  // setState dentro de un efecto provoca renders en cascada.
  const appendDigit = (digit: string) => {
    if (checking) return;
    setError(null);
    const next = pin.length >= pinLength ? pin : pin + digit;
    setPin(next);
    if (next.length === pinLength) void submit(next);
  };

  if (revoked) {
    return (
      <AppScreen tone="kiosk" testID="kiosk-revoked">
        <Stack gap={spacing.md} style={styles.centered}>
          <AppText variant="kioskTitle">{t('kiosk.revokedTitle')}</AppText>
          <AppText variant="body" tone="muted">
            {t('kiosk.revokedBody')}
          </AppText>
        </Stack>
      </AppScreen>
    );
  }

  return (
    <AppScreen tone="kiosk" padded={false} testID="kiosk-idle">
      <View style={[styles.container, { padding: isCompact ? spacing.lg : spacing.xxl }]}>
        {/* Encabezado: logo e ubicación a la izquierda, sincronización a la derecha */}
        <Row justify="space-between" align="flex-start">
          <Pressable
            onLongPress={() => router.push('/kiosk/exit')}
            delayLongPress={EXIT_LONG_PRESS_MS}
            accessibilityRole="button"
            accessibilityLabel={t('common.appName')}
            accessibilityHint={t('a11y.logoLongPress')}
            testID="kiosk-logo"
          >
            <Stack gap={spacing.xs}>
              <AppText variant="section" tone="primary">
                {t('common.appName')}
              </AppText>
              <AppText variant="help" tone="subtle">
                {binding?.locationName ?? ''}
              </AppText>
            </Stack>
          </Pressable>

          <SyncIndicator online={online} syncing={syncing} pendingCount={pendingCount} />
        </Row>

        {/* Reloj y fecha: el elemento dominante de la pantalla */}
        <Stack gap={spacing.xs} style={styles.clockBlock}>
          <AppText
            variant="kioskClock"
            size={scaleFont(fontSize.kioskClockMin, fontSize.kioskClockMax)}
            tabular
            accessibilityRole="header"
          >
            {formatClockTime(now, timezone, policies.timeFormat, language)}
          </AppText>
          <AppText variant="body" tone="muted">
            {formatLongDate(now, timezone, language)}
          </AppText>
        </Stack>

        {/* Instrucción y PIN */}
        <Stack gap={spacing.lg} style={styles.pinBlock}>
          <Stack gap={spacing.xs}>
            <AppText
              variant="kioskTitle"
              size={scaleFont(fontSize.kioskTitleMin, fontSize.kioskTitleMax)}
              style={styles.centerText}
            >
              {t('kiosk.idleTitle')}
            </AppText>
            <AppText variant="body" tone="muted" style={styles.centerText}>
              {t('kiosk.idleSubtitle')}
            </AppText>
          </Stack>

          <PinDots length={pinLength} entered={pin.length} error={error !== null} />

          {error !== null ? (
            <AppText
              variant="body"
              tone="danger"
              style={styles.centerText}
              accessibilityRole="alert"
              testID="kiosk-pin-error"
            >
              {error}
            </AppText>
          ) : null}

          <NumericKeypad
            onDigit={appendDigit}
            onBackspace={() => setPin((c) => c.slice(0, -1))}
            onClear={clearPin}
            size={isWide ? 'kiosk' : 'mobile'}
            disabled={checking}
          />
        </Stack>

        {/* Pie: idioma, ayuda y pendientes de sincronizar */}
        <Stack gap={spacing.sm}>
          {pendingCount > 0 ? (
            <AppText variant="help" tone="warning" style={styles.centerText}>
              {t('common.pendingRecords', { count: pendingCount })}
            </AppText>
          ) : null}

          <Row justify="space-between" align="center">
            <GhostButton
              label={language === 'es-PE' ? 'ES | en' : 'es | EN'}
              onPress={() => void toggleLanguage()}
              fullWidth={false}
              haptic={false}
              testID="kiosk-language-toggle"
            />
            <GhostButton
              label={t('kiosk.helpLink')}
              onPress={() => router.push('/kiosk/help')}
              fullWidth={false}
              haptic={false}
            />
          </Row>
        </Stack>
      </View>
    </AppScreen>
  );
}

function minutesUntil(isoDate: string): number {
  const target = Date.parse(isoDate);
  if (Number.isNaN(target)) return 1;
  return Math.max(1, Math.ceil((target - Date.now()) / 60_000));
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', backgroundColor: colors.primary50 },
  clockBlock: { alignItems: 'center' },
  pinBlock: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
