import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyShiftSlot, ShiftCard } from './shift-card';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import type { ShiftRow } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import { formatDateKeyShort, formatDayColumn, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { borderWidth, colors, radii, spacing } from '@/theme/tokens';
import { minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/**
 * Vistas del editor de horarios (§11.3).
 *
 * En iPad: empleados en filas y días en columnas. En iPhone: tarjetas por día.
 * Nunca una tabla de escritorio comprimida en un teléfono (§33).
 */

/** Anchos derivados de la escala de espaciado, no números sueltos (§5). */
const DAY_COLUMN_WIDTH = spacing.huge * 3;
const NAME_COLUMN_WIDTH = spacing.huge * 3.5;

/**
 * Turno con su fecha local ya calculada, para no repetir la conversión de zona
 * horaria en cada celda de la cuadrícula.
 */
export type DatedShift = ShiftRow & { dateKey: DateKey };

export type EmployeeRow = {
  employeeId: string;
  name: string;
  shifts: DatedShift[];
  scheduledMinutes: number;
};

export type GridProps = {
  days: DateKey[];
  rows: EmployeeRow[];
  todayKey: DateKey;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  jobRoleNames: Map<string, string>;
  warningsFor: (shiftId: string) => ScheduleWarning[];
  onSelectShift: (shift: ShiftRow) => void;
  onAddShift: (params: { employeeId: string; dateKey: DateKey }) => void;
  readOnly?: boolean;
};

export function WeekGrid({
  days,
  rows,
  todayKey,
  timezone,
  timeFormat,
  language,
  jobRoleNames,
  warningsFor,
  onSelectShift,
  onAddShift,
  readOnly = false,
}: GridProps) {
  const { t } = useTranslation();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.grid}>
      <View>
        <Row gap={0} align="stretch">
          <View style={[styles.headerCell, styles.nameColumn]}>
            <AppText variant="label" tone="subtle">
              {t('schedule.employee')}
            </AppText>
          </View>
          {days.map((day) => (
            <View
              key={day}
              style={[
                styles.headerCell,
                styles.dayColumn,
                day === todayKey ? styles.todayColumn : null,
              ]}
            >
              <AppText variant="label" tone={day === todayKey ? 'primary' : 'subtle'}>
                {formatDayColumn(day, language)}
              </AppText>
            </View>
          ))}
        </Row>

        {rows.map((row) => (
          <Row key={row.employeeId} gap={0} align="stretch">
            <View style={[styles.cell, styles.nameColumn]}>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {row.name}
              </AppText>
              <AppText variant="label" tone="subtle" tabular>
                {minutesToHHmm(row.scheduledMinutes)}
              </AppText>
            </View>

            {days.map((day) => {
              const dayShifts = row.shifts.filter((shift) => shift.dateKey === day);
              return (
                <View
                  key={`${row.employeeId}-${day}`}
                  style={[
                    styles.cell,
                    styles.dayColumn,
                    day === todayKey ? styles.todayColumn : null,
                  ]}
                >
                  <Stack gap={spacing.xs}>
                    {dayShifts.map((shift) => (
                      <ShiftCard
                        key={shift.id}
                        shift={shift}
                        timezone={timezone}
                        timeFormat={timeFormat}
                        jobRoleName={
                          shift.job_role_id === null
                            ? null
                            : (jobRoleNames.get(shift.job_role_id) ?? null)
                        }
                        warnings={warningsFor(shift.id)}
                        onPress={readOnly ? undefined : onSelectShift}
                        testID={`shift-${shift.id}`}
                      />
                    ))}
                    {readOnly ? null : (
                      <EmptyShiftSlot
                        onPress={() => onAddShift({ employeeId: row.employeeId, dateKey: day })}
                        accessibilityLabel={t('schedule.addShiftFor', {
                          name: row.name,
                          date: formatDateKeyShort(day, language),
                        })}
                        testID={`add-shift-${row.employeeId}-${day}`}
                      />
                    )}
                  </Stack>
                </View>
              );
            })}
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

export type DayListProps = {
  days: DateKey[];
  shiftsByDay: Map<DateKey, DatedShift[]>;
  employeeNames: Map<string, string>;
  jobRoleNames: Map<string, string>;
  todayKey: DateKey;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  warningsFor: (shiftId: string) => ScheduleWarning[];
  onSelectShift: (shift: ShiftRow) => void;
  onAddShift: (params: { dateKey: DateKey }) => void;
  readOnly?: boolean;
};

export function DayList({
  days,
  shiftsByDay,
  employeeNames,
  jobRoleNames,
  todayKey,
  timezone,
  timeFormat,
  language,
  warningsFor,
  onSelectShift,
  onAddShift,
  readOnly = false,
}: DayListProps) {
  const { t } = useTranslation();

  return (
    <Stack gap={spacing.base}>
      {days.map((day) => {
        const dayShifts = shiftsByDay.get(day) ?? [];
        return (
          <View key={day} style={styles.dayBlock}>
            <Row justify="space-between">
              <AppText variant="bodyStrong" tone={day === todayKey ? 'primary' : 'default'}>
                {formatDayColumn(day, language)}
              </AppText>
              <AppText variant="label" tone="subtle" tabular>
                {t('schedule.shiftsCount', { count: dayShifts.length })}
              </AppText>
            </Row>

            {dayShifts.length === 0 ? (
              <AppText variant="help" tone="subtle">
                {t('schedule.noShiftsThatDay')}
              </AppText>
            ) : (
              <Stack gap={spacing.sm}>
                {dayShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    showEmployeeName
                    employeeName={employeeNames.get(shift.employee_id) ?? ''}
                    jobRoleName={
                      shift.job_role_id === null
                        ? null
                        : (jobRoleNames.get(shift.job_role_id) ?? null)
                    }
                    timezone={timezone}
                    timeFormat={timeFormat}
                    warnings={warningsFor(shift.id)}
                    onPress={readOnly ? undefined : onSelectShift}
                    testID={`shift-${shift.id}`}
                  />
                ))}
              </Stack>
            )}

            {readOnly ? null : (
              <EmptyShiftSlot
                onPress={() => onAddShift({ dateKey: day })}
                accessibilityLabel={t('schedule.addShiftOn', {
                  date: formatDateKeyShort(day, language),
                })}
                testID={`add-shift-${day}`}
              />
            )}
          </View>
        );
      })}
    </Stack>
  );
}

const styles = StyleSheet.create({
  grid: { paddingBottom: spacing.sm },
  headerCell: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    justifyContent: 'center',
  },
  cell: {
    padding: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  nameColumn: { width: NAME_COLUMN_WIDTH },
  dayColumn: { width: DAY_COLUMN_WIDTH },
  todayColumn: { backgroundColor: colors.primary50 },
  dayBlock: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.base,
  },
});
