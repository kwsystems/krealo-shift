import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { alertLabelKey } from './session-row';
import { FormField } from '@app/(auth)/sign-in';
import {
  AdminSheet,
  InlineNotice,
  KeyValueRow,
  SegmentedControl,
  SelectField,
  type Option,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { dateKeyOf, localTimeOf, shiftInstants } from '@/features/schedules/week';
import {
  readAdjustmentSide,
  type AdjustmentSide,
} from '@/features/timesheets/adjustment-summary';
import type { TimeAdjustment, TimeEvent, WorkSession } from '@/features/timesheets/api';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/**
 * Detalle diario y corrección de una sesión (§11.4).
 *
 * El motivo es obligatorio y el botón no se activa sin él: una corrección sin
 * motivo no se puede auditar, y la especificación exige conservar valor anterior,
 * valor nuevo, autor, fecha de servidor y motivo.
 *
 * Los eventos crudos se listan como historia, nunca como campos editables: son
 * append-only.
 */

const EVENT_LABEL_KEYS: Record<TimeEvent['event_type'], string> = {
  clock_in: 'attendance.eventClockIn',
  break_start: 'attendance.eventBreakStart',
  break_end: 'attendance.eventBreakEnd',
  clock_out: 'attendance.eventClockOut',
};

export function SessionDetailSheet({
  session,
  employeeName,
  events,
  adjustments,
  alerts,
  timezone,
  timeFormat,
  language,
  saving,
  conflict,
  onSubmitCorrection,
  onClose,
}: {
  session: WorkSession;
  employeeName: string;
  events: TimeEvent[];
  adjustments: TimeAdjustment[];
  alerts: TimesheetAlert[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  saving: boolean;
  conflict: boolean;
  onSubmitCorrection: (params: {
    newStartsAt: string | null;
    newEndsAt: string | null;
    reason: string;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const startDateKey = dateKeyOf(session.starts_at, timezone);
  const [startTime, setStartTime] = useState(localTimeOf(session.starts_at, timezone));
  const [endTime, setEndTime] = useState(
    session.ends_at === null ? '' : localTimeOf(session.ends_at, timezone),
  );
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const reasonValid = reason.trim().length >= 3;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!reasonValid) return;

    const instants = shiftInstants({
      dateKey: startDateKey,
      startTime,
      endTime: endTime.trim() === '' ? startTime : endTime,
      timezone,
    });
    if (instants === null) return;

    onSubmitCorrection({
      newStartsAt: instants.startsAt,
      newEndsAt: endTime.trim() === '' ? null : instants.endsAt,
      reason: reason.trim(),
    });
  };

  return (
    <AdminSheet
      visible
      title={t('timesheet.dailyDetail')}
      onClose={onClose}
      testID="session-detail-sheet"
      footer={
        <PrimaryButton
          label={t('timesheet.correctEntry')}
          onPress={handleSubmit}
          loading={saving}
          disabled={submitted && !reasonValid}
          testID="session-correct-submit"
        />
      }
    >
      <AppText variant="bodyStrong">{employeeName}</AppText>
      <KeyValueRow
        label={t('timesheet.period')}
        value={`${formatClockTime(session.starts_at, timezone, timeFormat, language)} – ${
          session.ends_at === null
            ? t('timesheet.stillOpen')
            : formatClockTime(session.ends_at, timezone, timeFormat, language)
        }`}
      />
      <KeyValueRow
        label={t('timesheet.netHours')}
        value={minutesToHHmm(session.net_minutes ?? 0)}
      />
      <KeyValueRow
        label={t('timesheet.breaks')}
        value={minutesToHHmm(session.unpaid_break_minutes + session.paid_break_minutes)}
      />

      {alerts.length > 0 ? (
        <Row gap={spacing.xs} wrap align="flex-start">
          {alerts.map((alert) => (
            <StatusBadge key={alert} label={t(alertLabelKey(alert))} tone="late" compact />
          ))}
        </Row>
      ) : null}

      <AppText variant="bodyStrong">{t('timesheet.rawEvents')}</AppText>
      {events.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('timesheet.noRawEvents')}
        </AppText>
      ) : (
        <Stack gap={spacing.xs}>
          {events.map((event) => (
            <KeyValueRow
              key={event.id}
              label={`${t(EVENT_LABEL_KEYS[event.event_type])}${
                event.is_offline ? ` · ${t('timesheet.fromOffline')}` : ''
              }`}
              value={formatClockTime(event.occurred_at, timezone, timeFormat, language)}
            />
          ))}
        </Stack>
      )}

      <AppText variant="bodyStrong">{t('timesheet.changeHistory')}</AppText>
      {adjustments.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('timesheet.noChanges')}
        </AppText>
      ) : (
        <Stack gap={spacing.md}>
          {adjustments.map((adjustment) => (
            <Stack key={adjustment.id} gap={spacing.xs}>
              <KeyValueRow
                label={`${formatClockTime(adjustment.created_at, timezone, timeFormat, language)} · ${adjustment.channel}`}
                value={adjustment.reason}
              />
              {/*
                QUÉ cambió, y no solo que algo cambió. Los dos valores ya venían en la
                consulta y no se pintaban: un motivo suelto —"corrección de salida"— no
                dice si fueron cinco minutos o cinco horas, que es lo único que se revisa
                en una auditoría. §11.4 pide ver el historial de cambios.
              */}
              <KeyValueRow
                label={t('timesheet.previousValue')}
                value={describeSide(readAdjustmentSide(adjustment.before_value), {
                  t,
                  timezone,
                  timeFormat,
                  language,
                })}
              />
              <KeyValueRow
                label={t('timesheet.newValue')}
                value={describeSide(readAdjustmentSide(adjustment.after_value), {
                  t,
                  timezone,
                  timeFormat,
                  language,
                })}
              />
            </Stack>
          ))}
        </Stack>
      )}

      {conflict ? (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          title={t('states.conflictTitle')}
          body={t('errors.concurrentEdit')}
        />
      ) : null}

      <AppText variant="bodyStrong">{t('timesheet.correctEntry')}</AppText>
      <Row gap={spacing.md} align="flex-start">
        <FormField
          label={t('timesheet.newStart')}
          value={startTime}
          onChangeText={setStartTime}
          keyboardType="numbers-and-punctuation"
          placeholder="09:00"
          testID="session-correct-start"
        />
        <FormField
          label={t('timesheet.newEnd')}
          value={endTime}
          onChangeText={setEndTime}
          keyboardType="numbers-and-punctuation"
          placeholder="17:00"
          testID="session-correct-end"
        />
      </Row>
      <FormField
        label={t('timesheet.reasonLabel')}
        value={reason}
        onChangeText={setReason}
        multiline
        error={submitted && !reasonValid ? t('timesheet.reasonRequired') : undefined}
        testID="session-correct-reason"
      />
    </AdminSheet>
  );
}

/**
 * Fichaje manual del gerente (§11.4).
 *
 * Queda como solicitud auditable con motivo obligatorio: la app no puede crear
 * eventos crudos, que son append-only y solo los escribe el servidor.
 */
export function ManualEntrySheet({
  employees,
  dateKey,
  saving,
  onSubmit,
  onClose,
}: {
  employees: Option<string>[];
  dateKey: string;
  saving: boolean;
  onSubmit: (params: {
    employeeId: string;
    kind: 'forgot_clock_in' | 'forgot_clock_out' | 'correction';
    time: string;
    reason: string;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(employees[0]?.value ?? null);
  const [kind, setKind] = useState<'forgot_clock_in' | 'forgot_clock_out' | 'correction'>(
    'forgot_clock_in',
  );
  const [time, setTime] = useState('09:00');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const reasonValid = reason.trim().length >= 3;
  const canSubmit = employeeId !== null && reasonValid;

  return (
    <AdminSheet
      visible
      title={t('timesheet.addManualEntry')}
      onClose={onClose}
      testID="manual-entry-sheet"
      footer={
        <PrimaryButton
          label={t('timesheet.sendManualEntry')}
          onPress={() => {
            setSubmitted(true);
            if (!canSubmit || employeeId === null) return;
            onSubmit({ employeeId, kind, time, reason: reason.trim() });
          }}
          loading={saving}
          disabled={submitted && !canSubmit}
          testID="manual-entry-submit"
        />
      }
    >
      <InlineNotice
        tone="info"
        icon="document-text-outline"
        title={t('timesheet.manualEntryNoticeTitle')}
        body={t('timesheet.manualEntryNoticeBody')}
      />

      <SegmentedControl
        label={t('timesheet.manualEntryKind')}
        value={kind}
        options={[
          { value: 'forgot_clock_in', label: t('kiosk.forgotClockIn') },
          { value: 'forgot_clock_out', label: t('kiosk.forgotClockOut') },
          { value: 'correction', label: t('requests.tabTimeCorrections') },
        ]}
        onChange={setKind}
        testID="manual-entry-kind"
      />

      <SelectField
        label={t('schedule.employee')}
        value={employeeId}
        options={employees}
        onChange={setEmployeeId}
        emptyLabel={t('team.noEmployeesForLocation')}
        testID="manual-entry-employee"
      />

      <KeyValueRow label={t('schedule.date')} value={dateKey} />

      <FormField
        label={t('kiosk.forgotProposedTime')}
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
        placeholder="09:00"
        testID="manual-entry-time"
      />

      <FormField
        label={t('timesheet.reasonLabel')}
        value={reason}
        onChangeText={setReason}
        multiline
        error={submitted && !reasonValid ? t('timesheet.reasonRequired') : undefined}
        testID="manual-entry-reason"
      />
    </AdminSheet>
  );
}

/**
 * Un lado de la corrección, en una línea legible.
 *
 * La forma la decide `readAdjustmentSide`; aquí solo se traduce. Se separa porque una
 * forma desconocida tiene que decirse —no adivinarse ni romper la pantalla— y eso es
 * una decisión de presentación, no de datos.
 */
function describeSide(
  side: AdjustmentSide,
  ctx: {
    t: TFunction;
    timezone: string;
    timeFormat: TimeFormatPreference;
    language: SupportedLanguage;
  },
): string {
  const hora = (iso: string | null) =>
    iso === null ? '—' : formatClockTime(iso, ctx.timezone, ctx.timeFormat, ctx.language);

  switch (side.kind) {
    case 'absent':
      return ctx.t('timesheet.valueDidNotExist');
    case 'session': {
      const neto =
        side.netMinutes === null ? '' : ` · ${minutesToHHmm(side.netMinutes)}`;
      return `${hora(side.startsAt)} – ${hora(side.endsAt)}${neto}`;
    }
    case 'event': {
      const etiqueta = EVENT_LABEL_KEYS[side.eventType as TimeEvent['event_type']];
      const nombre =
        etiqueta === undefined ? side.eventType : ctx.t(etiqueta);
      return `${nombre} · ${hora(side.occurredAt)}`;
    }
    default:
      return ctx.t('timesheet.valueUnknownShape');
  }
}
