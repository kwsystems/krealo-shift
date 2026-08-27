import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { InlineNotice, LimitBar } from './fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import type { ShiftPublication } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import { formatDateKeyLong, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/** Herramientas del editor de horarios: navegación, avisos, totales e historial (§11.3). */

export function WeekNavigator({
  weekStart,
  language,
  isCurrentWeek,
  onPrevious,
  onNext,
  onGoToCurrent,
}: {
  weekStart: DateKey;
  language: SupportedLanguage;
  isCurrentWeek: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToCurrent: () => void;
}) {
  const { t } = useTranslation();
  const weekLabel = t('schedule.weekOf', { date: formatDateKeyLong(weekStart, language) });

  return (
    <Stack gap={spacing.sm}>
      <AppText variant="section" accessibilityRole="header">
        {weekLabel}
      </AppText>
      <Row gap={spacing.sm} wrap>
        <SecondaryButton
          label={t('schedule.previousWeek')}
          onPress={onPrevious}
          fullWidth={false}
          testID="week-previous"
        />
        <SecondaryButton
          label={t('schedule.nextWeek')}
          onPress={onNext}
          fullWidth={false}
          testID="week-next"
        />
        <GhostButton
          label={t('schedule.goToThisWeek')}
          onPress={onGoToCurrent}
          disabled={isCurrentWeek}
          fullWidth={false}
          testID="week-current"
        />
      </Row>
    </Stack>
  );
}

export function ScheduleWarnings({ warnings }: { warnings: ScheduleWarning[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;

  return (
    <Stack gap={spacing.sm}>
      {warnings.map((warning, index) => {
        if (warning.kind === 'overlap') {
          return (
            <InlineNotice
              key={`overlap-${warning.shiftIds.join('-')}-${index}`}
              tone="late"
              icon="alert-circle"
              title={t('schedule.overlapTitle')}
              body={t('schedule.overlapWarning', { name: warning.employeeName })}
            />
          );
        }
        if (warning.kind === 'shortRest') {
          return (
            <InlineNotice
              key={`rest-${warning.shiftIds.join('-')}-${index}`}
              tone="onBreak"
              icon="time-outline"
              title={t('schedule.shortRestTitle')}
              body={t('schedule.shortRestWarning', {
                hours: minutesToHHmm(warning.restMinutes),
              })}
            />
          );
        }
        return (
          <InlineNotice
            key={`weekly-${warning.employeeId}-${index}`}
            tone="onBreak"
            icon="trending-up-outline"
            title={t('schedule.weeklyLimitTitle')}
            body={t('schedule.weeklyLimitWarning', { name: warning.employeeName })}
          />
        );
      })}
    </Stack>
  );
}

export type EmployeeTotal = {
  employeeId: string;
  name: string;
  minutes: number;
};

/** §25 WeeklyHoursSummary: total por empleado y comparación con el límite (§11.3). */
export function WeeklyHoursSummary({
  totals,
  weeklyLimitMinutes,
  totalMinutes,
}: {
  totals: EmployeeTotal[];
  weeklyLimitMinutes: number;
  totalMinutes: number;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <AppText variant="bodyStrong">
        {t('schedule.totalWeeklyHours', { hours: minutesToHHmm(totalMinutes) })}
      </AppText>
      {totals.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('schedule.noShiftsThisWeek')}
        </AppText>
      ) : (
        <Stack gap={spacing.md}>
          {totals.map((total) => (
            <LimitBar
              key={total.employeeId}
              label={total.name}
              value={total.minutes}
              limit={weeklyLimitMinutes}
              valueLabel={
                weeklyLimitMinutes > 0
                  ? `${minutesToHHmm(total.minutes)} / ${minutesToHHmm(weeklyLimitMinutes)}`
                  : minutesToHHmm(total.minutes)
              }
              testID={`weekly-total-${total.employeeId}`}
            />
          ))}
        </Stack>
      )}
    </Card>
  );
}

export function PublicationHistory({
  publications,
  timezone,
  timeFormat,
  language,
}: {
  publications: ShiftPublication[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <AppText variant="bodyStrong">{t('schedule.publishHistory')}</AppText>
      {publications.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('schedule.noPublicationsYet')}
        </AppText>
      ) : (
        <View style={styles.history}>
          {publications.map((publication) => (
            <Row key={publication.id} justify="space-between" gap={spacing.md} align="flex-start">
              <AppText variant="help" tone="muted">
                {t('schedule.publicationVersion', { version: publication.publication_version })}
              </AppText>
              <AppText variant="help" tone="subtle" tabular>
                {`${formatClockTime(publication.published_at, timezone, timeFormat, language)} · ${t(
                  'schedule.publicationChanged',
                  { count: publication.changed_shift_ids.length },
                )}`}
              </AppText>
            </Row>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  history: { gap: spacing.sm },
});
