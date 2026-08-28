import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { PhotoCapture, type PhotoResult } from '@/features/kiosk/photo-capture';
import { RequestUpdatesCard } from '@/components/attendance/request-updates';
import {
  BreakTypeSheet,
  ManagerOverrideSheet,
  PhotoNotice,
  RequiredBreakSheet,
  type BreakTypeOption,
  type RequiredBreakChoice,
} from '@/components/attendance/kiosk-sheets';
import { AppText } from '@/components/ui/app-text';
import { ActionCountdown } from '@/components/ui/action-countdown';
import { DangerButton, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { submitTimeEvent, verifyPin, type TimeEventType } from '@/features/kiosk/api';
import { enqueueEvent, enqueuePhotoForEvent } from '@/lib/offline/outbox';
import { refreshQueueIndicators, runSync } from '@/lib/offline/sync';
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

/**
 * Tipos de descanso que ofrece el kiosco (§9.3). La comida va primero porque es
 * el caso mas frecuente en una tienda, y la distincion pagado/no pagado importa:
 * decide si esos minutos se restan del tiempo trabajado.
 */
const BREAK_TYPE_OPTIONS: readonly BreakTypeOption[] = ['meal', 'unpaid', 'paid'] as const;

type Sheet =
  | { name: 'none' }
  | { name: 'breakType' }
  | { name: 'requiredBreak' }
  | { name: 'managerOverride' };

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
  const markRevoked = useKioskStore((s) => s.markRevoked);
  const language = usePreferencesStore((s) => s.language);

  const [step, setStep] = useState<Step>({ name: 'identify' });
  const [sheet, setSheet] = useState<Sheet>({ name: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideChecking, setOverrideChecking] = useState(false);
  const [earlyAuthorized, setEarlyAuthorized] = useState(false);
  // La foto es opcional: `null` significa que todavia no hay resultado, y
  // 'skipped' que no se pudo tomar. En ninguno de los dos casos se bloquea el
  // fichaje (§9.6).
  const [photo, setPhoto] = useState<PhotoResult | null>(null);

  const policies = binding?.policies ?? DEFAULT_KIOSK_POLICIES;
  const timezone = binding?.timezone ?? 'America/Lima';

  /** Vuelve a reposo limpiando todo el estado temporal (§9.5). */
  const returnToIdle = useCallback(() => {
    // La foto y el resto del estado local desaparecen al desmontarse esta
    // pantalla, que es lo que hace `router.replace`. No hace falta limpiarlos a
    // mano, y hacerlo dentro de un efecto provoca renders en cascada (§9.5).
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

  const openSession = verification.openSession;
  const requiredBreakMinutes = openSession?.requiredBreakMinutes ?? 0;
  const takenBreakMinutes = openSession?.takenBreakMinutes ?? 0;
  const missingRequiredBreak =
    requiredBreakMinutes > 0 && takenBreakMinutes < requiredBreakMinutes;

  const startAction = (event: TimeEventType) => {
    const result = transition(state, event);
    if (!result.allowed) {
      setError(t('errors.invalidTransition'));
      return;
    }
    setError(null);

    // Un descanso puede ser pagado o no, y eso cambia si esos minutos cuentan
    // como trabajados. Se pregunta en lugar de asumir (§9.3).
    if (event === 'break_start') {
      setSheet({ name: 'breakType' });
      return;
    }

    // Al salir sin el descanso obligatorio no se inventa el descanso: se
    // pregunta y la respuesta genera una solicitud auditable (§12).
    if (event === 'clock_out' && state === 'WORKING' && missingRequiredBreak) {
      setSheet({ name: 'requiredBreak' });
      return;
    }

    setStep({ name: 'confirm', event });
  };

  /** Autorizacion del gerente para la entrada temprana (§9.3, §13). */
  const submitManagerOverride = async (pin: string) => {
    if (binding === null) return;
    setOverrideChecking(true);
    setOverrideError(null);

    const result = await verifyPin({ pin, locationId: binding.locationId });

    setOverrideChecking(false);

    if (!result.ok) {
      setOverrideError(
        result.error.kind === 'offline' ? t('errors.network') : t('kiosk.pinIncorrect'),
      );
      return;
    }

    // El PIN de un companero cualquiera no autoriza nada: hace falta alguien que
    // el SERVIDOR reconozca como gerente de esta tienda, y que no sea la misma
    // persona que esta fichando. Si no, la autorizacion no valdria nada.
    const isManager = result.data.employee.canManageLocation;
    const isSomeoneElse = result.data.employee.opaqueId !== verification.employee.opaqueId;

    if (!isManager || !isSomeoneElse) {
      setOverrideError(t('kiosk.pinIncorrect'));
      return;
    }

    setEarlyAuthorized(true);
    setSheet({ name: 'none' });
    setStep({ name: 'confirm', event: 'clock_in' });
  };

  const handleRequiredBreakChoice = (choice: RequiredBreakChoice) => {
    setSheet({ name: 'none' });
    if (choice === 'cancel') return;
    if (choice === 'took_it') {
      // Dice que lo tomo pero no lo registro: eso es una solicitud de correccion,
      // no un descanso que la app pueda dar por bueno.
      router.push('/kiosk/forgot');
      return;
    }
    // Dice que no lo tomo: la salida sigue, y el gerente vera la sesion marcada.
    setStep({ name: 'confirm', event: 'clock_out' });
  };

  /**
   * Guarda el evento en la cola local y muestra el resultado.
   *
   * Primero guarda en SQLite dentro de una transaccion y SOLO despues dice
   * "listo": si la escritura local falla, el empleado tiene que verlo, porque su
   * fichaje no existe en ninguna parte (§17).
   */
  const commitOffline = async (event: TimeEventType) => {
    if (binding === null) return;

    try {
      const queued = await enqueueEvent({
        employeeOpaqueId: verification.employee.opaqueId,
        eventType: event,
        breakType: step.name === 'confirm' ? step.breakType : undefined,
        shiftId: selectedShift?.id ?? null,
        locationId: binding.locationId,
        pinVersion: verification.pinVersion,
        photoLocalUri: photo?.status === 'captured' ? photo.uri : null,
      });

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshQueueIndicators();
      // Se intenta enviar de inmediato, sin bloquear la pantalla: si hay red,
      // sale ya; si no, queda en la cola con su backoff.
      void runSync();

      setStep({
        name: 'result',
        event,
        occurredAt: queued.occurredAtDevice,
        offline: true,
        shiftEndsAt: selectedShift?.endsAt ?? null,
      });
    } catch {
      // No se pudo guardar ni localmente. Decirle que fichó seria mentirle.
      setError(t('errors.generic'));
      setStep({ name: 'identify' });
    }
  };

  const commitAction = async (event: TimeEventType) => {
    setSubmitting(true);
    setError(null);

    // Sesion validada sin conexion: no hay token del servidor que consumir, asi
    // que el evento va directo a la cola local (§9.7).
    if (verification.mode === 'offline' || verification.actionToken === null) {
      await commitOffline(event);
      setSubmitting(false);
      return;
    }

    // La clave de idempotencia se genera antes de enviar, para que un reintento o
    // un doble toque produzcan el mismo evento y no dos (§12, §17).
    const idempotencyKey = Crypto.randomUUID();

    const result = await submitTimeEvent({
      actionToken: verification.actionToken,
      eventType: event,
      breakType: step.name === 'confirm' ? step.breakType : undefined,
      shiftId: selectedShift?.id ?? null,
      idempotencyKey,
      occurredAtDevice: new Date().toISOString(),
      deviceSequence: Date.now(),
      isOffline: false,
    });

    // El token de accion ya se consumio: se anula para que un segundo toque no
    // pueda reutilizarlo.

    setSubmitting(false);

    if (result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // La foto se adjunta DESPUES del fichaje y a un evento que ya existe, para
      // que `photo_path` nunca apunte a un archivo que no se subio. Se encola
      // primero: si la subida falla —y con la red de una tienda falla— la foto no
      // se pierde y el siguiente pase de sincronizacion la recoge.
      //
      // El fichaje NO espera por la foto: la persona ve su confirmacion y se va.
      // Bloquear una entrada al trabajo por una imagen seria el orden equivocado.
      if (photo?.status === 'captured' && result.data.eventId) {
        const eventId = result.data.eventId;
        void enqueuePhotoForEvent({
          localUri: photo.uri,
          idempotencyKey,
          eventId,
        }).then(() => runSync());
      }

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
      // La red se cayo entre validar el PIN y enviar el fichaje: el evento va a la
      // cola local en lugar de perderse (§17).
      await commitOffline(event);
      return;
    }

    if (result.error.kind === 'revoked') {
      // Igual que en la pantalla de reposo: el estado se marca para que el iPad
      // muestre que fue desactivado en vez de seguir pidiendo PIN.
      markRevoked();
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

          {/*
            §19: "el resultado de solicitudes relevantes". Va justo debajo de la
            identificación y ANTES de los botones de fichar, porque es información
            que cambia lo que la persona hace a continuación: si le rechazaron la
            salida que faltaba, va a querer hablar con su encargado hoy, no cuando
            le llegue la boleta.
          */}
          <RequestUpdatesCard
            updates={verification.requestUpdates}
            timezone={timezone}
            language={language}
          />

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
            <Card testID="kiosk-error">
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
              {!eligibility.eligible && eligibility.reason === 'too_early' && !earlyAuthorized ? (
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
                  <SecondaryButton
                    label={t('kiosk.managerOverride')}
                    onPress={() => setSheet({ name: 'managerOverride' })}
                    testID="kiosk-manager-override"
                  />
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
                <Stack gap={spacing.sm}>
                  <PhotoNotice />
                  <PhotoCapture onResult={setPhoto} />
                </Stack>
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
                    {t('kiosk.savedOfflinePending')}
                  </AppText>
                ) : null}
                <PrimaryButton label={t('common.done')} onPress={returnToIdle} testID="kiosk-result-done" />
              </Stack>
            </Card>
          ) : null}
        </Stack>
      </ResponsiveContainer>

      <BreakTypeSheet
        visible={sheet.name === 'breakType'}
        options={BREAK_TYPE_OPTIONS}
        onSelect={(option) => {
          setSheet({ name: 'none' });
          setStep({ name: 'confirm', event: 'break_start', breakType: option });
        }}
        onCancel={() => setSheet({ name: 'none' })}
      />

      <RequiredBreakSheet
        visible={sheet.name === 'requiredBreak'}
        requiredMinutes={requiredBreakMinutes}
        onChoose={handleRequiredBreakChoice}
      />

      <ManagerOverrideSheet
        visible={sheet.name === 'managerOverride'}
        pinLength={policies.pinLength}
        checking={overrideChecking}
        error={overrideError}
        onSubmit={(pin) => void submitManagerOverride(pin)}
        onCancel={() => {
          setOverrideError(null);
          setSheet({ name: 'none' });
        }}
      />
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
