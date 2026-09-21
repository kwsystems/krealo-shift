import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { fetchExportRows, type WorkSession } from './api';
import { alertsForSession, overlappingSessionIds, type TimesheetAlert } from './alerts';
import { buildTimesheetCsv, timesheetFileName, type CsvLabels } from './csv';
import {
  useAdjustments,
  useDailySummaries,
  usePeriod,
  useTimeEvents,
  useTimesheetMutations,
  useTimesheetTotals,
  useWorkSessions,
} from './hooks';
import { shareCsv } from './share-csv';
import { track } from '@/lib/analytics';
import { AsyncSection } from '@/components/schedule/data-states';
import {
  InlineNotice,
  SegmentedControl,
  SelectField,
  StatTile,
  type Option,
} from '@/components/schedule/fields';
import { WeekNavigator } from '@/components/schedule/week-tools';
import { ManualEntrySheet, SessionDetailSheet } from '@/components/timesheets/session-detail';
import { SessionList } from '@/components/timesheets/session-list';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import {
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  localDateTimeToInstant,
  weekEnd,
  weekRangeInstants,
} from '@/features/schedules/week';
import { useEmployeeNames, useTeam } from '@/features/team/hooks';
import { adminErrorKind } from '@/hooks/use-admin-query';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * Horas y hojas de tiempo (§11.4).
 *
 * El periodo por defecto es la semana en curso, con la misma navegación que el
 * editor de horarios para que no haya dos formas distintas de moverse en el
 * tiempo dentro de la misma app.
 */

type StatusFilter = 'all' | 'needsReview' | 'approved';

export function TimesheetsScreen() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const language = currentLanguage();
  const now = useLiveClock('minute');

  const [weekOffset, setWeekOffset] = useState(0);
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<WorkSession | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const nowISO = now.toISOString();
  const thisWeekStart = currentWeekStart(nowISO, scope.weekStartsOn, scope.timezone);
  const weekStart = addWeeks(thisWeekStart, weekOffset);
  const from = weekStart;
  const to = weekEnd(weekStart);
  const range = useMemo(
    () => weekRangeInstants(weekStart, scope.timezone),
    [weekStart, scope.timezone],
  );

  const organizationId = scope.organization?.id ?? null;
  const summaries = useDailySummaries({ locationId: scope.locationId, from, to });
  const sessions = useWorkSessions({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    fromISO: range.fromISO,
    toISO: range.toISO,
    cacheKey: { from, to },
  });
  const period = usePeriod({ organizationId, locationId: scope.locationId, from, to });
  const names = useEmployeeNames(organizationId);
  const team = useTeam({
    organizationId,
    locationIds: scope.locationId === null ? [] : [scope.locationId],
  });

  const mutations = useTimesheetMutations({
    organizationId,
    locationId: scope.locationId,
    from,
    to,
  });

  const selectedDayRange = useMemo(() => {
    if (selected === null) return { fromISO: range.fromISO, toISO: range.toISO, key: 'none' };
    const dayKey = dateKeyOf(selected.starts_at, scope.timezone);
    const startInstant = localDateTimeToInstant(dayKey, '00:00', scope.timezone);
    const endInstant = localDateTimeToInstant(dayKey, '23:59', scope.timezone);
    return {
      fromISO: startInstant ?? range.fromISO,
      toISO: endInstant ?? range.toISO,
      key: dayKey,
    };
  }, [selected, scope.timezone, range.fromISO, range.toISO]);

  const events = useTimeEvents({
    organizationId: scope.organization?.id ?? null,
    employeeId: selected?.employee_id ?? null,
    fromISO: selectedDayRange.fromISO,
    toISO: selectedDayRange.toISO,
    cacheKey: selectedDayRange.key,
  });
  const adjustments = useAdjustments(selected === null ? [] : [selected.id]);

  const allSessions = useMemo(() => sessions.data ?? [], [sessions.data]);
  const overlapping = useMemo(() => overlappingSessionIds(allSessions), [allSessions]);

  const alertsBySession = useMemo(() => {
    const map = new Map<string, TimesheetAlert[]>();
    for (const session of allSessions) {
      const alerts = alertsForSession(session, nowISO);
      if (overlapping.has(session.id) && !alerts.includes('overlap')) alerts.push('overlap');
      map.set(session.id, alerts);
    }
    return map;
  }, [allSessions, overlapping, nowISO]);

  const visibleSummaries = useMemo(
    () =>
      (summaries.data ?? []).filter(
        (day) => employeeFilter === null || day.employee_id === employeeFilter,
      ),
    [summaries.data, employeeFilter],
  );

  const totals = useTimesheetTotals(visibleSummaries, scope.settings.dailyOvertimeThresholdMinutes);

  const visibleSessions = useMemo(
    () =>
      allSessions.filter((session) => {
        if (employeeFilter !== null && session.employee_id !== employeeFilter) return false;
        if (statusFilter === 'needsReview') {
          return (alertsBySession.get(session.id) ?? []).length > 0;
        }
        if (statusFilter === 'approved') return session.status === 'approved';
        return true;
      }),
    [allSessions, employeeFilter, statusFilter, alertsBySession],
  );

  const employeeOptions = useMemo<Option<string>[]>(
    () =>
      team.members
        .filter(
          (member) => scope.locationId === null || member.locationIds.includes(scope.locationId),
        )
        .map((member) => ({ value: member.id, label: member.displayName })),
    [team.members, scope.locationId],
  );

  const csvLabels: CsvLabels = {
    employee: t('csv.employee'),
    date: t('csv.date'),
    clockIn: t('csv.clockIn'),
    clockOut: t('csv.clockOut'),
    grossHours: t('csv.grossHours'),
    paidBreak: t('csv.paidBreak'),
    unpaidBreak: t('csv.unpaidBreak'),
    netHours: t('csv.netHours'),
    netDecimal: t('csv.netDecimal'),
    regularHours: t('csv.regularHours'),
    overtimeHours: t('csv.overtimeHours'),
    status: t('csv.status'),
    flags: t('csv.flags'),
  };

  const exportCsv = useMutation({
    mutationFn: async () => {
      const rows = await fetchExportRows({
        locationId: scope.locationId ?? '',
        from,
        to,
      });
      const content = buildTimesheetCsv(rows, {
        labels: csvLabels,
        timezone: scope.timezone,
        timeFormat: scope.timeFormat,
        language,
        // El umbral es de la UBICACIÓN, no una constante: exportar dos ubicaciones con
        // el mismo umbral fijo daría horas extra equivocadas en una de las dos.
        dailyOvertimeThresholdMinutes: scope.settings.dailyOvertimeThresholdMinutes,
      });
      await shareCsv({ fileName: timesheetFileName({ from, to }), content });
      return rows.length;
    },
    // §31 `timesheet_exported`. Se miden los TAMAÑOS —filas y días— y no qué se exportó:
    // el contenido son las horas de personas con nombre, y eso no entra en analítica.
    onSuccess: (count) => {
      track({ name: 'timesheet_exported', rowCount: count, dayCount: daysBetween(from, to) });
      setFeedback(t('timesheet.exported', { count }));
    },
  });

  const periodStatus = period.data?.status ?? 'open';
  const conflict = adminErrorKind(mutations.adjust.error) === 'conflict';

  /*
   * LA CABECERA VA DENTRO DE LA LISTA, y esa es toda la diferencia.
   *
   * Aquí hay UN solo contenedor que se desplaza, el `FlatList`, y todo lo de arriba
   * —título de sección, sedes, semana, empleados, filtro, las seis cifras y la tarjeta
   * del período— viaja como su `ListHeaderComponent`. Con eso la lista sigue acotada,
   * que es lo que la hace virtualizar (§23), y a la vez no hay nada que pueda quedar
   * fuera de alcance.
   *
   * ANTES LA CABECERA ERA HERMANA DE LA LISTA, y en una columna la lista solo recibía
   * el alto que sobrara. Cuando la cabecera medía MÁS que la pantalla no sobraba nada:
   * a 375x812 medía 1.240 px, así que la lista empezaba 428 px por debajo del cristal y
   * no se desplazaba ni ella —estaba fuera— ni la pantalla —no tenía `scroll`—. Se veía
   * la cabecera y ahí se acababa la aplicación.
   *
   * Y NO ERA SOLO COSA DE TELÉFONOS, que es lo que parecía. El primer arreglo cambiaba
   * de estrategia por debajo de 768 px de ancho; medido en una ventana de 825x914, la
   * cabecera seguía midiendo 1.044 y la lista seguía fuera. El ancho nunca fue la
   * pregunta: la pregunta es si la cabecera cabe, y eso solo se sabe midiendo. Metida
   * en la lista, la pregunta desaparece.
   */
  return (
    <AppScreen tone="canvas">
      <ResponsiveContainer style={estilos.flexOne}>
        <Stack gap={spacing.lg} style={estilos.flexOne}>
          <AppText variant="title" accessibilityRole="header">
            {t('timesheet.title')}
          </AppText>

          <AsyncSection
            isPending={scope.isLoading}
            error={scope.error}
            isEmpty={scope.locations.length === 0}
            emptyTitle={t('settings.noLocations')}
            emptyBody={t('settings.noLocationsHint')}
            onRetry={scope.refetch}
          >
            <SessionList
              sessions={visibleSessions}
              employeeNames={names}
              alertsBySession={alertsBySession}
              unknownEmployeeLabel={t('team.unknownEmployee')}
              timezone={scope.timezone}
              timeFormat={scope.timeFormat}
              language={language}
              onSelect={setSelected}
              empty={
                <AsyncSection
                  isPending={sessions.isPending}
                  error={sessions.error}
                  isEmpty
                  emptyTitle={t('timesheet.noEntries')}
                  emptyBody={t('timesheet.noEntriesHint')}
                  onRetry={() => void sessions.refetch()}
                >
                  {null}
                </AsyncSection>
              }
              header={
                <Stack gap={spacing.lg} style={estilos.cabecera}>
                  {scope.locations.length > 1 ? (
                    <SelectField
                      label={t('schedule.location')}
                      value={scope.locationId}
                      options={scope.locations.map((location) => ({
                        value: location.id,
                        label: location.name,
                      }))}
                      onChange={scope.setLocationId}
                      testID="timesheet-location"
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

                  <SelectField
                    label={t('schedule.employee')}
                    value={employeeFilter}
                    options={employeeOptions}
                    onChange={(value) =>
                      setEmployeeFilter((current) => (current === value ? null : value))
                    }
                    emptyLabel={t('team.noEmployeesForLocation')}
                    testID="timesheet-employee-filter"
                  />

                  <SegmentedControl
                    label={t('timesheet.statusFilter')}
                    value={statusFilter}
                    options={[
                      { value: 'all', label: t('team.statusAll') },
                      { value: 'needsReview', label: t('timesheet.statusNeedsReview') },
                      { value: 'approved', label: t('timesheet.statusApproved') },
                    ]}
                    onChange={setStatusFilter}
                    testID="timesheet-status-filter"
                  />

                  <Row gap={spacing.sm} wrap align="flex-start">
                    <StatTile
                      label={t('timesheet.netHours')}
                      value={minutesToHHmm(totals.netMinutes)}
                      icon="time-outline"
                      testID="total-net"
                    />
                    <StatTile
                      label={t('timesheet.regular')}
                      value={minutesToHHmm(totals.regularMinutes)}
                      icon="checkmark-circle"
                    />
                    <StatTile
                      label={t('timesheet.overtimeInformative')}
                      value={minutesToHHmm(totals.overtimeMinutes)}
                      icon="trending-up-outline"
                      /*
                       * El `testID` lo pide `scripts/reportes-check.mjs`: abre esta
                       * pestaña y la de Reportes en la misma semana y exige que las dos
                       * digan lo mismo. Si no lo dicen, una de las dos miente sobre las
                       * horas de gente real, y eso no puede depender de que alguien se
                       * acuerde de compararlas a mano.
                       */
                      testID="total-overtime"
                    />
                    {/*
                  EQUIVALENTE CON EL MULTIPLICADOR (§13), y solo si hay horas extra: una
                  casilla que dice 00:00 x1.5 es ruido en la fila de totales.

                  §13 pide el multiplicador entre las políticas configurables y no
                  existía. Y pone su límite en la misma sección: "La app registra y
                  resume tiempo; no debe afirmar que reemplaza la revisión de nómina o
                  asesoría laboral". Por eso el número va con la palabra "referencia" en
                  su etiqueta y en horas, NO en dinero: en cuanto esto mostrara un
                  importe, alguien lo pagaría sin revisarlo.
                */}
                    {totals.overtimeMinutes > 0 ? (
                      <StatTile
                        label={t('timesheet.overtimeEquivalent', {
                          factor: (scope.settings.overtimeMultiplierPercent / 100).toFixed(2),
                        })}
                        value={minutesToHHmm(
                          Math.round(
                            (totals.overtimeMinutes * scope.settings.overtimeMultiplierPercent) /
                              100,
                          ),
                        )}
                        icon="calculator-outline"
                        testID="total-overtime-equivalent"
                      />
                    ) : null}
                    <StatTile
                      label={t('timesheet.breaks')}
                      value={minutesToHHmm(totals.unpaidBreakMinutes + totals.paidBreakMinutes)}
                      icon="cafe-outline"
                    />
                    <StatTile
                      label={t('states.needsReviewBadge')}
                      value={String(totals.needsReviewDays)}
                      /*
                       * EL UNICO TONO DE ESTA FILA, y por eso funciona: una jornada sin
                       * cerrar es lo que hay que atender hoy. Con las otras cinco tenidas
                       * tambien, esta no destacaba sobre nada.
                       */
                      tone={totals.needsReviewDays > 0 ? 'late' : undefined}
                      icon="alert-circle"
                    />
                  </Row>

                  <Card>
                    <Row justify="space-between" gap={spacing.md} wrap align="center">
                      <Stack gap={spacing.xs}>
                        <AppText variant="bodyStrong">{t('timesheet.period')}</AppText>
                        <AppText variant="help" tone="subtle" tabular>
                          {`${from} – ${to}`}
                        </AppText>
                      </Stack>
                      <StatusBadge
                        label={
                          periodStatus === 'approved'
                            ? t('timesheet.statusApproved')
                            : periodStatus === 'reopened'
                              ? t('timesheet.statusReopened')
                              : t('timesheet.statusOpen')
                        }
                        tone={periodStatus === 'approved' ? 'working' : 'info'}
                        icon={
                          periodStatus === 'approved' ? 'checkmark-circle' : 'lock-open-outline'
                        }
                        compact
                      />
                    </Row>

                    <Row gap={spacing.sm} wrap>
                      {periodStatus === 'approved' ? (
                        <SecondaryButton
                          label={t('timesheet.reopenPeriod')}
                          onPress={() => {
                            const periodId = period.data?.id;
                            if (periodId === undefined) return;
                            mutations.reopen.mutate(
                              { periodId },
                              { onSuccess: () => setFeedback(t('timesheet.reopened')) },
                            );
                          }}
                          fullWidth={false}
                          loading={mutations.reopen.isPending}
                          testID="timesheet-reopen"
                        />
                      ) : (
                        <PrimaryButton
                          label={t('timesheet.approvePeriod')}
                          hint={t('timesheet.approveHint')}
                          onPress={() =>
                            mutations.approve.mutate(undefined, {
                              onSuccess: () => setFeedback(t('timesheet.approved')),
                            })
                          }
                          fullWidth={false}
                          loading={mutations.approve.isPending}
                          disabled={!scope.isAdmin}
                          testID="timesheet-approve"
                        />
                      )}
                      <SecondaryButton
                        label={t('timesheet.exportCsv')}
                        onPress={() => exportCsv.mutate()}
                        fullWidth={false}
                        loading={exportCsv.isPending}
                        testID="timesheet-export"
                      />
                      <SecondaryButton
                        label={t('timesheet.addManualEntry')}
                        onPress={() => setManualOpen(true)}
                        fullWidth={false}
                        testID="timesheet-manual"
                      />
                    </Row>

                    {mutations.approve.error !== null ? (
                      <InlineNotice
                        tone="late"
                        icon="warning-outline"
                        title={t('timesheet.approveBlockedTitle')}
                        body={t('timesheet.approveBlockedBody')}
                      />
                    ) : null}
                    {exportCsv.error !== null ? (
                      <InlineNotice
                        tone="late"
                        icon="warning-outline"
                        title={t('timesheet.exportFailedTitle')}
                        body={t('timesheet.exportFailedBody')}
                      />
                    ) : null}
                  </Card>

                  {feedback !== null ? (
                    <InlineNotice tone="working" icon="checkmark-circle" title={feedback} />
                  ) : null}
                </Stack>
              }
            />
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>

      {selected !== null ? (
        <SessionDetailSheet
          key={selected.id}
          session={selected}
          employeeName={names.get(selected.employee_id) ?? t('team.unknownEmployee')}
          events={events.data ?? []}
          adjustments={adjustments.data ?? []}
          alerts={alertsBySession.get(selected.id) ?? []}
          timezone={scope.timezone}
          timeFormat={scope.timeFormat}
          language={language}
          saving={mutations.adjust.isPending}
          conflict={conflict}
          onSubmitCorrection={({ newStartsAt, newEndsAt, reason }) =>
            mutations.adjust.mutate(
              {
                workSessionId: selected.id,
                expectedUpdatedAt: selected.updated_at,
                newStartsAt,
                newEndsAt,
                reason,
              },
              {
                onSuccess: () => {
                  setSelected(null);
                  setFeedback(t('timesheet.corrected'));
                },
              },
            )
          }
          onClose={() => setSelected(null)}
        />
      ) : null}

      {manualOpen ? (
        <ManualEntrySheet
          employees={employeeOptions}
          dateKey={dateKeyOf(nowISO, scope.timezone)}
          saving={mutations.manualEntry.isPending || mutations.addEvent.isPending}
          onSubmit={({ employeeId, kind, time, reason }) => {
            const targetDate = dateKeyOf(nowISO, scope.timezone);
            const occurredAt = localDateTimeToInstant(targetDate, time, scope.timezone);

            const closeWith = (message: string) => () => {
              setManualOpen(false);
              setFeedback(message);
            };

            // DOS CAMINOS DISTINTOS, Y LA DIFERENCIA IMPORTA.
            //
            // "Olvidó marcar entrada" y "olvidó marcar salida" son fichajes que
            // faltan: el gerente sabe qué pasó y los registra él, con motivo, a
            // través de `manager_add_time_event`. Eso es lo que pide §11.4
            // ("agregar fichaje manual con motivo") y queda auditado al instante.
            //
            // "Corrección" es otra cosa: cambia un evento que YA existe, y los
            // eventos crudos son append-only. Sigue creando una solicitud para que
            // se revise, y la corrección real se aplica con `manager_adjust_time`
            // desde el detalle de la sesión.
            if (kind === 'correction') {
              mutations.manualEntry.mutate(
                {
                  employeeId,
                  kind,
                  targetDate,
                  proposedAt: occurredAt,
                  proposedEndAt: null,
                  reason,
                },
                { onSuccess: closeWith(t('timesheet.manualEntrySent')) },
              );
              return;
            }

            // Un fichaje SIN hora no se puede registrar: la hora es el dato. La
            // solicitud si admite hora nula —ahi alguien la va a proponer— pero el
            // registro directo no puede inventarla.
            if (occurredAt === null) {
              setFeedback(t('schedule.invalidTime'));
              return;
            }

            mutations.addEvent.mutate(
              {
                employeeId,
                eventType: kind === 'forgot_clock_in' ? 'clock_in' : 'clock_out',
                occurredAt,
                reason,
              },
              { onSuccess: closeWith(t('timesheet.manualEntryRegistered')) },
            );
          }}
          onClose={() => setManualOpen(false)}
        />
      ) : null}
    </AppScreen>
  );
}

/** Días entre dos fechas `YYYY-MM-DD`, inclusive. Para el tamaño de la exportación. */
function daysBetween(from: string, to: string): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const desde = Date.parse(`${from}T00:00:00Z`);
  const hasta = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return 0;
  return Math.max(0, Math.round((hasta - desde) / MS_POR_DIA) + 1);
}

const estilos = StyleSheet.create({
  // La cadena de `flex: 1` desde la pantalla hasta la lista. Sin ella el `FlatList` no
  // tiene altura acotada y crece sin fin, que es lo mismo que no virtualizar.
  flexOne: { flex: 1 },
  // Las filas se separan 8 entre sí; la cabecera necesita el aire de una sección, no el
  // de dos fichajes seguidos.
  cabecera: { paddingBottom: spacing.md },
});
