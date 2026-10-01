import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { ShiftInput, ShiftRow } from './api';
import {
  analyzeWeek,
  toScheduledShifts,
  useScheduleMutations,
  usePublications,
  useWeekRestDays,
  useWeekShifts,
} from './hooks';
import { warningsForShift } from './conflicts';
import { estadoDelTurnoAhora, type DentroAhora } from './en-turno';
import { EnTurnoAhora, type PersonaEnTurno } from '@/components/schedule/en-turno-ahora';
import { estadoVisible } from '@/features/timesheets/en-curso';
import { useWorkSessions } from '@/features/timesheets/hooks';
import { useJornadasAlDia } from '@/features/timesheets/jornadas-al-dia';
import { acknowledgeUnusualClock } from '@/features/timesheets/api';
import { claveDelDia, useHorasExtra } from '@/features/timesheets/horas-extra';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';
import {
  MarcasFueraDelTurno,
  type FilaFueraDelTurno,
} from '@/components/schedule/marcas-fuera-del-turno';
import { duracionLegible, marcasRarasDeLaSemana, type MarcaRara } from './marcas-raras';
import { useInicioDelReloj } from './horario-cumplido';
import { PegarHorarioSheet } from './pegar-horario-sheet';
import { RegistrarCumplidoSheet } from './registrar-cumplido-sheet';
import type { EmpleadoConocido } from './pegar-horario';
import { ShiftFormSheet, emptyShiftValues, type ShiftFormValues } from './shift-form';
import {
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  formatDayColumn,
  localTimeOf,
  weekDays,
  weekEnd,
  weekPosition,
  weekRangeInstants,
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
  type DatedRestDay,
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
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { useEmployeeNames, useJobRoles, useTeam } from '@/features/team/hooks';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useWorkingNow } from '@/hooks/use-manager-dashboard';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { currentLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { radii, spacing } from '@/theme/tokens';
import { formatClockTime, formatShiftRange } from '@/utils/time';

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

/** A qué jornada de Horas llevar desde un aviso de Horario. */
export type IrAHoras = { semana: DateKey; persona: string; jornada: string };

export function ScheduleScreen({
  onGoToTeam,
  onGoToHours,
}: {
  onGoToTeam?: () => void;
  onGoToHours?: (destino: IrAHoras) => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilosDeHorario();
  const scope = useManagerScope();
  const { isWide } = useResponsive();
  const now = useLiveClock('minute');
  const language = currentLanguage();

  const [weekOffset, setWeekOffset] = useState(0);
  const [view, setView] = useState<'week' | 'day'>('week');
  const [chosenDay, setChosenDay] = useState<DateKey | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [workedOpen, setWorkedOpen] = useState(false);
  const [copyEmployeeId, setCopyEmployeeId] = useState<string | null>(null);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardFailed, setDiscardFailed] = useState(false);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[] | null>(null);
  const [removingShift, setRemovingShift] = useState<ShiftRow | null>(null);
  const [removingRestDay, setRemovingRestDay] = useState<DatedRestDay | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  /*
   * AL CAMBIAR DE SEMANA SE VA EL AVISO DE LO QUE SE HIZO EN LA OTRA. «Se registraron 28
   * turnos como cumplidos» seguía arriba al pasar a la semana siguiente, donde no se había
   * registrado nada (lo vio Andree el 30-sep cargando septiembre semana por semana): un
   * aviso que habla de otra semana se lee como si hablara de esta.
   */
  const cambiarDeSemana = (siguiente: (actual: number) => number) => {
    setWeekOffset(siguiente);
    setFeedback(null);
    setDiscardFailed(false);
  };

  const nowISO = now.toISOString();
  const thisWeekStart = currentWeekStart(nowISO, scope.weekStartsOn, scope.timezone);
  const weekStart = addWeeks(thisWeekStart, weekOffset);
  // Sin `useMemo`: son siete cadenas y el compilador de React no puede probar que
  // `weekStart` sea estable, así que memorizarlo aquí solo añadiría ruido.
  const days = weekDays(weekStart);
  const todayKey = dateKeyOf(nowISO, scope.timezone);

  /*
   * QUIÉN ESTÁ DENTRO AHORA, de la misma consulta que Inicio y Horas: ver `en-turno.ts`.
   * Solo pinta tarjetas, así que si tarda o falla el Horario se ve como siempre.
   */
  const workingNow = useWorkingNow(scope.locationId);
  const dentroPorPersona = useMemo(() => {
    const map = new Map<string, DentroAhora>();
    for (const fila of workingNow.data ?? []) {
      map.set(fila.employee_id, {
        estado: fila.attendance_state === 'ON_BREAK' ? 'descanso' : 'trabajando',
        shiftId: fila.shift_id,
        desde: fila.starts_at,
        motivo: fila.break_reason,
        descansoDesde: fila.break_started_at,
      });
    }
    return map;
  }, [workingNow.data]);
  const enCursoFor = (shift: ShiftRow) =>
    estadoDelTurnoAhora(shift, dentroPorPersona.get(shift.employee_id), nowISO);

  const position = weekPosition(weekStart, nowISO, scope.weekStartsOn, scope.timezone);
  // Corregir una semana pasada es solo para administradores, con advertencia
  // visible y auditoría del servidor (§11.3).
  const readOnly = position === 'past' && !scope.isAdmin;

  const shiftsQuery = useWeekShifts({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    weekStart,
    timezone: scope.timezone,
  });
  const restDaysQuery = useWeekRestDays({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    weekStart,
  });
  const publications = usePublications({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    weekStart,
  });
  const names = useEmployeeNames(scope.organization?.id ?? null);
  const enTurnoAhora = useMemo<PersonaEnTurno[]>(
    () =>
      (workingNow.data ?? []).map((fila) => {
        const estado = estadoVisible(
          fila.attendance_state === 'ON_BREAK' ? 'descanso' : 'trabajando',
          fila.break_reason,
        );
        const desde =
          estado !== 'trabajando' && fila.break_started_at !== null
            ? fila.break_started_at
            : fila.starts_at;
        return {
          id: fila.employee_id,
          nombre: names.get(fila.employee_id) ?? fila.preferred_name ?? fila.full_name,
          estado,
          motivo: fila.break_reason,
          desde: formatClockTime(desde, scope.timezone, scope.timeFormat, language),
        };
      }),
    [workingNow.data, names, scope.timezone, scope.timeFormat, language],
  );
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

  /*
   * LAS SEMANAS DE ANTES DEL RELOJ. Hasta el día en que la sede empezó a fichar, un turno
   * publicado sin marcas no es una falta: es que la app no existía. Para esas semanas —y
   * solo esas— se ofrece registrarlas como cumplidas (ver `horario-cumplido.ts`). Pasado
   * ese día, un turno sin marcas se corrige en Horas, persona por persona y con motivo,
   * así que el aviso no sale: aquí sería una invitación a marcar una falta como trabajada.
   */
  const inicioDelReloj = useInicioDelReloj({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    timezone: scope.timezone,
    enabled: scope.isAdmin && position !== 'future',
  });
  const relojDesde = inicioDelReloj.data;
  const antesDelReloj =
    scope.isAdmin &&
    position !== 'future' &&
    relojDesde !== undefined &&
    (relojDesde === null || weekStart < relojDesde);
  const rangoDeLaSemana = weekRangeInstants(weekStart, scope.timezone);
  const jornadasDeLaSemana = useWorkSessions({
    organizationId: scope.organization?.id ?? null,
    /*
     * Las jornadas de la semana: para las semanas de antes del reloj y, desde el 1-oct,
     * para avisar de las marcas raras. Una semana que no ha llegado no tiene ninguna.
     * Misma consulta y clave que la semana de Horas, así que no se pide dos veces.
     */
    locationId: antesDelReloj || position !== 'future' ? scope.locationId : null,
    fromISO: rangoDeLaSemana.fromISO,
    toISO: rangoDeLaSemana.toISO,
    cacheKey: { from: weekStart, to: weekEnd(weekStart) },
  });
  const conJornada = new Set((jornadasDeLaSemana.data ?? []).map((jornada) => jornada.shift_id));
  const turnosSinMarcas =
    !antesDelReloj || jornadasDeLaSemana.data === undefined
      ? 0
      : rows.filter(
          (row) =>
            row.status === 'published' &&
            row.ends_at <= nowISO &&
            !conJornada.has(row.id) &&
            (relojDesde === null ||
              relojDesde === undefined ||
              dateKeyOf(row.starts_at, scope.timezone) < relojDesde),
        ).length;

  /*
   * LAS MARCAS RARAS DE LA SEMANA (1-oct): quien entró una hora o más antes de su turno o
   * salió una hora o más después. El reloj ya no lo impide; esto lo avisa, y solo aquí.
   * Se van al cambiar el turno y publicar, al aprobar la extra de ese día en Horas o al
   * decir «visto». Ver `marcas-raras.ts`.
   */
  const queryClient = useQueryClient();
  /*
   * Y LA SEMANA SE VUELVE A MEDIR AL MIRARLA, como en Horas, Reportes e Inicio: una
   * jornada guardada antes de que existieran estas marcas —o con un turno que cambió sin
   * publicarse por esta sede— se pone al día aquí, sin tener que abrir Horas primero.
   */
  useJornadasAlDia({
    locationId: position === 'future' ? null : scope.locationId,
    from: weekStart,
    to: weekEnd(weekStart),
  });
  const horasExtra = useHorasExtra({
    organizationId: scope.organization?.id ?? null,
    locationId: position === 'future' ? null : scope.locationId,
    from: weekStart,
    to: weekEnd(weekStart),
  });
  const marcasRaras = marcasRarasDeLaSemana({
    sesiones: jornadasDeLaSemana.data ?? [],
    turnos: rows,
    conExtraDecidida: new Set(
      (horasExtra.data ?? []).map((fila) => claveDelDia(fila.employee_id, fila.work_date)),
    ),
    timezone: scope.timezone,
  });
  const marcarVisto = useMutation({
    mutationFn: (sessionId: string) => acknowledgeUnusualClock(sessionId),
    onSuccess: () => refrescarVistasDeHoras(queryClient),
  });
  const filasFueraDelTurno: FilaFueraDelTurno[] = marcasRaras.map((rara) =>
    filaDeLaMarcaRara(rara, {
      nombre: names.get(rara.sesion.employee_id) ?? t('team.unknownEmployee'),
      language,
      timezone: scope.timezone,
      timeFormat: scope.timeFormat,
      t,
      puedeCambiarTurno: rara.turno !== null && !readOnly,
      viendo: marcarVisto.isPending && marcarVisto.variables === rara.sesion.id,
    }),
  );
  const marcaRaraPorId = new Map(marcasRaras.map((rara) => [rara.id, rara]));

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

  /*
   * El puesto se lo pone el importador desde la PERSONA, porque una tabla de horario no
   * trae puestos: trae nombres y horas. Es el mismo valor que elegiría quien abre el
   * formulario de turno, sin tener que elegirlo 25 veces.
   */
  const empleadosParaPegar = useMemo<EmpleadoConocido[]>(
    () =>
      locationMembers.map((member) => ({
        id: member.id,
        nombre: member.displayName,
        jobRoleId: member.jobRoleIds[0] ?? null,
      })),
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

  const descansos = useMemo<DatedRestDay[]>(
    () =>
      (restDaysQuery.data ?? []).map((fila) => ({
        id: fila.id,
        employeeId: fila.employee_id,
        dateKey: fila.date_key,
      })),
    [restDaysQuery.data],
  );

  const gridRows = useMemo<EmployeeRow[]>(() => {
    const byEmployee = new Map<string, DatedShift[]>();
    for (const shift of datedShifts) {
      const current = byEmployee.get(shift.employee_id) ?? [];
      current.push(shift);
      byEmployee.set(shift.employee_id, current);
    }

    /*
     * QUIEN SOLO TIENE DESCANSOS TAMBIEN ES UNA FILA. Si los ids salieran solo del equipo
     * y de los turnos, la semana de alguien que la tiene entera libre no se vería: la
     * rejilla enseñaría un hueco donde hay una decisión tomada.
     */
    const ids = new Set<string>([
      ...locationMembers.map((member) => member.id),
      ...byEmployee.keys(),
      ...descansos.map((descanso) => descanso.employeeId),
    ]);

    return [...ids]
      .map((employeeId) => ({
        employeeId,
        name: names.get(employeeId) ?? t('team.unknownEmployee'),
        shifts: byEmployee.get(employeeId) ?? [],
        restDays: descansos.filter((descanso) => descanso.employeeId === employeeId),
        scheduledMinutes: analysis.minutesByEmployee.get(employeeId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [datedShifts, locationMembers, names, analysis.minutesByEmployee, descansos, t]);

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

  const restDaysByDay = useMemo(() => {
    const map = new Map<DateKey, DatedRestDay[]>();
    for (const descanso of descansos) {
      const current = map.get(descanso.dateKey);
      if (current === undefined) map.set(descanso.dateKey, [descanso]);
      else current.push(descanso);
    }
    return map;
  }, [descansos]);

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
  /*
   * Los borradores que NUNCA se publicaron: los únicos que «Descartar borradores» borra. Un
   * borrador con versión es un turno publicado que se editó; ese se queda.
   */
  const borradoresNuevos = rows
    .filter((row) => row.status === 'draft' && row.publication_version === 0)
    .map((row) => row.id);
  const cambiosDePublicados = pendingIds.length - borradoresNuevos.length;
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
              {/*
                TODOS LOS MANDOS DE LA SEMANA EN UNA FILA.

                Antes eran CUATRO bloques apilados —sede, navegador de semana, vista
                semana/día y dos botones de acción— y con la tarjeta de publicar encima de
                la rejilla, el horario empezaba en y=680 de 768: el 89 % de la pantalla era
                mando y no se veía ni una fila de turnos sin desplazarse. Medido el
                2026-09-23, y es el peor caso de toda la app.

                «Copiar semana anterior» sale de aquí: se usa al empezar una semana, no en
                cada visita, y vive en la hoja de copiar. «Agregar turno» se queda, porque
                es la acción de esta pantalla.
              */}
              <Row gap={spacing.md} wrap align="center" justify="space-between">
                {/*
                  ESTA FILA TAMBIÉN TIENE QUE PODER ENCOGER, no solo el título de dentro. Sin
                  `minWidth: 0` medía su ancho de contenido —583 px, navegador más «Semana |
                  Día»— dentro de un teléfono de 358, y el título acababa en el píxel 415:
                  «Semana del 28 de septiembre de 20…». El título ya sabía encoger; su
                  contenedor no le dejaba sitio para hacerlo. Lo tapaba una exención de
                  `responsive:check` demasiado ancha, ver allí.
                */}
                <Row gap={spacing.md} wrap align="center" style={estilos.encoge}>
                  <WeekNavigator
                    weekStart={weekStart}
                    language={language}
                    isCurrentWeek={weekOffset === 0}
                    onPrevious={() => cambiarDeSemana((current) => current - 1)}
                    onNext={() => cambiarDeSemana((current) => current + 1)}
                    onGoToCurrent={() => cambiarDeSemana(() => 0)}
                  />
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
                </Row>

                {readOnly ? null : (
                  /*
                    Y ESTA, por lo mismo: sin poder encoger, sus tres botones medían 547 px en
                    un teléfono de 360 y «Agregar turno» —la acción de esta pantalla— quedaba
                    entero fuera, a la derecha. Salió en cuanto se arregló el título de arriba:
                    la misma exención demasiado ancha tapaba los dos.
                  */
                  <Row gap={spacing.sm} wrap style={estilos.encoge}>
                    <GhostButton
                      label={t('schedule.copyPreviousWeek')}
                      onPress={() => setCopyOpen(true)}
                      fullWidth={false}
                      testID="schedule-copy-week"
                    />
                    {/*
                      «PEGAR HORARIO» CUESTA UNA LINEA DE MANDOS A 1280 px, medido: la fila
                      pasa a envolverse y la rejilla empieza 56 px mas abajo (y=486 de 800
                      con la barra de publicar visible). A 1440 no envuelve.

                      Se queda aun asi, y no por comodidad: la alternativa era esconderlo
                      —junto con «Copiar semana anterior»— detras de un «Llenar la semana»,
                      y eso le cuesta un clic MAS A LA SEMANA a la accion que de verdad se
                      repite, que es copiar la anterior. Cambiar el habito semanal por 56 px
                      en un ancho que ademas no es el del panel de la tienda es un mal
                      cambio. Si algun dia hay un cuarto boton aqui, este es el momento de
                      agrupar los dos que llenan la semana, no antes.
                    */}
                    <GhostButton
                      label={t('schedule.pasteWeek')}
                      onPress={() => setPasteOpen(true)}
                      fullWidth={false}
                      testID="schedule-paste-week"
                    />
                    <SecondaryButton
                      label={t('schedule.addShift')}
                      onPress={() => openCreate({ dateKey: selectedDay })}
                      fullWidth={false}
                      testID="schedule-add-shift"
                    />
                  </Row>
                )}
              </Row>

              {scope.locations.length > 1 ? (
                <SelectField
                  label={t('schedule.location')}
                  value={scope.locationId}
                  options={locationOptions}
                  onChange={scope.setLocationId}
                  testID="schedule-location"
                />
              ) : null}

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

              {feedback !== null ? (
                <InlineNotice tone="working" icon="checkmark-circle" title={feedback} />
              ) : null}

              {discardFailed ? (
                <InlineNotice
                  tone="late"
                  icon="alert-circle"
                  title={t('schedule.draftsDiscardFailed')}
                  testID="schedule-discard-failed"
                />
              ) : null}

              {/*
                UNA BARRA, NO UNA TARJETA. Esto era una tarjeta con título, párrafo de
                ayuda y dos botones debajo: 150 px de alto para comunicar un estado y
                ofrecer una acción, justo encima de la rejilla que la persona ha venido a
                ver. Un estado se enseña en una línea.

                La frase de ayuda —«mientras editas, el horario se guarda como borrador»—
                se cae: explica algo que ya dice el propio contador de cambios sin
                publicar, y se leía una vez en la vida mientras ocupaba sitio para siempre.
              */}
              {pendingIds.length > 0 && !readOnly ? (
                <Row gap={spacing.sm} wrap align="center" style={estilos.barraDePublicar}>
                  <AppText variant="bodyStrong" style={estilos.creceEnLaBarra}>
                    {t('schedule.pendingChanges', { count: pendingIds.length })}
                  </AppText>
                  {borradoresNuevos.length > 0 ? (
                    <GhostButton
                      label={t('schedule.discardDrafts')}
                      onPress={() => setDiscardOpen(true)}
                      fullWidth={false}
                      testID="schedule-discard-drafts"
                    />
                  ) : null}
                  <GhostButton
                    label={t('schedule.publishChangesOnly')}
                    onPress={() => {
                      setPickedIds(pendingIds);
                      setPublishPickerOpen(true);
                    }}
                    fullWidth={false}
                    testID="schedule-publish-some"
                  />
                  <PrimaryButton
                    label={t('schedule.publish')}
                    onPress={() => setPublishAllOpen(true)}
                    fullWidth={false}
                    loading={mutations.publish.isPending}
                    testID="schedule-publish-all"
                  />
                </Row>
              ) : null}

              {turnosSinMarcas > 0 ? (
                <InlineNotice
                  tone="info"
                  icon="time-outline"
                  title={t('schedule.worked.noticeTitle')}
                  body={t('schedule.worked.noticeBody', { count: turnosSinMarcas })}
                  action={
                    <GhostButton
                      label={t('schedule.worked.open')}
                      onPress={() => setWorkedOpen(true)}
                      fullWidth={false}
                      testID="schedule-worked-open"
                    />
                  }
                  testID="schedule-worked-notice"
                />
              ) : null}

              <ScheduleWarnings warnings={analysis.warnings} />

              <MarcasFueraDelTurno
                filas={filasFueraDelTurno}
                onCambiarTurno={(id) => {
                  const turno = marcaRaraPorId.get(id)?.turno;
                  if (turno !== null && turno !== undefined) openEdit(turno);
                }}
                onVerEnHoras={(id) => {
                  const rara = marcaRaraPorId.get(id);
                  if (rara === undefined || onGoToHours === undefined) return;
                  onGoToHours({
                    semana: weekStart,
                    persona: rara.sesion.employee_id,
                    jornada: rara.sesion.id,
                  });
                }}
                onVisto={(id) => {
                  const rara = marcaRaraPorId.get(id);
                  if (rara !== undefined) marcarVisto.mutate(rara.sesion.id);
                }}
              />
              {marcarVisto.isError ? (
                <InlineNotice
                  tone="late"
                  body={t('schedule.unusual.seenFailed')}
                  testID="marcas-raras-error"
                />
              ) : null}

              {/* Quién está en la tienda ahora mismo: solo tiene sentido en esta semana. */}
              {position === 'current' ? <EnTurnoAhora personas={enTurnoAhora} /> : null}

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
                    enCursoFor={enCursoFor}
                    onSelectShift={openEdit}
                    onAddShift={openCreate}
                    onSelectRestDay={setRemovingRestDay}
                    readOnly={readOnly}
                  />
                ) : view === 'week' ? (
                  <DayList
                    days={days}
                    shiftsByDay={shiftsByDay}
                    restDaysByDay={restDaysByDay}
                    employeeNames={names}
                    jobRoleNames={jobRoleNames}
                    todayKey={todayKey}
                    timezone={scope.timezone}
                    timeFormat={scope.timeFormat}
                    language={language}
                    warningsFor={(shiftId) => warningsForShift(analysis.warnings, shiftId)}
                    enCursoFor={enCursoFor}
                    onSelectShift={openEdit}
                    onAddShift={({ dateKey }) => openCreate({ dateKey })}
                    onSelectRestDay={setRemovingRestDay}
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
                      restDaysByDay={restDaysByDay}
                      employeeNames={names}
                      jobRoleNames={jobRoleNames}
                      todayKey={todayKey}
                      timezone={scope.timezone}
                      timeFormat={scope.timeFormat}
                      language={language}
                      warningsFor={(shiftId) => warningsForShift(analysis.warnings, shiftId)}
                      enCursoFor={enCursoFor}
                      onSelectShift={openEdit}
                      onAddShift={({ dateKey }) => openCreate({ dateKey })}
                      onSelectRestDay={setRemovingRestDay}
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
          saving={
            mutations.create.isPending ||
            mutations.update.isPending ||
            mutations.markRestDays.isPending
          }
          existingStatus={editing.mode === 'edit' ? editing.shift.status : undefined}
          onSubmitRestDay={
            editing.mode === 'create'
              ? ({ employeeId, dateKey }) => {
                  mutations.markRestDays.mutate([{ employeeId, dateKey }], {
                    onSuccess: () => {
                      setEditing(null);
                      setFeedback(t('schedule.restDayMarked'));
                    },
                  });
                }
              : undefined
          }
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
                  /*
                   * EL DÍA Y LAS HORAS DEL TURNO. Aquí salía «09-30 · 01:00»: el «01:00» era
                   * el REFRIGERIO planificado —60 minutos— escrito como una hora, así que
                   * parecía que el turno empezaba a la una. Lo vio Andree el 30-sep al
                   * publicar un cambio de horario: no se parecía en nada a lo que había puesto.
                   */
                  label={`${names.get(shift.employee_id) ?? ''} · ${formatDayColumn(
                    shift.dateKey,
                    language,
                  )} · ${formatShiftRange(
                    shift.starts_at,
                    shift.ends_at,
                    scope.timezone,
                    scope.timeFormat,
                    language,
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

      <ConfirmSheet
        visible={removingRestDay !== null}
        title={t('schedule.removeRestDay')}
        body={t('schedule.removeRestDayHint')}
        confirmLabel={t('schedule.removeRestDay')}
        destructive
        onConfirm={() => {
          const descanso = removingRestDay;
          if (descanso === null) return;
          mutations.unmarkRestDay.mutate(
            { restDayId: descanso.id },
            {
              onSuccess: () => {
                setRemovingRestDay(null);
                setFeedback(t('schedule.restDayRemoved'));
              },
            },
          );
        }}
        onCancel={() => setRemovingRestDay(null)}
      />

      <ConfirmSheet
        visible={discardOpen}
        title={t('schedule.discardDraftsTitle', { count: borradoresNuevos.length })}
        body={
          cambiosDePublicados > 0
            ? `${t('schedule.discardDraftsBody', { count: borradoresNuevos.length })} ${t(
                'schedule.discardDraftsKeepsChanged',
                { count: cambiosDePublicados },
              )}`
            : t('schedule.discardDraftsBody', { count: borradoresNuevos.length })
        }
        confirmLabel={t('schedule.discardDraftsConfirm', { count: borradoresNuevos.length })}
        destructive
        onConfirm={() => {
          if (mutations.discardDrafts.isPending) return;
          mutations.discardDrafts.mutate(borradoresNuevos, {
            onSuccess: (count) => {
              setDiscardOpen(false);
              setDiscardFailed(false);
              setFeedback(t('schedule.draftsDiscarded', { count }));
            },
            onError: () => {
              setDiscardOpen(false);
              setDiscardFailed(true);
            },
          });
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      {workedOpen ? (
        <RegistrarCumplidoSheet
          dias={days}
          locationId={scope.locationId}
          language={language}
          onClose={() => setWorkedOpen(false)}
          onDone={(resultado) => {
            setWorkedOpen(false);
            setFeedback(t('schedule.worked.done', { count: resultado.registrados }));
          }}
        />
      ) : null}

      {pasteOpen ? (
        <PegarHorarioSheet
          dias={days}
          empleados={empleadosParaPegar}
          timezone={scope.timezone}
          language={language}
          saving={mutations.createMany.isPending}
          turnosExistentes={rows.filter((row) => row.status !== 'cancelled').length}
          existentes={rows
            .filter((row) => row.status !== 'cancelled')
            .map((row) => ({
              employeeId: row.employee_id,
              startsAt: row.starts_at,
              endsAt: row.ends_at,
            }))}
          onClose={() => setPasteOpen(false)}
          onSubmit={({ turnos, descansos }) => {
            /*
             * LOS DESCANSOS SE MARCAN ANTES DE CREAR LOS TURNOS, y el orden importa si
             * algo falla: quedarse con los días libres marcados y sin turnos se ve al
             * instante en la rejilla —seis celdas que dicen «Descanso» y ni un turno— y
             * se arregla volviendo a pegar. Al revés, el fallo sería invisible: la semana
             * parecería completa y solo faltaría lo que no se ve.
             */
            const marcar =
              descansos.length === 0
                ? Promise.resolve(0)
                : mutations.markRestDays.mutateAsync(
                    descansos.map((descanso) => ({
                      employeeId: descanso.employeeId,
                      dateKey: descanso.dateKey,
                    })),
                  );

            void marcar.then(() => {
              if (turnos.length === 0) {
                setPasteOpen(false);
                setFeedback(t('schedule.restDaysMarked', { count: descansos.length }));
                return;
              }
              mutations.createMany.mutate(
                turnos.map((turno) => ({
                  employeeId: turno.employeeId,
                  jobRoleId: turno.jobRoleId,
                  dateKey: turno.dateKey,
                  startTime: turno.startTime,
                  endTime: turno.endTime,
                  plannedUnpaidBreakMinutes: turno.plannedUnpaidBreakMinutes,
                  employeeNote: null,
                  managerNote: null,
                })),
                {
                  onSuccess: (count) => {
                    setPasteOpen(false);
                    setFeedback(
                      descansos.length === 0
                        ? t('schedule.pasted', { count })
                        : `${t('schedule.pasted', { count })} ${t('schedule.restDaysMarked', {
                            count: descansos.length,
                          })}`,
                    );
                  },
                },
              );
            });
          }}
        />
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
                  /*
                   * `copyPreviousWeek` DEVUELVE DOS CUENTAS, y el compilador no avisó: el
                   * antiguo `t('schedule.copied', { count })` seguía compilando con
                   * `count` convertido en objeto, y entonces el plural de i18next deja de
                   * resolver y el mensaje sale con el marcador sin sustituir. Un tipo
                   * `unknown` en la interpolación es el precio de que traducir acepte
                   * cualquier valor; aquí se paga mirándolo.
                   */
                  onSuccess: ({ turnos, descansos }) => {
                    setCopyOpen(false);
                    setFeedback(
                      descansos === 0
                        ? t('schedule.copied', { count: turnos })
                        : `${t('schedule.copied', { count: turnos })} ${t(
                            'schedule.copiedRestDays',
                            { count: descansos },
                          )}`,
                    );
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

/**
 * La barra de «cambios sin publicar»: un estado en una línea, no una tarjeta.
 *
 * Se apoya en `hundido` —el plano que agrupa dentro de una superficie sin dibujar otro
 * marco— y se pega a la barra de control de arriba, que es donde la persona ya está
 * mirando cuando acaba de mover un turno.
 */
const useEstilosDeHorario = estilosDelTema((colors) => ({
  barraDePublicar: {
    backgroundColor: colors.hundido,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  creceEnLaBarra: { flexGrow: 1, flexShrink: 1 },
  encoge: { flexShrink: 1, minWidth: 0 },
}));

/** Una marca rara, escrita para la fila del aviso: quién, qué día, qué hizo y contra qué turno. */
function filaDeLaMarcaRara(
  rara: MarcaRara,
  contexto: {
    nombre: string;
    language: ReturnType<typeof currentLanguage>;
    timezone: string;
    timeFormat: Parameters<typeof formatClockTime>[2];
    t: ReturnType<typeof useTranslation>['t'];
    puedeCambiarTurno: boolean;
    viendo: boolean;
  },
): FilaFueraDelTurno {
  const { t, timezone, timeFormat, language } = contexto;
  const hora = (iso: string) => formatClockTime(iso, timezone, timeFormat, language);
  const { horas, minutos } = duracionLegible(rara.minutos);
  const cuanto =
    rara.minutos === 0
      ? null
      : horas === 0
        ? t('schedule.unusual.minutes', { m: minutos })
        : minutos === 0
          ? t('schedule.unusual.hours', { h: horas })
          : t('schedule.unusual.hoursMinutes', { h: horas, m: minutos });
  const temprano = rara.marca === 'early_arrival';
  const que =
    cuanto === null
      ? temprano
        ? t('schedule.unusual.earlyNoAmount')
        : t('schedule.unusual.lateNoAmount')
      : temprano
        ? t('schedule.unusual.early', { amount: cuanto })
        : t('schedule.unusual.late', { amount: cuanto });
  const detalle =
    rara.turno === null
      ? null
      : temprano
        ? t('schedule.unusual.detailEarly', {
            shift: formatShiftRange(
              rara.turno.starts_at,
              rara.turno.ends_at,
              timezone,
              timeFormat,
              language,
            ),
            time: hora(rara.sesion.starts_at),
          })
        : t('schedule.unusual.detailLate', {
            shift: formatShiftRange(
              rara.turno.starts_at,
              rara.turno.ends_at,
              timezone,
              timeFormat,
              language,
            ),
            time: rara.sesion.ends_at === null ? '' : hora(rara.sesion.ends_at),
          });
  return {
    id: rara.id,
    nombre: contexto.nombre,
    dia: formatDayColumn(rara.dia, language),
    que,
    detalle,
    puedeCambiarTurno: contexto.puedeCambiarTurno,
    viendo: contexto.viendo,
  };
}
