import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { ActionCountdown } from '@/components/ui/action-countdown';
import { DangerButton, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { submitTimeEvent, type TimeEventType } from '@/features/kiosk/api';
import { useKioskVerificationStore } from '@/features/kiosk/verification-store';
import { useLiveClock } from '@/hooks/use-live-clock';
import {
  closesOpenBreak,
  evaluateClockInEligibility,
  primaryEvent,
  secondaryEvent,
  transition,
} from '@/domain/attendance-state-machine';
import { DEFAULT_KIOSK_POLICIES, useKioskStore } from '@/stores/kiosk-store';
import { usePreferencesStore } from '@/stores/preferences-store';
import { colors, durations, sizes, spacing } from '@/theme/tokens';
import { formatClockTime, formatShiftRange, minutesToHHmm } from '@/utils/time';

/**
 * Flujo del empleado tras validar el PIN (§9.2 a §9.5).
 *
 * Pasos: identificación → acción permitida → confirmación con cuenta regresiva →
 * resultado → regreso automático a reposo limpiando todo rastro.
 *
 * Lo que este archivo garantiza:
 * - solo se ofrecen acciones que la máquina de estados permite (§12);
 * - la acción irreversible pasa por una cuenta regresiva cancelable (§9.4);
 * - al volver a reposo se limpia nombre, turno y token de acción (§9.5).
 */

type Step =
  | { name: 'identify' }
  | { name: 'confirm'; event: TimeEventType; breakType?: 'paid' | 'unpaid' | 'meal' | 'other' }
  | { name: 'result'; event: TimeEventType; occurredAt: string; offline: boolean; shiftEndsAt: string | null };

export default function KioskActionsScreen() {
  const { t } = useTranslation();
  const now = useLiveClock('minute');

  const verification = useKioskVerificationStore((s) => s.verification);
  const selectedShiftId = useKioskVerificationStore((s) => s.selectedShiftId);
  const selectShift = useKioskVerificationStore((s) => s.selectShift);
  const clearVerification = useKioskVerificationStore((s) => s.clear);

  const binding = useKioskStore((s) => s.binding);
  const language = usePreferencesStore((s) => s.language);

  const [step, setStep] = useState<Step>({ name: 'identify' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policies = binding?.policies ?? DEFAULT_KIOSK_POLICIES;
  const timezone = binding?.timezone ?? 'America/Lima';

  /** Vuelve a reposo limpiando todo el estado temporal (§9.5). */
  const returnToIdle = useCallback(() => {
    clearVerification();
    router.replace('/kiosk');
  }, [clearVerification]);

  // Si no hay verificación (recarga en web, o vuelta atrás), no inventamos una
  // sesión: se vuelve al reposo.
  useEffect(() => {
    if (verification === null) returnToIdle();
  }, [verification, returnToIdle]);

  // Regreso automático a reposo cuatro segundos después del resultado (§9.5).
  useEffect(() => {
    if (step.name !== 'result') return;
    const timer = setTimeout(returnToIdle, durations.kioskAutoReturnMs);
    return () => clearTimeout(timer);
  }, [step, returnToIdle]);

  const selectedShift = useMemo(
    () => verification?.eligibleShifts.find((shift) => shift.id === selectedShiftId) ?? null,
    [verification, selectedShiftId],
  );

  if (verification === null) return null;

  const state = verification.attendanceState;
  const primary = primaryEvent(state);
  const secondary = secondaryEvent(state);

  const eligibility = evaluateClockInEligibility({
    now,
    shiftStartsAt: selectedShift === null ? null : new Date(selectedShift.startsAt),
    earlyClockInMinutes: policies.earlyClockInMinutes,
    allowUnscheduledShifts: policies.allowUnscheduledShifts,
  });

  const startAction = (event: TimeEventType) => {
    const result = transition(state, event);
    if (!result.allowed) {
      setError(t('errors.invalidTransition'));
      return;
    }
    setError(null);
    setStep({ name: 'confirm', event });
  };

  const commitAction = async (event: TimeEventType) => {
    setSubmitting(true);
    setError(null);

    // La clave de idempotencia se genera antes de enviar, para que un reintento o
    // un doble toque produzcan el mismo evento y no dos (§12, §17).
    const idempotencyKey = Crypto.randomUUID();

    const result = await submitTimeEvent({
      actionToken: verification.actionToken,
      eventType: event,
      shiftId: selectedShift?.id ?? null,
      idempotencyKey,
      occurredAtDevice: new Date().toISOString(),
      deviceSequence: Date.now(),
      isOffline: false,
    });

    setSubmitting(false);

    if (result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep({
        name: 'result',
        event,
        occurredAt: result.data.occurredAt,
        offline: false,
        shiftEndsAt: result.data.summary.shiftEndsAt,
      });
      return;
    }

    if (result.error.kind === 'offline') {
      // Sin conexión el evento se encola; la cola offline es P0-4. Hasta que exista
      // no afirmamos que quedó guardado: decirlo sin haberlo guardado sería mentir
      // al empleado sobre su jornada (§17).
      setError(t('errors.network'));
      return;
    }

    setError(
      result.error.kind === 'invalid_transition'
        ? t('errors.invalidTransition')
        : result.error.kind === 'revoked'
          ? t('errors.kioskRevoked')
          : result.error.kind === 'wrong_location'
            ? t('errors.kioskWrongLocation')
            : t('errors.generic'),
    );
    setStep({ name: 'identify' });
  };

  return (
    <AppScreen tone="kiosk" scroll testID="kiosk-actions">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          {/* §9.2 Identificación: lo mínimo necesario, nunca datos de otros */}
          <Card>
            <Row gap={spacing.base} align="center">
              <View style={styles.avatar}>
                <AppText variant="section" tone="onPrimary">
                  {verification.employee.initials}
                </AppText>
              </View>
              <Stack gap={spacing.xs} style={styles.flexOne}>
                <AppText variant="title">
                  {t('kiosk.greeting', { name: verification.employee.displayName })}
                </AppText>
                <Row gap={spacing.sm} wrap>
                  <StatusBadge
                    label={t(`attendance.status${statusKey(state)}`)}
                    tone={state === 'WORKING' ? 'working' : state === 'ON_BREAK' ? 'onBreak' : 'offShift'}
                  />
                  {verification.employee.jobRoleName !== null ? (
                    <AppText variant="help" tone="subtle">
                      {verification.employee.jobRoleName} · {binding?.locationName ?? ''}
                    </AppText>
                  ) : null}
                </Row>
              </Stack>
            </Row>

            {verification.openSession !== null ? (
              <AppText variant="body" tone="muted" tabular>
                {state === 'ON_BREAK' && verification.openSession.openBreak !== null
                  ? t('kiosk.onBreakSince', {
                      time: formatClockTime(
                        verification.openSession.openBreak.startedAt,
                        timezone,
                        policies.timeFormat,
                        language,
                      ),
                    })
                  : t('kiosk.workingSince', {
                      time: formatClockTime(
                        verification.openSession.startedAt,
                        timezone,
                        policies.timeFormat,
                        language,
                      ),
                    })}
              </AppText>
            ) : null}

            {selectedShift !== null ? (
              <Stack gap={spacing.xs}>
                <AppText variant="help" tone="subtle">
                  {t('kiosk.nextShift', {
                    range: formatShiftRange(
                      selectedShift.startsAt,
                      selectedShift.endsAt,
                      timezone,
                      policies.timeFormat,
                      language,
                    ),
                  })}
                </AppText>
                {selectedShift.employeeNote !== null ? (
                  <AppText variant="help">{selectedShift.employeeNote}</AppText>
                ) : null}
                {selectedShift.changedSinceLastPublication ? (
                  <StatusBadge label={t('schedule.changedBadge')} tone="info" compact />
                ) : null}
              </Stack>
            ) : (
              <AppText variant="help" tone="subtle">
                {t('kiosk.noShiftScheduled')}
              </AppText>
            )}
          </Card>

          {/* Varios turnos elegibles: el empleado elige (§9.3) */}
          {verification.eligibleShifts.length > 1 && step.name === 'identify' ? (
            <Card>
              <AppText variant="bodyStrong">{t('kiosk.chooseShift')}</AppText>
              {verification.eligibleShifts.map((shift) => (
                <SecondaryButton
                  key={shift.id}
                  label={formatShiftRange(
                    shift.startsAt,
                    shift.endsAt,
                    timezone,
                    policies.timeFormat,
                    language,
                  )}
                  hint={shift.jobRoleName ?? undefined}
                  onPress={() => selectShift(shift.id)}
                  style={shift.id === selectedShiftId ? styles.selected : undefined}
                />
              ))}
            </Card>
          ) : null}

          {error !== null ? (
            <Card>
              <Row gap={spacing.sm} align="center">
                <Ionicons name="alert-circle" size={sizes.iconMobile} color={colors.danger600} />
                <AppText variant="body" tone="danger" accessibilityRole="alert" style={styles.flexOne}>
                  {error}
                </AppText>
              </Row>
            </Card>
          ) : null}

          {/* §9.3 Acciones según estado, §9.4 confirmación, §9.5 resultado */}
          {step.name === 'identify' ? (
            <Stack gap={spacing.md}>
              {!eligibility.eligible && eligibility.reason === 'too_early' ? (
                <Card>
                  <AppText variant="bodyStrong">{t('kiosk.tooEarlyTitle')}</AppText>
                  <AppText variant="body" tone="muted">
                    {t('kiosk.tooEarlyBody', {
                      time: formatClockTime(
                        eligibility.earliestAt,
                        timezone,
                        policies.timeFormat,
                        language,
                      ),
                    })}
                  </AppText>
                </Card>
              ) : (
                <PrimaryButton
                  label={t(`kiosk.${eventLabelKey(primary)}`)}
                  onPress={() => startAction(primary)}
                  size="kiosk"
                  loading={submitting}
                  testID={`kiosk-action-${primary}`}
                />
              )}

              {secondary !== null ? (
                <DangerButton
                  label={t(`kiosk.${eventLabelKey(secondary)}`)}
                  hint={closesOpenBreak(state, secondary) ? t('kiosk.closeOpenBreakBody') : undefined}
                  onPress={() => startAction(secondary)}
                  testID={`kiosk-action-${secondary}`}
                />
              ) : null}

              <GhostButton label={t('kiosk.forgotToClock')} onPress={() => router.push('/kiosk/forgot')} />
              <GhostButton label={t('common.cancel')} onPress={returnToIdle} />
            </Stack>
          ) : null}

          {step.name === 'confirm' ? (
            <Card floating>
              <AppText variant="section">{t('kiosk.confirmTitle')}</AppText>
              <SummaryRow
                label={t('kiosk.confirmAction')}
                value={t(`kiosk.${eventLabelKey(step.event)}`)}
              />
              <SummaryRow
                label={t('kiosk.confirmTime')}
                value={formatClockTime(now, timezone, policies.timeFormat, language)}
              />
              <SummaryRow label={t('kiosk.confirmLocation')} value={binding?.locationName ?? ''} />
              {selectedShift !== null ? (
                <SummaryRow
                  label={t('kiosk.confirmShift')}
                  value={formatShiftRange(
                    selectedShift.startsAt,
                    selectedShift.endsAt,
                    timezone,
                    policies.timeFormat,
                    language,
                  )}
                />
              ) : null}

              {closesOpenBreak(state, step.event) ? (
                <AppText variant="help" tone="warning">
                  {t('kiosk.closeOpenBreakBody')}
                </AppText>
              ) : null}

              {policies.photoEnabled ? (
                <AppText variant="help" tone="subtle">
                  {t('kiosk.photoNotice')}
                </AppText>
              ) : null}

              <ActionCountdown
                onComplete={() => void commitAction(step.event)}
                onCancel={() => setStep({ name: 'identify' })}
                testID="kiosk-confirm-countdown"
              />
            </Card>
          ) : null}

          {step.name === 'result' ? (
            <Card floating testID="kiosk-result">
              <Stack gap={spacing.md} style={styles.centered}>
                <Ionicons name="checkmark-circle" size={72} color={colors.success600} />
                <AppText variant="section" style={styles.centerText}>
                  {t(`kiosk.${resultKey(step.event)}`, {
                    time: formatClockTime(step.occurredAt, timezone, policies.timeFormat, language),
                  })}
                </AppText>
                {step.shiftEndsAt !== null ? (
                  <AppText variant="body" tone="muted" style={styles.centerText}>
                    {t('kiosk.shiftEndsAt', {
                      time: formatClockTime(
                        step.shiftEndsAt,
                        timezone,
                        policies.timeFormat,
                        language,
                      ),
                    })}
                  </AppText>
                ) : null}
                {step.offline ? (
                  <AppText variant="help" tone="warning" style={styles.centerText}>
                    {t('kiosk.savedOffline')}
                  </AppText>
                ) : null}
                <PrimaryButton label={t('common.done')} onPress={returnToIdle} testID="kiosk-result-done" />
              </Stack>
            </Card>
          ) : null}
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
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

function statusKey(state: 'OFF_SHIFT' | 'WORKING' | 'ON_BREAK'): 'OffShift' | 'Working' | 'OnBreak' {
  return state === 'WORKING' ? 'Working' : state === 'ON_BREAK' ? 'OnBreak' : 'OffShift';
}

function eventLabelKey(event: TimeEventType): 'clockIn' | 'clockOut' | 'startBreak' | 'endBreak' {
  switch (event) {
    case 'clock_in':
      return 'clockIn';
    case 'clock_out':
      return 'clockOut';
    case 'break_start':
      return 'startBreak';
    case 'break_end':
      return 'endBreak';
  }
}

function resultKey(
  event: TimeEventType,
): 'resultClockIn' | 'resultClockOut' | 'resultBreakStart' | 'resultBreakEnd' {
  switch (event) {
    case 'clock_in':
      return 'resultClockIn';
    case 'clock_out':
      return 'resultClockOut';
    case 'break_start':
      return 'resultBreakStart';
    case 'break_end':
      return 'resultBreakEnd';
  }
}

/** Se exporta para las pruebas del formateo de duración en curso. */
export const formatLiveDuration = minutesToHHmm;

const styles = StyleSheet.create({
  avatar: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: sizes.avatarLg / 2,
    backgroundColor: colors.primary500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: { flex: 1 },
  selected: { borderColor: colors.primary500, borderWidth: 2 },
  centered: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
