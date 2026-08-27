import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ShiftInput, ShiftRow } from './api';
import {
  analyzeWeek,
  toScheduledShifts,
  useScheduleMutations,
  usePublications,
  useWeekShifts,
} from './hooks';
import { warningsForShift } from './conflicts';
import { ShiftFormSheet, emptyShiftValues, type ShiftFormValues } from './shift-form';
import {
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  localTimeOf,
  weekDays,
  weekPosition,
  type DateKey,
} from './week';
import { AsyncSection } from '@/components/schedule/data-states';
import {
  AdminSheet,
  Chip,
  InlineNotice,
  SegmentedControl,
  SelectField,
  type Option,
} from '@/components/schedule/fields';
import {
  DayList,
  WeekGrid,
  type DatedShift,
  type EmployeeRow,
} from '@/components/schedule/week-grid';
import {
  PublicationHistory,
  ScheduleWarnings,
  WeekNavigator,
  WeeklyHoursSummary,
} from '@/components/schedule/week-tools';
import { ConfirmSheet } from '@/components/attendance/kiosk-sheets';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { useEmployeeNames, useJobRoles, useTeam } from '@/features/team/hooks';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * Editor de horarios semanales (§11.3): la función principal del panel.
 *
 * Lo que hace que sea usable cada semana sin ayuda técnica:
 *   - navegar semanas y volver a la actual de un toque;
 *   - copiar la semana anterior completa o solo de un empleado;
 *   - crear, editar, duplicar y eliminar tocando el turno;
 *   - ver conflictos ANTES de publicar;
 *   - guardar borrador automáticamente y publicar cuando se decide;
 *   - saber qué cambió y qué se publicó, con historial.
 */

type EditingState =
  | { mode: 'create'; values: ShiftFormValues }
  | { mode: 'edit'; shift: ShiftRow; values: ShiftFormValues };

export function ScheduleScreen({ onGoToTeam }: { onGoToTeam?: () => void }) {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const { isWide } = useResponsive();
  const now = useLiveClock('minute');
  const language = currentLanguage();

  const [weekOffset, setWeekOffset] = useState(0);
  const [view, setView] = useState<'week' | 'day'>('week');
  const [chosenDay, setChosenDay] = useState<DateKey | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyEmployeeId, setCopyEmployeeId] = useState<string | null>(null);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[] | null>(null);
  const [removingShift, setRemovingShift] = useState<ShiftRow | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const nowISO = now.toISOString();
  const thisWeekStart = currentWeekStart(nowISO, scope.weekStartsOn, scope.timezone);
  const weekStart = addWeeks(thisWeekStart, weekOffset);
  // Sin `useMemo`: son siete cadenas y el compilador de React no puede probar que
  // `weekStart` sea estable, así que memorizarlo aquí solo añadiría ruido.
  const days = weekDays(weekStart);
  const todayKey = dateKeyOf(nowISO, scope.timezone);

  const position = weekPosition(weekStart, nowISO, scope.weekStartsOn, scope.timezone);
  // Corregir una semana pasada es solo para administradores, con advertencia
  // visible y auditoría del servidor (§11.3).
  const readOnly = position === 'past' && !scope.isAdmin;

  const shiftsQuery = useWeekShifts({
    locationId: scope.locationId,
    weekStart,
    timezone: scope.timezone,
  });
  const publications = usePublications({ locationId: scope.locationId, weekStart });
  const names = useEmployeeNames(scope.organization?.id ?? null);
  const jobRolesQuery = useJobRoles(scope.organization?.id ?? null);
  const team = useTeam({
    organizationId: scope.organization?.id ?? null,
    locationIds: scope.locationId === null ? [] : [scope.locationId],
  });

  const mutations = useScheduleMutations({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    timezone: scope.timezone,
    weekStart,
  });

  const rows = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data]);

  const datedShifts = useMemo<DatedShift[]>(
    () => rows.map((row) => ({ ...row, dateKey: dateKeyOf(row.starts_at, scope.timezone) })),
    [rows, scope.timezone],
  );

  const analysis = useMemo(
    () =>
      analyzeWeek({
        shifts: toScheduledShifts(rows, names),
        minimumRestMinutes: scope.settings.minimumRestMinutes,
        weeklyLimitMinutes: scope.settings.weeklyOvertimeThresholdMinutes,
      }),
    [rows, names, scope.settings.minimumRestMinutes, scope.settings.weeklyOvertimeThresholdMinutes],
  );

  const locationMembers = useMemo(
    () =>
      team.members.filter(
        (member) =>
          scope.locationId !== null &&
          member.locationIds.includes(scope.locationId) &&
          member.status !== 'inactive',
      ),
    [team.members, scope.locationId],
  );

  const employeeOptions = useMemo<Option<string>[]>(
    () => locationMembers.map((member) => ({ value: member.id, label: member.displayName })),
    [locationMembers],
  );

  const jobRoleOptions = useMemo<Option<string>[]>(
    () =>
      (jobRolesQuery.data ?? [])
        .filter((role) => role.is_active)
        .map((role) => ({ value: role.id, label: role.name })),
    [jobRolesQuery.data],
  );

  const jobRoleNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of jobRolesQuery.data ?? []) map.set(role.id, role.name);
    return map;
  }, [jobRolesQuery.data]);

  const gridRows = useMemo<EmployeeRow[]>(() => {
    const byEmployee = new Map<string, DatedShift[]>();
    for (const shift of datedShifts) {
      const current = byEmployee.get(shift.employee_id) ?? [];
      current.push(shift);
      byEmployee.set(shift.employee_id, current);
    }

    const ids = new Set<string>([
      ...locationMembers.map((member) => member.id),
      ...byEmployee.keys(),
    ]);

    return [...ids]
      .map((employeeId) => ({
        employeeId,
        name: names.get(employeeId) ?? t('team.unknownEmployee'),
        shifts: byEmployee.get(employeeId) ?? [],
        scheduledMinutes: analysis.minutesByEmployee.get(employeeId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [datedShifts, locationMembers, names, analysis.minutesByEmployee, t]);

  // Se agrupa por la fecha de cada turno; los días sin turnos no necesitan entrada
  // porque la lista consulta con `?? []` y muestra su estado vacío.
  const shiftsByDay = useMemo(() => {
    const map = new Map<DateKey, DatedShift[]>();
    for (const shift of datedShifts) {
      const current = map.get(shift.dateKey);
      if (current === undefined) map.set(shift.dateKey, [shift]);
      else current.push(shift);
    }
    return map;
  }, [datedShifts]);

  const selectedDay =
    chosenDay !== null && days.includes(chosenDay)
      ? chosenDay
      : days.includes(todayKey)
        ? todayKey
        : (days[0] ?? weekStart);

  const totals = useMemo(
    () =>
      gridRows
        .filter((row) => row.scheduledMinutes > 0)
        .map((row) => ({
          employeeId: row.employeeId,
          name: row.name,
          minutes: row.scheduledMinutes,
        }))
        .sort((a, b) => b.minutes - a.minutes),
    [gridRows],
  );

  const pendingIds = analysis.pendingShiftIds;
  const pickedForPublish = pickedIds ?? pendingIds;

  const openCreate = (params: { employeeId?: string; dateKey: DateKey }) => {
    setEditing({
      mode: 'create',
      values: emptyShiftValues(params.dateKey, params.employeeId ?? null),
    });
  };

  const openEdit = (shift: ShiftRow) => {
    setEditing({
      mode: 'edit',
      shift,
      values: {
        employeeId: shift.employee_id,
        jobRoleId: shift.job_role_id,
        dateKey: dateKeyOf(shift.starts_at, scope.timezone),
        startTime: localTimeOf(shift.starts_at, scope.timezone),
        endTime: localTimeOf(shift.ends_at, scope.timezone),
        breakMinutes: String(shift.planned_unpaid_break_minutes),
        employeeNote: shift.employee_note ?? '',
        managerNote: shift.manager_note ?? '',
      },
    });
  };

  const submitShift = (input: ShiftInput) => {
    if (editing === null) return;

    const done = () => {
      setEditing(null);
      setFeedback(t('schedule.draftSaved'));
    };

    if (editing.mode === 'create') {
      mutations.create.mutate(input, { onSuccess: done });
      return;
    }
    mutations.update.mutate({ shiftId: editing.shift.id, input }, { onSuccess: done });
  };

  const locationOptions: Option<string>[] = scope.locations.map((location) => ({
    value: location.id,
    label: location.name,
    hint: location.is_active ? undefined : t('settings.locationInactive'),
  }));

  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer width={isWide ? 'full' : 'content'}>
        <Stack gap={spacing.lg}>
          <AppText variant="title" accessibilityRole="header">
            {t('schedule.title')}
          </AppText>

          <AsyncSection
            isPending={scope.isLoading}
            error={scope.error}
            isEmpty={scope.locations.length === 0}
            emptyTitle={t('settings.noLocations')}
            emptyBody={t('settings.noLocationsHint')}
            onRetry={scope.refetch}
          >
            <Stack gap={spacing.lg}>
              {scope.locations.length > 1 ? (
                <SelectField
                  label={t('schedule.location')}
                  value={scope.locationId}
                  options={locationOptions}
                  onChange={scope.setLocationId}
                  testID="schedule-location"
                />
              ) : null}

              <WeekNavigator
                weekStart={weekStart}
                language={language}
                isCurrentWeek={weekOffset === 0}
                onPrevious={() => setWeekOffset((current) => current - 1)}
                onNext={() => setWeekOffset((current) => current + 1)}
                onGoToCurrent={() => setWeekOffset(0)}
              />

              {position === 'past' ? (
                <InlineNotice
                  tone="late"
                  icon="warning-outline"
                  title={t('schedule.retroactiveTitle')}
                  body={
                    readOnly ? t('schedule.retroactiveReadOnly') : t('schedule.retroactiveWarning')
                  }
                />
              ) : null}

              <SegmentedControl
                label={t('schedule.viewLabel')}
                value={view}
                options={[
                  { value: 'week', label: t('schedule.viewWeek') },
                  { value: 'day', label: t('schedule.viewDay') },
                ]}
                onChange={setView}
                testID="schedule-view"
              />

              {readOnly ? null : (
                <Row gap={spacing.sm} wrap>
                  <SecondaryButton
                    label={t('schedule.copyPreviousWeek')}
                    onPress={() => setCopyOpen(true)}
                    fullWidth={false}
                    testID="schedule-copy-week"
                  />
                  <SecondaryButton
                    label={t('schedule.addShift')}
                    onPress={() => openCreate({ dateKey: selectedDay })}
                    fullWidth={false}
                    testID="schedule-add-shift"
                  />
                </Row>
              )}

              {feedback !== null ? (
                <InlineNotice tone="working" icon="checkmark-circle" title={feedback} />
              ) : null}

              {pendingIds.length > 0 && !readOnly ? (
                <Card>
                  <AppText variant="bodyStrong">
                    {t('schedule.pendingChanges', { count: pendingIds.length })}
                  </AppText>
                  <AppText variant="help" tone="subtle">
                    {t('schedule.pendingChangesHint')}
                  </AppText>
                  <Row gap={spacing.sm} wrap>
                    <PrimaryButton
                      label={t('schedule.publish')}
                      onPress={() => setPublishAllOpen(true)}
                      fullWidth={false}
                      loading={mutations.publish.isPending}
                      testID="schedule-publish-all"
                    />
                    <SecondaryButton
                      label={t('schedule.publishChangesOnly')}
                      onPress={() => {
                        setPickedIds(pendingIds);
                        setPublishPickerOpen(true);
                      }}
                      fullWidth={false}
                      testID="schedule-publish-some"
                    />
                  </Row>
                </Card>
              ) : null}

              <ScheduleWarnings warnings={analysis.warnings} />

              <AsyncSection
                isPending={shiftsQuery.isPending || team.isPending}
                error={shiftsQuery.error ?? team.error}
                isEmpty={gridRows.length === 0}
                emptyTitle={t('team.noEmployees')}
                emptyBody={t('team.noEmployeesHint')}
                emptyActionLabel={onGoToTeam === undefined ? undefined : t('team.addEmployee')}
                onEmptyAction={onGoToTeam}
                onRetry={() => {
                  void shiftsQuery.refetch();
                  team.refetch();
                }}
              >
                {view === 'week' && isWide ? (
                  <WeekGrid
                    days={days}
                    rows={gridRows}
                    todayKey={todayKey}
                    timezone={scope.timezone}
                    timeFormat={scope.timeFormat}
                    language={language}
                    jobRoleNames={jobRoleNames}
                    warningsFor={(shiftId) => warningsForShift(analysis.warnings, shiftId)}
                    onSelectShift={openEdit}
                    onAddShift={openCreate}
                    readOnly={readOnly}
                  />
                ) : view === 'week' ? (
                  <DayList
                    days={days}
                    shiftsByDay={shiftsByDay}
                    employeeNames={names}
                    jobRoleNames={jobRoleNames}
                    todayKey={todayKey}
                    timezone={scope.timezone}
                    timeFormat={scope.timeFormat}
                    language={language}
                    warningsFor={(shiftId) => warningsForShift(analysis.warnings, shiftId)}
                    onSelectShift={openEdit}
                    onAddShift={({ dateKey }) => openCreate({ dateKey })}
                    readOnly={readOnly}
                  />
                ) : (
                  <Stack gap={spacing.base}>
                    <Row gap={spacing.sm} wrap>
                      {days.map((day) => (
                        <Chip
                          key={day}
                          label={day === todayKey ? t('common.today') : day.slice(8)}
                          selected={day === selectedDay}
                          onPress={() => setChosenDay(day)}
                          testID={`schedule-day-${day}`}
                        />
                      ))}
                    </Row>
                    <DayList
                      days={[selectedDay]}
                      shiftsByDay={shiftsByDay}
                      employeeNames={names}
                      jobRoleNames={jobRoleNames}
                      todayKey={todayKey}
                      timezone={scope.timezone}
                      timeFormat={scope.timeFormat}
                      language={language}
                      warningsFor={(shiftId) => warningsForShift(analysis.warnings, shiftId)}
                      onSelectShift={openEdit}
                      onAddShift={({ dateKey }) => openCreate({ dateKey })}
                      readOnly={readOnly}
                    />
                  </Stack>
                )}
              </AsyncSection>

              <WeeklyHoursSummary
                totals={totals}
                weeklyLimitMinutes={scope.settings.weeklyOvertimeThresholdMinutes}
                totalMinutes={analysis.totalMinutes}
              />

              <PublicationHistory
                publications={publications.data ?? []}
                timezone={scope.timezone}
                timeFormat={scope.timeFormat}
                language={language}
              />
            </Stack>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>

      {editing !== null ? (
        <ShiftFormSheet
          key={editing.mode === 'edit' ? editing.shift.id : 'new'}
          title={editing.mode === 'edit' ? t('schedule.editShift') : t('schedule.addShift')}
          initial={editing.values}
          employees={employeeOptions}
          jobRoles={jobRoleOptions}
          days={days}
          language={language}
          saving={mutations.create.isPending || mutations.update.isPending}
          existingStatus={editing.mode === 'edit' ? editing.shift.status : undefined}
          onSubmit={submitShift}
          onDuplicate={
            editing.mode === 'edit'
              ? () => {
                  const shift = editing.shift;
                  mutations.duplicate.mutate(
                    { shift },
                    {
                      onSuccess: () => {
                        setEditing(null);
                        setFeedback(t('schedule.duplicated'));
                      },
                    },
                  );
                }
              : undefined
          }
          onRemove={
            editing.mode === 'edit'
              ? () => {
                  setRemovingShift(editing.shift);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmSheet
        visible={removingShift !== null}
        title={
          removingShift?.status === 'published'
            ? t('schedule.cancelShift')
            : t('schedule.deleteShift')
        }
        body={
          removingShift?.status === 'published'
            ? t('schedule.cancelShiftHint')
            : t('schedule.deleteShiftHint')
        }
        confirmLabel={
          removingShift?.status === 'published'
            ? t('schedule.cancelShift')
            : t('schedule.deleteShift')
        }
        destructive
        onConfirm={() => {
          const shift = removingShift;
          if (shift === null) return;
          mutations.remove.mutate(
            { shiftId: shift.id, status: shift.status },
            {
              onSuccess: () => {
                setRemovingShift(null);
                setFeedback(
                  shift.status === 'published' ? t('schedule.cancelled') : t('schedule.deleted'),
                );
              },
            },
          );
        }}
        onCancel={() => setRemovingShift(null)}
      />

      <ConfirmSheet
        visible={publishAllOpen}
        title={t('schedule.publish')}
        body={t('schedule.publishAllConfirm', { count: pendingIds.length })}
        confirmLabel={t('schedule.publish')}
        onConfirm={() => {
          mutations.publish.mutate(
            { shiftIds: pendingIds },
            {
              onSuccess: () => {
                setPublishAllOpen(false);
                setFeedback(t('schedule.published'));
              },
            },
          );
        }}
        onCancel={() => setPublishAllOpen(false)}
      />

      {publishPickerOpen ? (
        <AdminSheet
          visible
          title={t('schedule.publishChangesOnly')}
          onClose={() => setPublishPickerOpen(false)}
          testID="publish-picker"
          footer={
            <PrimaryButton
              label={t('schedule.publishSelected', { count: pickedForPublish.length })}
              onPress={() => {
                mutations.publish.mutate(
                  { shiftIds: pickedForPublish },
                  {
                    onSuccess: () => {
                      setPublishPickerOpen(false);
                      setPickedIds(null);
                      setFeedback(t('schedule.published'));
                    },
                  },
                );
              }}
              disabled={pickedForPublish.length === 0}
              loading={mutations.publish.isPending}
              testID="publish-selected"
            />
          }
        >
          <AppText variant="help" tone="subtle">
            {t('schedule.publishPickerHint')}
          </AppText>
          <Stack gap={spacing.sm}>
            {datedShifts
              .filter((shift) => pendingIds.includes(shift.id))
              .map((shift) => (
                <Chip
                  key={shift.id}
                  label={`${names.get(shift.employee_id) ?? ''} · ${shift.dateKey.slice(5)} · ${minutesToHHmm(
                    shift.planned_unpaid_break_minutes,
                  )}`}
                  selected={pickedForPublish.includes(shift.id)}
                  onPress={() =>
                    setPickedIds((current) => {
                      const base = current ?? pendingIds;
                      return base.includes(shift.id)
                        ? base.filter((id) => id !== shift.id)
                        : [...base, shift.id];
                    })
                  }
                  testID={`publish-pick-${shift.id}`}
                />
              ))}
          </Stack>
        </AdminSheet>
      ) : null}

      <AdminSheet
        visible={copyOpen}
        title={t('schedule.copyPreviousWeek')}
        onClose={() => setCopyOpen(false)}
        testID="copy-week-sheet"
        footer={
          <PrimaryButton
            label={t('schedule.copyPreviousWeek')}
            loading={mutations.copyWeek.isPending}
            onPress={() => {
              mutations.copyWeek.mutate(
                { employeeId: copyEmployeeId },
                {
                  onSuccess: (count) => {
                    setCopyOpen(false);
                    setFeedback(t('schedule.copied', { count }));
                  },
                },
              );
            }}
            testID="copy-week-confirm"
          />
        }
      >
        <AppText variant="help" tone="subtle">
          {t('schedule.copyPreviousWeekHint')}
        </AppText>
        <SelectField
          label={t('schedule.copyScope')}
          value={copyEmployeeId}
          options={employeeOptions}
          onChange={(employeeId) =>
            setCopyEmployeeId((current) => (current === employeeId ? null : employeeId))
          }
          emptyLabel={t('team.noEmployeesForLocation')}
          testID="copy-week-employee"
        />
        <AppText variant="label" tone="subtle">
          {copyEmployeeId === null ? t('schedule.copyScopeAll') : t('schedule.copyScopeOne')}
        </AppText>
      </AdminSheet>
    </AppScreen>
  );
}
