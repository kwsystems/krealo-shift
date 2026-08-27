import { useTranslation } from 'react-i18next';

import { useUpcomingShifts, type TeamMember } from './hooks';
import { AsyncSection } from '@/components/schedule/data-states';
import { AdminSheet, KeyValueRow } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { TimeEditRequest } from '@/features/requests/api';
import type { DailySummary } from '@/features/timesheets/api';
import type { SupportedLanguage } from '@/i18n';
import { formatDateKeyShort } from '@/features/schedules/week';
import { spacing } from '@/theme/tokens';
import { formatShiftRange, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/**
 * Ficha del empleado (§11.2): datos básicos, ubicaciones, puestos, estado,
 * próximos turnos y horas recientes.
 *
 * El PIN existente NO aparece aquí y no hay forma de consultarlo: solo se puede
 * generar uno nuevo, que se muestra una única vez.
 */
export function EmployeeDetailSheet({
  member,
  locationNames,
  jobRoleNames,
  recentSummaries,
  recentPending,
  recentError,
  requests,
  timezone,
  timeFormat,
  language,
  busy,
  onEdit,
  onToggleStatus,
  onResetPin,
  onClose,
}: {
  member: TeamMember;
  locationNames: Map<string, string>;
  jobRoleNames: Map<string, string>;
  recentSummaries: DailySummary[];
  recentPending: boolean;
  recentError: unknown;
  /** Solicitudes de esta persona, para no tener que buscarlas en otra pestaña. */
  requests: TimeEditRequest[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  busy: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  onResetPin: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upcoming = useUpcomingShifts(member.id);

  const statusLabel =
    member.status === 'active'
      ? t('team.statusActive')
      : member.status === 'inactive'
        ? t('team.statusInactive')
        : t('team.statusInvited');

  const recentMinutes = recentSummaries.reduce((total, day) => total + day.net_minutes, 0);

  return (
    <AdminSheet
      visible
      title={member.displayName}
      onClose={onClose}
      testID="employee-detail-sheet"
      footer={
        <Stack gap={spacing.sm}>
          <PrimaryButton
            label={t('team.resetPin')}
            hint={t('team.resetPinHint')}
            onPress={onResetPin}
            loading={busy}
            testID="employee-reset-pin"
          />
          <Row gap={spacing.sm} wrap>
            <SecondaryButton
              label={t('common.edit')}
              onPress={onEdit}
              fullWidth={false}
              testID="employee-edit"
            />
            {member.status === 'active' ? (
              <DangerButton
                label={t('team.deactivate')}
                hint={t('team.deactivateHint')}
                onPress={onToggleStatus}
                fullWidth={false}
                testID="employee-deactivate"
              />
            ) : (
              <SecondaryButton
                label={t('team.activate')}
                onPress={onToggleStatus}
                fullWidth={false}
                testID="employee-activate"
              />
            )}
          </Row>
        </Stack>
      }
    >
      <StatusBadge
        label={statusLabel}
        tone={member.status === 'active' ? 'working' : 'offShift'}
        icon={member.status === 'active' ? 'checkmark-circle' : 'pause-circle-outline'}
      />

      <Stack gap={spacing.xs}>
        <KeyValueRow label={t('team.fullName')} value={member.full_name} />
        {member.employee_number !== null ? (
          <KeyValueRow label={t('team.employeeNumber')} value={member.employee_number} />
        ) : null}
        <KeyValueRow label={t('team.emailOptional')} value={member.email ?? t('team.noEmail')} />
        <KeyValueRow
          label={t('team.locations')}
          value={
            member.locationIds.length === 0
              ? t('team.noLocations')
              : member.locationIds
                  .map((id) => locationNames.get(id) ?? '')
                  .filter((name) => name !== '')
                  .join(', ')
          }
        />
        <KeyValueRow
          label={t('team.jobRoles')}
          value={
            member.jobRoleIds.length === 0
              ? t('team.noJobRolesAssigned')
              : member.jobRoleIds
                  .map((id) => jobRoleNames.get(id) ?? '')
                  .filter((name) => name !== '')
                  .join(', ')
          }
        />
      </Stack>

      <AppText variant="bodyStrong">{t('team.upcomingShifts')}</AppText>
      <AsyncSection
        isPending={upcoming.isPending}
        error={upcoming.error}
        isEmpty={(upcoming.data ?? []).length === 0}
        emptyTitle={t('team.noUpcomingShifts')}
        onRetry={() => void upcoming.refetch()}
      >
        <Stack gap={spacing.xs}>
          {(upcoming.data ?? []).map((shift) => (
            <KeyValueRow
              key={shift.id}
              label={
                shift.status === 'draft'
                  ? `${t('schedule.statusDraft')} · ${locationNames.get(shift.location_id) ?? ''}`
                  : (locationNames.get(shift.location_id) ?? '')
              }
              value={formatShiftRange(
                shift.starts_at,
                shift.ends_at,
                timezone,
                timeFormat,
                language,
              )}
            />
          ))}
        </Stack>
      </AsyncSection>

      <AppText variant="bodyStrong">{t('team.recentHours')}</AppText>
      <AsyncSection
        isPending={recentPending}
        error={recentError}
        isEmpty={recentSummaries.length === 0}
        emptyTitle={t('timesheet.noEntries')}
      >
        <Stack gap={spacing.xs}>
          {recentSummaries.map((day) => (
            <KeyValueRow
              key={day.work_date}
              label={formatDateKeyShort(day.work_date, language)}
              value={minutesToHHmm(day.net_minutes)}
              tone={day.needs_review === true ? 'danger' : 'default'}
            />
          ))}
          <KeyValueRow label={t('timesheet.netHours')} value={minutesToHHmm(recentMinutes)} />
        </Stack>
      </AsyncSection>

      <AppText variant="bodyStrong">{t('requests.title')}</AppText>
      {requests.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('requests.noRequests')}
        </AppText>
      ) : (
        <Stack gap={spacing.xs}>
          {requests.map((request) => (
            <KeyValueRow
              key={request.id}
              label={
                request.target_date ?? formatDateKeyShort(request.created_at.slice(0, 10), language)
              }
              value={
                request.status === 'pending'
                  ? t('requests.statusPending')
                  : request.status === 'approved'
                    ? t('requests.statusApproved')
                    : t('requests.statusRejected')
              }
              tone={request.status === 'pending' ? 'danger' : 'default'}
            />
          ))}
        </Stack>
      )}
    </AdminSheet>
  );
}

/** El PIN temporal se muestra una sola vez y no se guarda en ningún sitio (§11.2). */
export function TemporaryPinSheet({
  pin,
  employeeName,
  onClose,
}: {
  pin: string;
  employeeName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AdminSheet
      visible
      title={t('team.resetPin')}
      onClose={onClose}
      testID="temporary-pin-sheet"
      footer={
        <PrimaryButton label={t('team.pinNoted')} onPress={onClose} testID="temporary-pin-close" />
      }
    >
      <AppText variant="bodyStrong">{employeeName}</AppText>
      <AppText variant="title" tabular accessibilityLabel={t('team.temporaryPin', { pin })}>
        {pin}
      </AppText>
      <AppText variant="help" tone="danger">
        {t('team.pinShownOnce')}
      </AppText>
    </AdminSheet>
  );
}
