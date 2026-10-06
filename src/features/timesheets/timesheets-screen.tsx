import { feriadoDe } from '@/domain/feriados-peru';
import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { fetchExportRows, PeriodoBloqueado, type WorkSession } from './api';
import { useJornadasAlDia } from './jornadas-al-dia';
import {
  alertsForSession,
  conTurnoSinPublicar,
  overlappingSessionIds,
  type TimesheetAlert,
} from './alerts';
import { buildTimesheetCsv, timesheetFileName, type CsvLabels } from './csv';
import { dentroPrimero, enCursoPorSesionDe, totalEnCurso } from './en-curso';
import { conLasAbiertas, useJornadasAbiertas } from './jornadas-abiertas';
import { puntualidadDe, puntualidadPorJornada } from './puntualidad';
import {
  useAdjustments,
  useDailySummaries,
  usePeriod,
  useTimeEvents,
  useTimesheetMutations,
  useSesionesAlDiaCon,
  useTimesheetTotals,
  useWorkSessions,
} from './hooks';
import {
  aprobadasPorDia,
  claveDelDia,
  esPosibleHoraExtra,
  minutosDeMas,
  planificadoPorDia,
  useGuardarHoraExtra,
  useHorasExtra,
} from './horas-extra';
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
import { HoraExtraDelDia } from '@/components/timesheets/hora-extra-del-dia';
import { SessionList } from '@/components/timesheets/session-list';
import type { HoraExtraDeLaFila } from '@/components/timesheets/session-row';
import { useWeekShifts } from '@/features/schedules/hooks';
import { useDiasDelFichajeManual } from './dias-del-fichaje-manual';
import { PorResolverDeLaSemana } from './por-resolver-de-la-semana';
import { casosPorResolver, type CasoPorResolver } from './casos';
import { useMutacionesDeFaltas } from './justificaciones';
import { detalleDeFaltas, tonoDelTotalDeFaltas } from './textos-de-falta';
import { useFaltasDeLaSemana } from './use-faltas';
import {
  FaltasDeLaSemana,
  JustificarFaltaSheet,
  RegistrarQueVinoSheet,
} from '@/components/timesheets/faltas-de-la-semana';
import type { Falta } from './faltas';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, BarraDeControl, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import {
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  formatDateKeyShort,
  localDateTimeToInstant,
  weekEnd,
  weekRangeInstants,
  weekStartOfKey,
} from '@/features/schedules/week';
import { useEmployeeNames, useTeam } from '@/features/team/hooks';
import { AdminError, adminErrorKind } from '@/hooks/use-admin-query';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useWorkingNow } from '@/hooks/use-manager-dashboard';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { radii, spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm } from '@/utils/time';

/**
 * Horas y hojas de tiempo (§11.4).
 *
 * El periodo por defecto es la semana en curso, con la misma navegación que el
 * editor de horarios para que no haya dos formas distintas de moverse en el
 * tiempo dentro de la misma app.
 */

type StatusFilter = 'all' | 'needsReview' | 'approved';

/**
 * A dónde abrir Horas al llegar desde un aviso (1-oct): la semana, la persona y la jornada
 * de una marca rara de Horario. «Ver en Horas» lleva a SU jornada, ya abierta, para
 * corregir la hora o aprobar la extra sin buscarla.
 */
export type DestinoEnHoras = { semana?: string; persona?: string; jornada?: string };

export function TimesheetsScreen({ destino }: { destino?: DestinoEnHoras } = {}) {
  const { t } = useTranslation();
  const estilosDelPeriodo = useEstilosDeHoras();
  const scope = useManagerScope();
  const language = currentLanguage();
  const now = useLiveClock('minute');

  const [weekOffset, setWeekOffset] = useState(() =>
    destino?.semana === undefined
      ? 0
      : semanasHasta(
          currentWeekStart(new Date().toISOString(), scope.weekStartsOn, scope.timezone),
          weekStartOfKey(destino.semana, scope.weekStartsOn),
        ),
  );
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(destino?.persona ?? null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [elegida, setSelected] = useState<WorkSession | null>(null);
  /* La jornada que pidió el aviso, hasta que se cierre: se abre en cuanto llegan los datos. */
  const [pedida, setPedida] = useState<string | null>(destino?.jornada ?? null);
  const [manualOpen, setManualOpen] = useState(false);
  /* La falta que se está arreglando porque sí vino: ver `faltas-de-la-semana.tsx`. */
  const [faltaElegida, setFaltaElegida] = useState<Falta | null>(null);
  /* La falta de la que se está diciendo por qué faltó. */
  const [faltaAExplicar, setFaltaAExplicar] = useState<Falta | null>(null);
  const mutacionesDeFaltas = useMutacionesDeFaltas();
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
  const selected =
    elegida ??
    (pedida === null ? null : ((sessions.data ?? []).find((fila) => fila.id === pedida) ?? null));
  /* Cerrar el detalle cierra también la jornada pedida: si no, se volvería a abrir sola. */
  const cerrarDetalle = () => {
    // Lo que falló en esta jornada no se arrastra a la próxima que se abra.
    mutations.adjust.reset();
    mutations.reclassify.reset();
    mutacionesDeFaltas.deshacerCumplido.reset();
    setSelected(null);
    setPedida(null);
  };
  const period = usePeriod({ organizationId, locationId: scope.locationId, from, to });
  const periodoAprobado = period.data?.status === 'approved';
  // Las jornadas de la semana que se mira, al día con el horario publicado de ahora.
  useJornadasAlDia({ locationId: scope.locationId, from, to });
  const names = useEmployeeNames(organizationId);
  /*
   * LAS FALTAS DE LA SEMANA (1-oct): los turnos que terminaron sin ninguna marca. Con las
   * mismas jornadas que esta hoja, así que un fichaje manual las quita en cuanto se guarda.
   * Ver `faltas.ts`.
   */
  const faltasDeLaSemana = useFaltasDeLaSemana({
    organizationId,
    locationId: scope.locationId,
    weekStart,
    timezone: scope.timezone,
    nowISO,
  });
  const faltasVisibles = faltasDeLaSemana.faltas.filter(
    (falta) => employeeFilter === null || falta.employeeId === employeeFilter,
  );
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
    /*
     * HASTA LAS 00:00 DEL DÍA SIGUIENTE, O HASTA LA SALIDA SI ES MÁS TARDE (4-oct). Cortaba a
     * las 23:59: una marca a las 23:59:30 no salía, y la salida de una jornada que pasa la
     * medianoche tampoco, así que no se podía ver ni reclasificar.
     */
    const finDelDia =
      startInstant === null
        ? null
        : new Date(Date.parse(startInstant) + 24 * 60 * 60_000).toISOString();
    const salida = selected.ends_at ?? nowISO;
    const hasta =
      finDelDia === null
        ? range.toISO
        : new Date(Math.max(Date.parse(finDelDia), Date.parse(salida) + 60_000)).toISOString();
    return {
      fromISO: startInstant ?? range.fromISO,
      toISO: hasta,
      key: `${dayKey}:${selected.id}`,
    };
  }, [selected, scope.timezone, range.fromISO, range.toISO, nowISO]);

  const events = useTimeEvents({
    organizationId: scope.organization?.id ?? null,
    employeeId: selected?.employee_id ?? null,
    locationId: scope.locationId,
    fromISO: selectedDayRange.fromISO,
    toISO: selectedDayRange.toISO,
    cacheKey: selectedDayRange.key,
  });
  const adjustments = useAdjustments(selected === null ? [] : [selected.id]);

  const allSessions = useMemo(() => sessions.data ?? [], [sessions.data]);
  // Las abiertas de semanas anteriores también se resuelven aquí: ver `jornadas-abiertas.ts`.
  const abiertas = useJornadasAbiertas({ organizationId, locationId: scope.locationId });
  const paraResolver = useMemo(
    () => conLasAbiertas(allSessions, abiertas.data, range.toISO),
    [allSessions, abiertas.data, range.toISO],
  );

  // El fichaje manual elige día: ver `dias-del-fichaje-manual.ts`.
  const { diasDelFichajeManual, diaDeLaJornadaAbierta } = useDiasDelFichajeManual({
    sesiones: allSessions,
    nowISO,
    timezone: scope.timezone,
    language,
  });
  const overlapping = useMemo(() => overlappingSessionIds(allSessions), [allSessions]);

  const workingNow = useWorkingNow(scope.locationId);
  const enCursoPorSesion = useMemo(() => enCursoPorSesionDe(workingNow.data), [workingNow.data]);
  // Una salida o un descanso cambian quién está dentro: ver `useSesionesAlDiaCon`.
  useSesionesAlDiaCon(scope.locationId, workingNow.data);

  const turnosDeLaSemana = useWeekShifts({
    organizationId,
    locationId: scope.locationId,
    weekStart,
    timezone: scope.timezone,
  });

  /*
   * «SIN TURNO» CUANDO EL TURNO EXISTE PERO ES UN BORRADOR (30-sep): se dice así. Es
   * verdad que no tiene turno programado —un borrador no lo ve la persona ni cuenta—, pero
   * «sin turno» a secas, justo después de haberle cambiado el turno, hace pensar que la app
   * no recogió el cambio. Lo que falta es publicarlo, y eso es lo que tiene que decir.
   */
  const alertsBySession = useMemo(() => {
    const borradores = new Set(
      (turnosDeLaSemana.data ?? [])
        .filter((turno) => turno.status === 'draft')
        .map((turno) => claveDelDia(turno.employee_id, dateKeyOf(turno.starts_at, scope.timezone))),
    );
    const map = new Map<string, TimesheetAlert[]>();
    // «Llegó tarde» y «Salió antes» por turno, no por jornada: ver `puntualidad.ts`.
    const marcas = puntualidadPorJornada(allSessions);
    for (const session of allSessions) {
      const alerts = conTurnoSinPublicar(
        alertsForSession(session, nowISO, puntualidadDe(marcas, session)),
        borradores.has(
          claveDelDia(session.employee_id, dateKeyOf(session.starts_at, scope.timezone)),
        ),
      );
      if (overlapping.has(session.id) && !alerts.includes('overlap')) alerts.push('overlap');
      map.set(session.id, alerts);
    }
    return map;
  }, [allSessions, overlapping, nowISO, turnosDeLaSemana.data, scope.timezone]);

  const visibleSummaries = useMemo(
    () =>
      (summaries.data ?? []).filter(
        (day) => employeeFilter === null || day.employee_id === employeeFilter,
      ),
    [summaries.data, employeeFilter],
  );

  /*
   * LAS HORAS EXTRA: las aprobadas, y el aviso de las que podrían serlo (30-sep, ver
   * `horas-extra.ts`). «De más» se mide contra lo PLANIFICADO de esa persona ese día —sus
   * turnos publicados—, así que un turno largo que se cumple no avisa por largo que sea,
   * y unos minutos antes o después tampoco: no llegan al umbral de la sede.
   */
  const horasExtra = useHorasExtra({ organizationId, locationId: scope.locationId, from, to });
  const guardarHoraExtra = useGuardarHoraExtra({ organizationId, locationId: scope.locationId });
  const aprobadas = useMemo(() => aprobadasPorDia(horasExtra.data ?? []), [horasExtra.data]);
  const planificado = useMemo(
    () => planificadoPorDia(turnosDeLaSemana.data ?? [], scope.timezone),
    [turnosDeLaSemana.data, scope.timezone],
  );
  const netosPorDia = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const dia of summaries.data ?? []) {
      const clave = claveDelDia(dia.employee_id, dia.work_date);
      mapa.set(clave, (mapa.get(clave) ?? 0) + dia.net_minutes);
    }
    return mapa;
  }, [summaries.data]);
  const umbralDeAviso = scope.settings.overtimeNoticeMinutes;
  /** La hora extra va en la ÚLTIMA fila del día de cada persona: la aprobación es por día. */
  const horaExtraPorSesion = useMemo(() => {
    const ultima = new Map<string, WorkSession>();
    for (const sesion of allSessions) {
      const clave = claveDelDia(sesion.employee_id, dateKeyOf(sesion.starts_at, scope.timezone));
      const antes = ultima.get(clave);
      if (antes === undefined || sesion.starts_at > antes.starts_at) ultima.set(clave, sesion);
    }
    const mapa = new Map<string, HoraExtraDeLaFila>();
    for (const [clave, sesion] of ultima) {
      if (sesion.ends_at === null) continue; // quien sigue dentro todavía no ha trabajado «de más»
      const aprobado = aprobadas.get(clave) ?? 0;
      if (aprobado > 0) {
        mapa.set(sesion.id, { tipo: 'aprobada', minutos: aprobado });
        continue;
      }
      const deMas = minutosDeMas(netosPorDia.get(clave) ?? 0, planificado.get(clave));
      if (esPosibleHoraExtra(deMas, umbralDeAviso)) {
        mapa.set(sesion.id, { tipo: 'posible', minutos: deMas });
      }
    }
    return mapa;
  }, [allSessions, aprobadas, netosPorDia, planificado, umbralDeAviso, scope.timezone]);
  /*
   * CON EL FILTRO DE PERSONA, como todo lo demás de la hoja (auditoría, 4-oct): con una
   * persona elegida, «3 días por revisar» contaba los de todo el equipo.
   */
  const diasPorRevisar = allSessions.filter(
    (sesion) =>
      horaExtraPorSesion.get(sesion.id)?.tipo === 'posible' &&
      (employeeFilter === null || sesion.employee_id === employeeFilter),
  ).length;

  const totals = useTimesheetTotals(visibleSummaries, aprobadas);
  const claveSeleccionada =
    selected === null
      ? ''
      : claveDelDia(selected.employee_id, dateKeyOf(selected.starts_at, scope.timezone));
  /*
   * EL REFRIGERIO QUE NO MARCÓ ESE DÍA (6-oct), para que la hoja de la hora extra lo diga:
   * aprobar más de lo que trabajó de más sin él cuenta esa hora como trabajada, y con eso
   * el caso «sin refrigerio» de «Por resolver» queda decidido. Se mira SIN las extras
   * aprobadas: el caso existe aunque ya esté decidido por una.
   */
  const refrigerioSinMarcar =
    selected === null
      ? 0
      : (casosPorResolver({
          sesiones: paraResolver,
          turnos: turnosDeLaSemana.data ?? [],
          ahoraISO: nowISO,
          timezone: scope.timezone,
        }).find(
          (caso): caso is Extract<CasoPorResolver, { tipo: 'sin_refrigerio' }> =>
            caso.tipo === 'sin_refrigerio' &&
            caso.sesion.employee_id === selected.employee_id &&
            caso.dia === dateKeyOf(selected.starts_at, scope.timezone),
        )?.refrigerio ?? 0);

  const visibleSessions = useMemo(() => {
    const filtradas = allSessions.filter((session) => {
      if (employeeFilter !== null && session.employee_id !== employeeFilter) return false;
      if (statusFilter === 'needsReview') {
        return (alertsBySession.get(session.id) ?? []).length > 0;
      }
      /*
       * APROBADO ES EL PERIODO (2-oct): el servidor aprueba la semana entera, no jornada por
       * jornada, así que `status === 'approved'` no lo lleva ninguna jornada y el filtro
       * salía vacío con la semana aprobada. Ahora dice lo mismo que la insignia del periodo.
       */
      if (statusFilter === 'approved') {
        return periodoAprobado || session.status === 'approved';
      }
      return true;
    });
    // Quien está dentro, arriba: ver `dentroPrimero`.
    return dentroPrimero(filtradas, alertsBySession, enCursoPorSesion);
  }, [
    allSessions,
    employeeFilter,
    statusFilter,
    alertsBySession,
    enCursoPorSesion,
    periodoAprobado,
  ]);

  /*
   * LA CASILLA «NECESITA REVISIÓN» CUENTA LO QUE LISTA EL FILTRO DEL MISMO NOMBRE (2-oct):
   * las jornadas con algún aviso. Antes contaba días con `needs_review`, un estado que el
   * servidor no escribe, así que en producción decía siempre 0 mientras el filtro, debajo,
   * enseñaba varias.
   */
  const porRevisar = allSessions.filter(
    (session) =>
      (employeeFilter === null || session.employee_id === employeeFilter) &&
      (alertsBySession.get(session.id) ?? []).length > 0,
  ).length;

  /*
   * LO QUE SE ESTÁ TRABAJANDO AHORA, APARTE DEL TOTAL. «Horas netas» suma jornadas
   * cerradas y así se queda: es el número que se aprueba y se exporta, y mezclarle minutos
   * que siguen corriendo lo haría cambiar solo mientras alguien lo mira. Pero con gente
   * dentro, un 00:00 arriba decía «no ha trabajado nadie». Por eso va en su propia casilla,
   * y solo cuando hay alguien dentro.
   *
   * Se cuenta sobre la MISMA lista que se ve: con el filtro puesto en una persona, las
   * demás casillas hablan de ella y esta hablaba del local entero.
   */
  const enCursoAhora = useMemo(
    () => totalEnCurso(visibleSessions, alertsBySession, enCursoPorSesion, nowISO),
    [visibleSessions, alertsBySession, enCursoPorSesion, nowISO],
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
    holiday: t('csv.holiday'),
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
        // Las mismas aprobadas que la pantalla: el archivo y los totales cuadran.
        horasExtraAprobadas: aprobadas,
        nombreDelFeriado: (dia) => {
          const feriado = feriadoDe(dia, scope.timezone);
          return feriado === null ? '' : t(`holidays.pe.${feriado}`);
        },
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
              enCursoPorSesion={enCursoPorSesion}
              nowISO={nowISO}
              horaExtraPorSesion={horaExtraPorSesion}
              unknownEmployeeLabel={t('team.unknownEmployee')}
              timezone={scope.timezone}
              tipoDeTienda={scope.organization?.business_type ?? null}
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
                  {/*
                    LA SEMANA ARRIBA Y LOS FILTROS EN UNA FILA. Eran CUATRO bloques a ancho
                    completo apilados —sede, semana, empleado, estado— y detrás seis fichas
                    de totales y la tarjeta del periodo, así que la primera fila de la hoja
                    empezaba pasados los 790 px. En una hoja de horas lo que se viene a ver
                    son las filas.
                  */}
                  <WeekNavigator
                    weekStart={weekStart}
                    language={language}
                    isCurrentWeek={weekOffset === 0}
                    onPrevious={() => setWeekOffset((current) => current - 1)}
                    onNext={() => setWeekOffset((current) => current + 1)}
                    onGoToCurrent={() => setWeekOffset(0)}
                  />

                  <BarraDeControl testID="timesheet-controls">
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
                      rotuloVisible
                      testID="timesheet-status-filter"
                    />
                  </BarraDeControl>

                  {/*
                    POR RESOLVER (1-oct): lo que hay que decidir de esta semana, con su arreglo
                    a un toque. Va ANTES de los totales porque es lo único de la pantalla que
                    pide algo («esto es algo que yo debería ver rápido»), y los totales de
                    debajo cambian en cuanto se resuelve un caso. Ver
                    `por-resolver-de-la-semana.tsx`.
                  */}
                  <PorResolverDeLaSemana
                    sesiones={paraResolver}
                    turnos={turnosDeLaSemana.data ?? []}
                    nombres={names}
                    personaFiltrada={employeeFilter}
                    locationId={scope.locationId}
                    nowISO={nowISO}
                    timezone={scope.timezone}
                    timeFormat={scope.timeFormat}
                    language={language}
                    aprobadas={aprobadas}
                    onVerJornada={setSelected}
                  />

                  <FaltasDeLaSemana
                    faltas={faltasVisibles}
                    nombres={names}
                    timezone={scope.timezone}
                    timeFormat={scope.timeFormat}
                    language={language}
                    onVino={setFaltaElegida}
                    onPorQue={setFaltaAExplicar}
                  />

                  {/*
                    `stretch` Y NO `flex-start`: todas las casillas de un renglón miden lo que
                    la más alta, y con el número abajo (ver `StatTile`) los números quedan en
                    la misma línea. Con `flex-start` cada casilla medía lo que su rótulo, y
                    «Dentro ahora» y «Horas extra (informativo)», de dos líneas, dejaban la
                    fila en escalera.
                  */}
                  <Row gap={spacing.sm} wrap align="stretch">
                    {/*
                      LA ÚNICA CASILLA VERDE, y es la excepción a la regla de esta fila —«tono
                      solo cuando el número pide acción»— a propósito: no pide acción, pero es
                      el único número de la pantalla que está VIVO. Se distingue del resto
                      porque se lee distinto: los demás son lo que pasó, este es lo que pasa.
                    */}
                    {enCursoAhora.personas > 0 ? (
                      <StatTile
                        label={t('timesheet.liveTile')}
                        value={minutesToHHmm(enCursoAhora.minutos)}
                        detalle={t('timesheet.livePeople', { count: enCursoAhora.personas })}
                        icon="radio-button-on"
                        tone="working"
                        tintada
                        testID="total-en-curso"
                      />
                    ) : null}
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
                      detalle={
                        diasPorRevisar > 0
                          ? t('timesheet.overtimePendingDays', { count: diasPorRevisar })
                          : undefined
                      }
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
                      value={String(porRevisar)}
                      /*
                       * EL UNICO TONO DE ESTA FILA, y por eso funciona: una jornada sin
                       * cerrar es lo que hay que atender hoy. Con las otras cinco tenidas
                       * tambien, esta no destacaba sobre nada.
                       */
                      tone={porRevisar > 0 ? 'late' : undefined}
                      icon="alert-circle"
                      testID="total-por-revisar"
                    />
                    <StatTile
                      label={t('timesheet.absences.tile')}
                      value={String(faltasVisibles.length)}
                      detalle={detalleDeFaltas(t, faltasVisibles)}
                      tone={tonoDelTotalDeFaltas(faltasVisibles)}
                      icon="person-remove-outline"
                      testID="total-faltas"
                    />
                  </Row>

                  {/*
                    LAS ACCIONES DEL PERIODO, SIN TARJETA Y SIN REPETIR LA SEMANA.

                    Esto era una tarjeta con el rótulo «Periodo», las fechas
                    «2026-09-21 – 2026-09-27» y su insignia, encima de los botones. Las
                    fechas ya las dice el navegador de semana dos filas más arriba, con
                    palabras en vez de números («Semana del 21 de septiembre»), así que la
                    tarjeta gastaba 150 px en repetir lo que ya estaba dicho —justo encima
                    de la hoja, que es lo que se viene a ver: la primera fila empezaba
                    pasados los 790 px de 768 de pantalla—.

                    Lo que SÍ aportaba se queda: la insignia de estado del periodo
                    —abierto, aprobado, reabierto— que no está en ningún otro sitio, y los
                    botones.
                  */}
                  <Row
                    gap={spacing.sm}
                    wrap
                    align="center"
                    style={estilosDelPeriodo.barraDelPeriodo}
                  >
                    <StatusBadge
                      label={
                        periodStatus === 'approved'
                          ? t('timesheet.statusApproved')
                          : periodStatus === 'reopened'
                            ? t('timesheet.statusReopened')
                            : t('timesheet.statusOpen')
                      }
                      tone={periodStatus === 'approved' ? 'working' : 'info'}
                      icon={periodStatus === 'approved' ? 'checkmark-circle' : 'lock-open-outline'}
                      compact
                    />
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
                      onPress={() => {
                        // Lo que falló la vez anterior no es de este fichaje.
                        mutations.addEvent.reset();
                        mutations.manualEntry.reset();
                        setManualOpen(true);
                      }}
                      fullWidth={false}
                      testID="timesheet-manual"
                    />
                  </Row>

                  <>
                    {/*
                      HORAS CAMBIADAS DESPUÉS DE APROBAR (auditoría, 4-oct). El servidor las
                      anota en la semana; aquí se dicen al lado de «Aprobada», que es donde
                      se mira antes de exportar la nómina.
                    */}
                    {periodoAprobado &&
                    (period.data?.changes_after_approval ?? 0) > 0 &&
                    typeof period.data?.changed_after_approval_at === 'string' ? (
                      <InlineNotice
                        tone="warning"
                        icon="create-outline"
                        title={t('timesheet.changedAfterApprovalTitle', {
                          count: period.data.changes_after_approval ?? 0,
                        })}
                        body={t('timesheet.changedAfterApprovalBody', {
                          date: formatDateKeyShort(
                            dateKeyOf(period.data.changed_after_approval_at, scope.timezone),
                            language,
                          ),
                          time: formatClockTime(
                            period.data.changed_after_approval_at,
                            scope.timezone,
                            scope.timeFormat,
                            language,
                          ),
                        })}
                        testID="timesheet-changed-after-approval"
                      />
                    ) : null}
                    {/*
                      EL MOTIVO DE VERDAD, con nombres. Aquí decía siempre «Hay fichajes que
                      necesitan revisión», fuera cual fuera el error: lo vio Andree el 30-sep y
                      era falso —el periodo ni siquiera se podía crear—.
                    */}
                    {mutations.approve.error !== null ? (
                      <InlineNotice
                        tone="late"
                        icon="warning-outline"
                        title={t('timesheet.approveBlockedTitle')}
                        body={
                          mutations.approve.error instanceof PeriodoBloqueado &&
                          mutations.approve.error.motivo === 'JORNADAS_ABIERTAS'
                            ? t('timesheet.approveBlockedOpen', {
                                count: mutations.approve.error.nombres.length,
                                names: mutations.approve.error.nombres.join(', '),
                              })
                            : adminErrorKind(mutations.approve.error) === 'forbidden'
                              ? t('states.noAccessBody')
                              : t('timesheet.approveFailedBody')
                        }
                        testID="timesheet-approve-error"
                      />
                    ) : null}
                    {mutations.reopen.error !== null ? (
                      <InlineNotice
                        tone="late"
                        icon="warning-outline"
                        title={t('timesheet.reopenFailedTitle')}
                        body={
                          adminErrorKind(mutations.reopen.error) === 'forbidden'
                            ? t('states.noAccessBody')
                            : t('timesheet.approveFailedBody')
                        }
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
                  </>

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
          enCurso={enCursoPorSesion.get(selected.id)}
          nowISO={nowISO}
          semanaAprobada={periodoAprobado}
          error={
            (mutations.adjust.isError && !conflict) ||
            mutations.reclassify.isError ||
            mutacionesDeFaltas.deshacerCumplido.isError
              ? t('errors.generic')
              : null
          }
          timezone={scope.timezone}
          timeFormat={scope.timeFormat}
          language={language}
          saving={mutations.adjust.isPending}
          conflict={conflict}
          /*
           * Sin comprobación de permiso aquí, igual que el formulario de corrección de
           * arriba: quien manda es el servidor, que exige mandar en esa sede. Y a esta
           * pantalla solo se llega por `(manager)`, con la sede elegida de entre las
           * propias, así que el caso de alguien que ve el botón y no puede usarlo no
           * existe por la ruta normal.
           */
          onUndoCredit={
            selected.shift_id === null
              ? undefined
              : () =>
                  mutacionesDeFaltas.deshacerCumplido.mutate(selected.shift_id ?? '', {
                    onSuccess: () => {
                      cerrarDetalle();
                      setFeedback(t('credit.undone'));
                    },
                  })
          }
          undoingCredit={mutacionesDeFaltas.deshacerCumplido.isPending}
          onReclassifyDeparture={({ eventId, breakReason }) =>
            mutations.reclassify.mutate(
              { eventId, breakReason, reason: t('timesheet.reclassifyDefaultReason') },
              {
                onSuccess: () => {
                  cerrarDetalle();
                  setFeedback(t('timesheet.reclassified'));
                },
              },
            )
          }
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
                  cerrarDetalle();
                  setFeedback(t('timesheet.corrected'));
                },
              },
            )
          }
          seccionHoraExtra={
            selected.ends_at === null ? undefined : (
              <HoraExtraDelDia
                key={`${selected.id}-${aprobadas.get(claveSeleccionada) ?? 0}`}
                netosDelDia={netosPorDia.get(claveSeleccionada) ?? selected.net_minutes ?? 0}
                planificados={planificado.get(claveSeleccionada)}
                aprobados={aprobadas.get(claveSeleccionada) ?? 0}
                refrigerioSinMarcar={refrigerioSinMarcar}
                saving={guardarHoraExtra.isPending}
                failed={guardarHoraExtra.isError}
                onGuardar={(minutos) =>
                  guardarHoraExtra.mutate(
                    {
                      employeeId: selected.employee_id,
                      workDate: dateKeyOf(selected.starts_at, scope.timezone),
                      minutes: minutos,
                      yaHabia: aprobadas.has(claveSeleccionada),
                    },
                    {
                      onSuccess: () => {
                        cerrarDetalle();
                        setFeedback(
                          minutos > 0
                            ? t('timesheet.overtimeSaved')
                            : t('timesheet.overtimeRemoved'),
                        );
                      },
                    },
                  )
                }
              />
            )
          }
          onClose={() => cerrarDetalle()}
        />
      ) : null}

      {faltaElegida === null ? null : (
        <RegistrarQueVinoSheet
          key={faltaElegida.id}
          falta={faltaElegida}
          nombre={names.get(faltaElegida.employeeId) ?? t('team.unknownEmployee')}
          timezone={scope.timezone}
          language={language}
          ahoraISO={nowISO}
          guardando={mutations.vino.isPending}
          onGuardar={async ({ entradaISO, salidaISO, motivo }) => {
            // Entrada y salida de una vez: ver `registrarQueVino`. La falta es del turno.
            await mutations.vino.mutateAsync({
              shiftId: faltaElegida.id,
              startsAt: entradaISO,
              endsAt: salidaISO,
              reason: motivo,
            });
            setFaltaElegida(null);
            setFeedback(t('timesheet.absences.registered'));
          }}
          onClose={() => setFaltaElegida(null)}
        />
      )}

      {faltaAExplicar === null ? null : (
        <JustificarFaltaSheet
          key={faltaAExplicar.id}
          falta={faltaAExplicar}
          nombre={names.get(faltaAExplicar.employeeId) ?? t('team.unknownEmployee')}
          timezone={scope.timezone}
          timeFormat={scope.timeFormat}
          language={language}
          guardando={
            mutacionesDeFaltas.justificar.isPending || mutacionesDeFaltas.darPorCumplido.isPending
          }
          quitando={mutacionesDeFaltas.quitar.isPending}
          onGuardar={async (respuesta) => {
            if (respuesta.kind === 'credit') {
              await mutacionesDeFaltas.darPorCumplido.mutateAsync({
                shiftId: faltaAExplicar.id,
                reason: respuesta.reason,
                note: respuesta.note,
              });
              setFaltaAExplicar(null);
              setFeedback(t('absence.creditSaved'));
              return;
            }
            await mutacionesDeFaltas.justificar.mutateAsync({
              shiftId: faltaAExplicar.id,
              kind: respuesta.kind,
              reason: respuesta.reason,
              note: respuesta.note,
            });
            setFaltaAExplicar(null);
            setFeedback(t('absence.saved'));
          }}
          onQuitar={async () => {
            await mutacionesDeFaltas.quitar.mutateAsync(faltaAExplicar.id);
            setFaltaAExplicar(null);
            setFeedback(t('absence.saved'));
          }}
          onClose={() => setFaltaAExplicar(null)}
        />
      )}

      {manualOpen ? (
        <ManualEntrySheet
          employees={employeeOptions}
          days={diasDelFichajeManual}
          openDayByEmployee={diaDeLaJornadaAbierta}
          isFuture={(dia, hora) => {
            const instante = localDateTimeToInstant(dia, hora, scope.timezone);
            return instante !== null && Date.parse(instante) > Date.parse(nowISO) + 5 * 60_000;
          }}
          saving={mutations.manualEntry.isPending || mutations.addEvent.isPending}
          error={
            mutations.addEvent.error !== null
              ? porQueNoSeRegistro(t, mutations.addEvent.error, mutations.addEvent.variables)
              : mutations.manualEntry.error !== null
                ? porQueNoSeRegistro(t, mutations.manualEntry.error, undefined)
                : null
          }
          onSubmit={({ employeeId, kind, dateKey: targetDate, time, reason }) => {
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

/**
 * POR QUÉ NO SE REGISTRÓ UN FICHAJE MANUAL, en palabras de quien lo pone (4-oct). El caso de
 * verdad es el de la transición: el servidor lo dice con los estados en inglés —«estaba en
 * WORKING: no cabe un clock_in»—, y lo que significa es que a esa hora ya tenía una entrada.
 */
function porQueNoSeRegistro(
  t: TFunction,
  error: unknown,
  fichaje: { eventType: string } | undefined,
): string {
  if (adminErrorKind(error) === 'forbidden') return t('states.noAccessBody');
  const codigo = error instanceof AdminError ? error.code : '';
  if (codigo.endsWith('failed-precondition') && fichaje !== undefined) {
    return fichaje.eventType === 'clock_in'
      ? t('timesheet.manualEntryAlreadyIn')
      : t('timesheet.manualEntryNotIn');
  }
  return t('timesheet.manualEntryFailed');
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

/**
 * La barra de acciones del periodo. Se apoya en `hundido` —el plano que agrupa dentro de
 * una superficie sin dibujar otro marco— para que se lea como una sola cosa sin volver a
 * ser la tarjeta que era.
 */
const useEstilosDeHoras = estilosDelTema((colors) => ({
  barraDelPeriodo: {
    backgroundColor: colors.hundido,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
}));

/** Cuántas semanas hay de una a otra, para abrir Horas en la semana del aviso. */
function semanasHasta(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / (7 * 86_400_000),
  );
}
