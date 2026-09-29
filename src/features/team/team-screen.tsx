import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { EmployeeDraft } from './api';
import { EmployeeDetailSheet, TemporaryPinSheet } from './employee-detail';
import { EliminarEmpleadoSheet } from './eliminar-empleado-sheet';
import { EliminarVariosSheet } from './eliminar-varios-sheet';
import { EmployeeFormSheet, emptyEmployeeValues, type EmployeeFormValues } from './employee-form';
import { useTeam, useTeamMutations, type TeamMember } from './hooks';
import { FormField } from '@/components/ui/form-field';
import { AsyncSection } from '@/components/schedule/data-states';
import { MemberList } from '@/components/team/member-list';
import {
  InlineNotice,
  SegmentedControl,
  SelectField,
  type Option,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, BarraDeControl, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { addDaysToKey, dateKeyOf, localDateTimeToInstant } from '@/features/schedules/week';
import { useRequests } from '@/features/requests/hooks';
import { useJobRoles } from './hooks';
import { dentroPorEmpleado, enCursoPorSesionDe } from '@/features/timesheets/en-curso';
import {
  useDailySummaries,
  useSesionesAlDiaCon,
  useWorkSessions,
} from '@/features/timesheets/hooks';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useWorkingNow } from '@/hooks/use-manager-dashboard';
import type { DentroEnEquipo } from '@/components/team/member-row';
import { formatClockTime } from '@/utils/time';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';

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
  /** A quién se está eliminando: ver `EliminarEmpleadoSheet`. */
  const [eliminando, setEliminando] = useState<TeamMember | null>(null);
  /*
   * «ELIMINAR VARIOS»: quiénes están marcados, o `null` fuera de ese modo. Solo existe en
   * el filtro Inactivo —el servidor no borra a nadie activo— y cambiar de filtro lo cierra.
   */
  const [marcados, setMarcados] = useState<ReadonlySet<string> | null>(null);
  const [confirmandoVarios, setConfirmandoVarios] = useState(false);
  const [progresoVarios, setProgresoVarios] = useState<number | null>(null);
  const [fallidosVarios, setFallidosVarios] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const organizationId = scope.organization?.id ?? null;
  /*
   * LAS ASIGNACIONES SE LEEN DE TODAS LAS SEDES, TAMBIÉN DE LAS CERRADAS, aunque en
   * pantalla solo salgan las activas. No es un descuido: guardar un empleado BORRA todas
   * sus sedes y escribe las del formulario (`replaceAssignments`). Si aquí se leyeran
   * solo las activas, editar a alguien de «Asia» y «San Miguel» con Asia cerrada le
   * quitaría Asia en silencio, y al reabrirla ya no estaría. El formulario conserva la
   * sede que no enseña, así que el guardado la deja como estaba.
   */
  const locationIds = useMemo(
    () => scope.allLocations.map((location) => location.id),
    [scope.allLocations],
  );

  const team = useTeam({ organizationId, locationIds });
  const jobRolesQuery = useJobRoles(organizationId);
  const mutations = useTeamMutations(organizationId);

  const now = useLiveClock('minute');
  const nowISO = now.toISOString();
  const todayKey = dateKeyOf(nowISO, scope.timezone);
  const requests = useRequests({ organizationId, locationId: scope.locationId });
  const recent = useDailySummaries({
    locationId: scope.locationId,
    from: addDaysToKey(todayKey, -6),
    to: todayKey,
  });

  /*
   * QUIÉN ESTÁ DENTRO Y CUÁNTO LLEVA, con la misma cuenta que Horas.
   *
   * Los resúmenes de arriba solo suman jornadas CERRADAS: la de hoy entraba al marcar la
   * salida, y a media mañana la fila de quien estaba trabajando decía lo mismo que si no
   * hubiera venido. Lo vio Andree el 29-sep: «¿por qué no salen sus horas corriendo, así
   * como en Horas?».
   *
   * Hace falta la sesión y no solo «quién está dentro», porque el refrigerio que ya tomó
   * se descuenta de la sesión. Se piden desde ayer: un turno de noche abierto desde ayer
   * sigue siendo alguien dentro.
   */
  const ayer = addDaysToKey(todayKey, -1);
  const manana = addDaysToKey(todayKey, 1);
  const abiertas = useWorkSessions({
    organizationId,
    locationId: scope.locationId,
    fromISO: localDateTimeToInstant(ayer, '00:00', scope.timezone) ?? nowISO,
    toISO: localDateTimeToInstant(manana, '00:00', scope.timezone) ?? nowISO,
    cacheKey: { from: ayer, to: manana },
  });
  const workingNow = useWorkingNow(scope.locationId);
  useSesionesAlDiaCon(scope.locationId, workingNow.data);
  const dentro = useMemo(
    () => dentroPorEmpleado(abiertas.data ?? [], enCursoPorSesionDe(workingNow.data), nowISO),
    [abiertas.data, workingNow.data, nowISO],
  );
  const dentroPorMiembro = useMemo(() => {
    const map = new Map<string, DentroEnEquipo>();
    for (const [employeeId, persona] of dentro) {
      map.set(employeeId, {
        estado: persona.estado,
        motivo: persona.motivo,
        desde: formatClockTime(persona.desde, scope.timezone, scope.timeFormat, language),
      });
    }
    return map;
  }, [dentro, scope.timezone, scope.timeFormat, language]);

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
      /*
       * QUIEN NO TIENE NINGUNA SEDE SE VE SIEMPRE, y antes no se veia NUNCA.
       *
       * El filtro pedia que la sede elegida estuviera entre las suyas. Con cero sedes
       * eso no se cumple en ninguna pestaña, asi que esos empleados existian en la base
       * y eran inalcanzables desde la app: no se podian abrir, ni editar, ni desactivar.
       * Y la propia app los fabricaba —un guardado a medias escribe la persona y falla
       * al asignarle la sede—, o sea que creaba gente que luego no te dejaba arreglar.
       *
       * Se cuelan en todas las sedes a proposito: no pertenecen a ninguna, y son
       * justamente los que hay que atender. La fila los marca como «Sin sede».
       */
      const sinSede = member.locationIds.length === 0;
      if (!sinSede && scope.locationId !== null && !member.locationIds.includes(scope.locationId))
        return false;
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

  /*
   * LO QUE SE VA A BORRAR ES LO MARCADO QUE SE VE. Si después de marcar se escribe en el
   * buscador, lo marcado que queda fuera de la vista no se borra: en la hoja solo sale lo
   * que estaba en pantalla, y es lo único que se revisó.
   */
  const aBorrar = marcados === null ? [] : filtered.filter((member) => marcados.has(member.id));
  const modoVarios = marcados !== null && statusFilter === 'inactive';

  const alternarMarca = (id: string) =>
    setMarcados((actual) => {
      if (actual === null) return actual;
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });

  const salirDeVarios = () => {
    setMarcados(null);
    setConfirmandoVarios(false);
    setFallidosVarios([]);
  };

  const borrarVarios = () => {
    const lista = aBorrar;
    setProgresoVarios(0);
    setFallidosVarios([]);
    mutations.removeMany.mutate(
      { members: lista, onProgreso: setProgresoVarios },
      {
        onSuccess: ({ eliminados, fallidos }) => {
          setProgresoVarios(null);
          if (fallidos.length === 0) {
            salirDeVarios();
          } else {
            // Los que fallaron siguen marcados, para poder reintentar solo esos.
            setMarcados(new Set(fallidos));
            setFallidosVarios(lista.filter((m) => fallidos.includes(m.id)).map((m) => m.full_name));
          }
          if (eliminados.length > 0) {
            setFeedback(t('team.deletedMany', { count: eliminados.length }));
          }
        },
        onError: () => setProgresoVarios(null),
      },
    );
  };

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

  /**
   * Minutos recientes por empleado, en un `Map` y calculado UNA vez.
   *
   * Antes cada fila hacía su propio `filter` + `reduce` sobre todos los resúmenes
   * diarios: con doscientos empleados y un mes de datos eso es doscientos recorridos del
   * mismo array en cada render. Ahora se agrega una vez y la fila solo busca su id.
   */
  const recentMinutesByMember = useMemo(() => {
    const total = new Map<string, number>();
    for (const day of recent.data ?? []) {
      total.set(day.employee_id, (total.get(day.employee_id) ?? 0) + day.net_minutes);
    }
    // Lo que lleva hoy quien sigue dentro: ver `dentro`, arriba.
    for (const [employeeId, persona] of dentro) {
      total.set(employeeId, (total.get(employeeId) ?? 0) + persona.minutos);
    }
    return total;
  }, [recent.data, dentro]);

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
      { employeeId: member.id },
      {
        onSuccess: (value) => {
          setSelectedId(null);
          setPin({ value, name: member.displayName });
        },
      },
    );
  };

  /*
   * `AppScreen` SIN `scroll`: la lista virtualizada es la que scrollea. Un `FlatList`
   * dentro de un `ScrollView` vertical no virtualiza NADA —React Native lo avisa por
   * consola— así que dejar el `scroll` aquí habría hecho el cambio inútil y silencioso.
   */
  return (
    <AppScreen tone="canvas">
      <ResponsiveContainer style={styles.flexOne}>
        <Stack gap={spacing.lg} style={styles.flexOne}>
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
            <Stack gap={spacing.base} style={styles.flexOne}>
              {/*
                LOS CUATRO MANDOS EN UNA FILA, no en una pila de cuatro bloques a ancho
                completo. Así estaba antes y la lista de gente —lo que se viene a ver a
                esta pantalla— empezaba en y=510 de 768: el 66 % era mando. Medido, no
                estimado.
              */}
              <BarraDeControl testID="team-controls">
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
                  onChange={(valor) => {
                    setStatusFilter(valor);
                    if (valor !== 'inactive') salirDeVarios();
                  }}
                  rotuloVisible
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
              </BarraDeControl>

              {feedback !== null ? (
                <InlineNotice tone="working" icon="checkmark-circle" title={feedback} />
              ) : null}

              {/*
                ELIMINAR VARIOS, SOLO EN INACTIVO Y SOLO PARA QUIEN ADMINISTRA: es donde están
                los de prueba, y el servidor no borra a nadie activo. Fuera de ese filtro el
                botón no existe, para que nadie lo encuentre mirando al equipo que trabaja.
              */}
              {statusFilter === 'inactive' && scope.isAdmin && filtered.length > 0 ? (
                modoVarios ? (
                  <Row gap={spacing.sm} align="center" wrap testID="team-delete-many-bar">
                    <AppText variant="bodyStrong" style={styles.flexOne}>
                      {t('team.deleteManyMarked', { count: aBorrar.length })}
                    </AppText>
                    <GhostButton
                      label={
                        aBorrar.length === filtered.length
                          ? t('team.deleteManyNone')
                          : t('team.deleteManyAll')
                      }
                      onPress={() =>
                        setMarcados(
                          aBorrar.length === filtered.length
                            ? new Set()
                            : new Set(filtered.map((member) => member.id)),
                        )
                      }
                      fullWidth={false}
                      testID="team-delete-many-all"
                    />
                    <DangerButton
                      label={t('team.deleteManyGo', { count: aBorrar.length })}
                      onPress={() => setConfirmandoVarios(true)}
                      disabled={aBorrar.length === 0}
                      fullWidth={false}
                      testID="team-delete-many-review"
                    />
                    <SecondaryButton
                      label={t('common.cancel')}
                      onPress={salirDeVarios}
                      fullWidth={false}
                      testID="team-delete-many-exit"
                    />
                  </Row>
                ) : (
                  <Row gap={spacing.sm} align="center" wrap>
                    <GhostButton
                      label={t('team.deleteManyStart')}
                      onPress={() => setMarcados(new Set())}
                      fullWidth={false}
                      testID="team-delete-many-start"
                    />
                    <AppText variant="help" tone="subtle" style={styles.flexOne}>
                      {t('team.deleteManyHint')}
                    </AppText>
                  </Row>
                )
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
                <MemberList
                  members={filtered}
                  recentMinutesByMember={recentMinutesByMember}
                  dentroPorMiembro={dentroPorMiembro}
                  jobRoleNames={jobRoleNames}
                  onSelect={modoVarios ? alternarMarca : setSelectedId}
                  marcados={modoVarios ? (marcados ?? undefined) : undefined}
                />
              </AsyncSection>
            </Stack>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>

      {selected !== null ? (
        <EmployeeDetailSheet
          key={selected.id}
          organizationId={scope.organization?.id ?? null}
          member={selected}
          locationNames={locationNames}
          jobRoleNames={jobRoleNames}
          recentSummaries={recentForSelected}
          recentPending={recent.isPending}
          recentError={recent.error}
          enCurso={dentro.get(selected.id)}
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
          onDelete={
            scope.isAdmin
              ? () => {
                  // Una hoja encima de otra no: se cierra la ficha y se abre la de borrar.
                  setSelectedId(null);
                  mutations.remove.reset();
                  setEliminando(selected);
                }
              : undefined
          }
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
          saveError={mutations.create.error ?? mutations.update.error}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
        />
      ) : null}

      {pin !== null ? (
        <TemporaryPinSheet pin={pin.value} employeeName={pin.name} onClose={() => setPin(null)} />
      ) : null}

      {eliminando !== null ? (
        <EliminarEmpleadoSheet
          key={eliminando.id}
          member={eliminando}
          busy={mutations.remove.isPending}
          error={mutations.remove.error}
          onConfirm={(confirmName) =>
            mutations.remove.mutate(
              { employeeId: eliminando.id, confirmName },
              {
                onSuccess: () => {
                  setFeedback(t('team.deleted', { name: eliminando.displayName }));
                  setEliminando(null);
                },
              },
            )
          }
          onClose={() => setEliminando(null)}
        />
      ) : null}

      {confirmandoVarios && aBorrar.length > 0 ? (
        <EliminarVariosSheet
          members={aBorrar}
          progreso={progresoVarios}
          fallidos={fallidosVarios}
          onConfirm={borrarVarios}
          onClose={() => setConfirmandoVarios(false)}
        />
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  pressed: { opacity: 0.7 },
});
