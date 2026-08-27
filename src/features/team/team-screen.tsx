import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { EmployeeDraft } from './api';
import { EmployeeDetailSheet, TemporaryPinSheet } from './employee-detail';
import { EmployeeFormSheet, emptyEmployeeValues, type EmployeeFormValues } from './employee-form';
import { useTeam, useTeamMutations, type TeamMember } from './hooks';
import { FormField } from '@app/(auth)/sign-in';
import { AsyncSection } from '@/components/schedule/data-states';
import {
  InlineNotice,
  SegmentedControl,
  SelectField,
  type Option,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { addDaysToKey, dateKeyOf } from '@/features/schedules/week';
import { useRequests } from '@/features/requests/hooks';
import { useJobRoles } from './hooks';
import { useDailySummaries } from '@/features/timesheets/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * Equipo (§11.2): buscar, filtrar, ver, crear, asignar, activar/desactivar y
 * generar PIN.
 *
 * Ninguna acción borra historial: desactivar cambia el estado y el empleado sigue
 * apareciendo en las horas ya registradas.
 */

type StatusFilter = 'all' | 'active' | 'inactive';

export function TeamScreen() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const language = currentLanguage();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [jobRoleFilter, setJobRoleFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    mode: 'create' | 'edit';
    employeeId?: string;
    values: EmployeeFormValues;
  } | null>(null);
  const [pin, setPin] = useState<{ value: string; name: string } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const organizationId = scope.organization?.id ?? null;
  const locationIds = useMemo(
    () => scope.locations.map((location) => location.id),
    [scope.locations],
  );

  const team = useTeam({ organizationId, locationIds });
  const jobRolesQuery = useJobRoles(organizationId);
  const mutations = useTeamMutations(organizationId);

  const todayKey = dateKeyOf(new Date().toISOString(), scope.timezone);
  const requests = useRequests({ organizationId, locationId: scope.locationId });
  const recent = useDailySummaries({
    locationId: scope.locationId,
    from: addDaysToKey(todayKey, -6),
    to: todayKey,
  });

  const locationNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const location of scope.locations) map.set(location.id, location.name);
    return map;
  }, [scope.locations]);

  const jobRoleNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of jobRolesQuery.data ?? []) map.set(role.id, role.name);
    return map;
  }, [jobRolesQuery.data]);

  const locationOptions: Option<string>[] = scope.locations.map((location) => ({
    value: location.id,
    label: location.name,
  }));

  const jobRoleOptions: Option<string>[] = (jobRolesQuery.data ?? []).map((role) => ({
    value: role.id,
    label: role.name,
  }));

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();

    return team.members.filter((member) => {
      if (scope.locationId !== null && !member.locationIds.includes(scope.locationId)) return false;
      if (statusFilter === 'active' && member.status === 'inactive') return false;
      if (statusFilter === 'inactive' && member.status !== 'inactive') return false;
      if (jobRoleFilter !== null && !member.jobRoleIds.includes(jobRoleFilter)) return false;
      if (needle === '') return true;

      return (
        member.full_name.toLocaleLowerCase().includes(needle) ||
        member.displayName.toLocaleLowerCase().includes(needle) ||
        (member.employee_number ?? '').toLocaleLowerCase().includes(needle) ||
        (member.email ?? '').toLocaleLowerCase().includes(needle)
      );
    });
  }, [team.members, search, statusFilter, jobRoleFilter, scope.locationId]);

  const selected = team.members.find((member) => member.id === selectedId) ?? null;

  const requestsForSelected = useMemo(
    () =>
      (requests.data ?? []).filter(
        (request) => selected !== null && request.employee_id === selected.id,
      ),
    [requests.data, selected],
  );

  const recentForSelected = useMemo(
    () => (recent.data ?? []).filter((day) => selected !== null && day.employee_id === selected.id),
    [recent.data, selected],
  );

  const submitForm = (draft: EmployeeDraft) => {
    if (form === null) return;

    if (form.mode === 'create') {
      mutations.create.mutate(draft, {
        onSuccess: (employeeId) => {
          setForm(null);
          setSelectedId(employeeId);
          setFeedback(t('team.employeeCreated'));
        },
      });
      return;
    }

    const employeeId = form.employeeId;
    if (employeeId === undefined) return;

    mutations.update.mutate(
      { employeeId, draft },
      {
        onSuccess: () => {
          setForm(null);
          setFeedback(t('team.employeeSaved'));
        },
      },
    );
  };

  const resetPin = (member: TeamMember) => {
    mutations.resetPin.mutate(
      { employeeId: member.id, pinLength: scope.settings.pinLength },
      {
        onSuccess: (value) => {
          setSelectedId(null);
          setPin({ value, name: member.displayName });
        },
      },
    );
  };

  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer>
        <Stack gap={spacing.lg}>
          <Row justify="space-between" align="flex-start" gap={spacing.md} wrap>
            <AppText variant="title" accessibilityRole="header">
              {t('team.title')}
            </AppText>
            <SecondaryButton
              label={t('team.addEmployee')}
              onPress={() =>
                setForm({
                  mode: 'create',
                  values: emptyEmployeeValues(scope.locationId === null ? [] : [scope.locationId]),
                })
              }
              fullWidth={false}
              testID="team-add-employee"
            />
          </Row>

          <AsyncSection
            isPending={scope.isLoading}
            error={scope.error}
            isEmpty={scope.locations.length === 0}
            emptyTitle={t('settings.noLocations')}
            emptyBody={t('settings.noLocationsHint')}
            onRetry={scope.refetch}
          >
            <Stack gap={spacing.base}>
              <FormField
                label={t('common.search')}
                value={search}
                onChangeText={setSearch}
                placeholder={t('team.searchPlaceholder')}
                autoCapitalize="none"
                testID="team-search"
              />

              {scope.locations.length > 1 ? (
                <SelectField
                  label={t('team.locations')}
                  value={scope.locationId}
                  options={locationOptions}
                  onChange={scope.setLocationId}
                  testID="team-location"
                />
              ) : null}

              <SegmentedControl
                label={t('team.statusFilter')}
                value={statusFilter}
                options={[
                  { value: 'active', label: t('team.statusActive') },
                  { value: 'inactive', label: t('team.statusInactive') },
                  { value: 'all', label: t('team.statusAll') },
                ]}
                onChange={setStatusFilter}
                testID="team-status-filter"
              />

              {jobRoleOptions.length > 0 ? (
                <SelectField
                  label={t('team.jobRoles')}
                  value={jobRoleFilter}
                  options={jobRoleOptions}
                  onChange={(value) =>
                    setJobRoleFilter((current) => (current === value ? null : value))
                  }
                  testID="team-job-role-filter"
                />
              ) : null}

              {feedback !== null ? (
                <InlineNotice tone="working" icon="checkmark-circle" title={feedback} />
              ) : null}

              <AsyncSection
                isPending={team.isPending}
                error={team.error}
                isEmpty={filtered.length === 0}
                emptyTitle={team.members.length === 0 ? t('team.noEmployees') : t('team.noMatches')}
                emptyBody={
                  team.members.length === 0 ? t('team.noEmployeesHint') : t('team.noMatchesHint')
                }
                emptyActionLabel={team.members.length === 0 ? t('team.addEmployee') : undefined}
                onEmptyAction={
                  team.members.length === 0
                    ? () =>
                        setForm({
                          mode: 'create',
                          values: emptyEmployeeValues(
                            scope.locationId === null ? [] : [scope.locationId],
                          ),
                        })
                    : undefined
                }
                onRetry={team.refetch}
              >
                <Stack gap={spacing.sm}>
                  {filtered.map((member) => {
                    const minutes = (recent.data ?? [])
                      .filter((day) => day.employee_id === member.id)
                      .reduce((total, day) => total + day.net_minutes, 0);

                    return (
                      <Pressable
                        key={member.id}
                        onPress={() => setSelectedId(member.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${member.displayName}. ${
                          member.status === 'active'
                            ? t('team.statusActive')
                            : t('team.statusInactive')
                        }`}
                        accessibilityHint={t('team.openEmployeeHint')}
                        testID={`team-member-${member.id}`}
                        style={({ pressed }) => [pressed ? styles.pressed : null]}
                      >
                        <Card>
                          <Row justify="space-between" gap={spacing.md} align="flex-start">
                            <Stack gap={spacing.xs}>
                              <AppText variant="bodyStrong">{member.displayName}</AppText>
                              <AppText variant="help" tone="subtle">
                                {member.jobRoleIds.length === 0
                                  ? t('team.noJobRolesAssigned')
                                  : member.jobRoleIds
                                      .map((id) => jobRoleNames.get(id) ?? '')
                                      .filter((name) => name !== '')
                                      .join(', ')}
                              </AppText>
                            </Stack>
                            <Stack gap={spacing.xs}>
                              <StatusBadge
                                label={
                                  member.status === 'active'
                                    ? t('team.statusActive')
                                    : member.status === 'inactive'
                                      ? t('team.statusInactive')
                                      : t('team.statusInvited')
                                }
                                tone={member.status === 'active' ? 'working' : 'offShift'}
                                icon={
                                  member.status === 'active'
                                    ? 'checkmark-circle'
                                    : 'pause-circle-outline'
                                }
                                compact
                              />
                              <AppText variant="label" tone="subtle" tabular>
                                {`${t('team.recentHours')}: ${minutesToHHmm(minutes)}`}
                              </AppText>
                            </Stack>
                          </Row>
                        </Card>
                      </Pressable>
                    );
                  })}
                </Stack>
              </AsyncSection>
            </Stack>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>

      {selected !== null ? (
        <EmployeeDetailSheet
          key={selected.id}
          member={selected}
          locationNames={locationNames}
          jobRoleNames={jobRoleNames}
          recentSummaries={recentForSelected}
          recentPending={recent.isPending}
          recentError={recent.error}
          requests={requestsForSelected}
          timezone={scope.timezone}
          timeFormat={scope.timeFormat}
          language={language}
          busy={mutations.resetPin.isPending}
          onEdit={() =>
            setForm({
              mode: 'edit',
              employeeId: selected.id,
              values: {
                fullName: selected.full_name,
                preferredName: selected.preferred_name ?? '',
                employeeNumber: selected.employee_number ?? '',
                email: selected.email ?? '',
                locationIds: selected.locationIds,
                jobRoleIds: selected.jobRoleIds,
              },
            })
          }
          onToggleStatus={() =>
            mutations.changeStatus.mutate(
              {
                employeeId: selected.id,
                status: selected.status === 'active' ? 'inactive' : 'active',
              },
              {
                onSuccess: () => {
                  setSelectedId(null);
                  setFeedback(
                    selected.status === 'active' ? t('team.deactivated') : t('team.activated'),
                  );
                },
              },
            )
          }
          onResetPin={() => resetPin(selected)}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {form !== null ? (
        <EmployeeFormSheet
          key={form.employeeId ?? 'new-employee'}
          title={form.mode === 'create' ? t('team.addEmployee') : t('common.edit')}
          initial={form.values}
          locations={locationOptions}
          jobRoles={jobRoleOptions}
          saving={mutations.create.isPending || mutations.update.isPending}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
        />
      ) : null}

      {pin !== null ? (
        <TemporaryPinSheet pin={pin.value} employeeName={pin.name} onClose={() => setPin(null)} />
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
