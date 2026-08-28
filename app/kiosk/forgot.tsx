import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FormField } from '@app/(auth)/sign-in';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { submitTimeEditRequest } from '@/features/kiosk/api';
import { useKioskVerificationStore } from '@/features/kiosk/verification-store';
import { colors, spacing } from '@/theme/tokens';

/**
 * "Olvidé marcar" (§10.3).
 *
 * El empleado propone una hora y escribe un motivo. Esto crea una solicitud
 * pendiente: nunca modifica la hoja de tiempo directamente. Un gerente decide, y
 * la decisión queda auditada.
 */

type RequestKind = 'forgot_clock_in' | 'forgot_break' | 'forgot_clock_out';

export default function KioskForgotScreen() {
  const { t } = useTranslation();
  const verification = useKioskVerificationStore((s) => s.verification);
  const clearVerification = useKioskVerificationStore((s) => s.clear);

  const [kind, setKind] = useState<RequestKind | null>(null);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /*
   * SIN SESIÓN VALIDADA ESTA PANTALLA ERA UN CALLEJÓN SIN SALIDA.
   *
   * `submit` empieza con `if (verification === null || kind === null) return;`, así
   * que se podía elegir el tipo, escribir la hora y el motivo, pulsar enviar y NO
   * PASABA NADA: ni error, ni confirmación. El formulario se pinta perfecto, que es
   * por lo que el chequeo de render lo daba por bueno.
   *
   * Se llega aquí sin verificación al recargar la ruta —la previsualización web es
   * justo así—, al volver atrás después de que la sesión se limpie, y por enlace
   * directo. `app/kiosk/actions.tsx` ya lo hacía; esta pantalla se había quedado sin
   * la misma protección.
   *
   * No se muestra un error: se vuelve al reposo, que es donde se empieza. Un
   * empleado que ve un formulario a medias no sabe que le falta teclear su PIN.
   */
  const returnToIdle = useCallback(() => {
    clearVerification();
    router.replace('/kiosk');
  }, [clearVerification]);

  useEffect(() => {
    if (verification === null) returnToIdle();
  }, [verification, returnToIdle]);

  const submit = async () => {
    if (verification === null || kind === null) return;

    // Sin token del servidor no se puede crear la solicitud: una sesion validada
    // offline no tiene autorizacion verificable. Se le pide esperar conexion en
    // lugar de dejar la solicitud a medias (§9.7).
    if (verification.actionToken === null) {
      setError(t('kiosk.offlineStateUnknown'));
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await submitTimeEditRequest({
      actionToken: verification.actionToken,
      kind,
      proposedAt: time,
      reason: reason.trim(),
    });

    setSubmitting(false);

    if (result.ok) {
      setSent(true);
      return;
    }
    setError(result.error.kind === 'offline' ? t('errors.network') : t('errors.generic'));
  };

  if (verification === null) return null;

  if (sent) {
    return (
      <AppScreen tone="kiosk">
        <ResponsiveContainer width="form">
          <Stack gap={spacing.lg} style={styles.centered}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success600} />
            <AppText variant="section" style={styles.centerText}>
              {t('kiosk.forgotSubmitted')}
            </AppText>
            <PrimaryButton label={t('common.done')} onPress={returnToIdle} />
          </Stack>
        </ResponsiveContainer>
      </AppScreen>
    );
  }

  return (
    <AppScreen tone="kiosk" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <AppText variant="title">{t('kiosk.forgotToClock')}</AppText>

          <Card>
            <SecondaryButton
              label={t('kiosk.forgotClockIn')}
              onPress={() => setKind('forgot_clock_in')}
              style={kind === 'forgot_clock_in' ? styles.selected : undefined}
            />
            <SecondaryButton
              label={t('kiosk.forgotBreak')}
              onPress={() => setKind('forgot_break')}
              style={kind === 'forgot_break' ? styles.selected : undefined}
            />
            <SecondaryButton
              label={t('kiosk.forgotClockOut')}
              onPress={() => setKind('forgot_clock_out')}
              style={kind === 'forgot_clock_out' ? styles.selected : undefined}
            />
          </Card>

          {kind !== null ? (
            <Card>
              <FormField
                label={t('kiosk.forgotProposedTime')}
                value={time}
                onChangeText={setTime}
                placeholder="14:30"
                keyboardType="numbers-and-punctuation"
                testID="forgot-time"
              />
              <FormField
                label={t('kiosk.forgotReasonLabel')}
                value={reason}
                onChangeText={setReason}
                multiline
                testID="forgot-reason"
              />

              {error !== null ? (
                <AppText variant="help" tone="danger" accessibilityRole="alert">
                  {error}
                </AppText>
              ) : null}

              <PrimaryButton
                label={t('common.save')}
                onPress={() => void submit()}
                loading={submitting}
                disabled={reason.trim().length === 0 || time.trim().length === 0}
                testID="forgot-submit"
              />
            </Card>
          ) : null}

          <SecondaryButton label={t('common.cancel')} onPress={() => router.back()} />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  selected: { borderColor: colors.primary500, borderWidth: 2 },
  centered: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
