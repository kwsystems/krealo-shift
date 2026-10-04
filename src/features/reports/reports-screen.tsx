import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { feriadoDe } from '@/domain/feriados-peru';
import { aprobadasPorDia, useHorasExtra } from '@/features/timesheets/horas-extra';

import {
  hoursByEmployee,
  minutesByDay,
  minutesByReason,
  minutosEnFeriados,
  punctuality,
} from './aggregate';
import {
  breakMinutesByEmployee,
  buildExportRows,
  buildReportCsv,
  buildReportSummary,
  reportFileName,
} from './export';
import { useBreakTimeByReason } from './hooks';
import { useCorrecciones } from './correcciones';
import { useJornadasAlDia } from '@/features/timesheets/jornadas-al-dia';
import { CasillaDeCorrecciones } from './casilla-de-correcciones';
import { diasEntre, periodoDe, periodoDeDias, semanasDelMes, type TipoDePeriodo } from './periodo';
import { useSesionesDeLosDias, useSoloLosDias } from './use-solo-los-dias';
import { BotonDeDiasElegidos, ElegirDiasSheet } from './elegir-dias-sheet';
import { etiquetaDeDias, etiquetaDelPeriodo } from './etiqueta-del-periodo';
import { bonoDeAsistencia } from './bono';
import { useInicioDelReloj } from '@/features/schedules/horario-cumplido';
import { contarFaltas, faltasDeLosTurnos, faltasPorPersona } from '@/features/timesheets/faltas';
import { useHorasDebidasDeLaSede } from '@/features/timesheets/horas-debidas';
import { useJustificaciones } from '@/features/timesheets/justificaciones';
import { detalleDeFaltas, tonoDelTotalDeFaltas } from '@/features/timesheets/textos-de-falta';
import { BonoCard } from './bono-card';
import { AsistenciaPorPersona, type FilaDeAsistencia } from './asistencia-por-persona';
import { incidenciasDelPeriodo } from './incidencias';
import { IncidenciasDelPeriodo } from './incidencias-del-periodo';
import { programadoDelPeriodo } from './programado';
import { ResumenDelPeriodo } from './resumen-del-periodo';
import { dentroPorEmpleado, enCursoPorSesionDe } from '@/features/timesheets/en-curso';
import { useWorkingNow } from '@/hooks/use-manager-dashboard';
import { fetchWeekShifts } from '@/features/schedules/api';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';
import { ShareReportSheet } from './share-sheet';
import { AsyncSection } from '@/components/schedule/data-states';
import { InlineNotice, SegmentedControl, StatTile } from '@/components/schedule/fields';
import { DayNavigator, MonthNavigator, WeekNavigator } from '@/components/schedule/week-tools';
import { ChartCard } from '@/components/charts/chart-frame';
import { DayColumns, type DayColumn } from '@/components/charts/day-columns';
import { RankingBars, type RankingRow } from '@/components/charts/ranking-bars';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import {
  addDaysToKey,
  dateKeyOf,
  formatDateKeyLong,
  formatDateKeyShort,
  formatDayColumn,
  formatWeekdayShort,
  type DateKey,
} from '@/features/schedules/week';
import { useEmployeeNames, useEmployees } from '@/features/team/hooks';
import {
  useDailySummaries,
  useSesionesAlDiaCon,
  useWorkSessions,
} from '@/features/timesheets/hooks';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { track } from '@/lib/analytics';
import { CSV_BOM } from '@/features/timesheets/csv';
import { compartirArchivo } from '@/lib/compartir/archivo';
import { currentLanguage } from '@/i18n';
import { breakReasonLabels } from '@/i18n/break-reason-labels';
import { chart, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { minutesToHHmm } from '@/utils/time';

/**
 * Reportes (pedido de Andree, 2026-09-15: «quién produce más», «importantísimo»).
 *
 * SE LLAMA HORAS TRABAJADAS Y NO PRODUCTIVIDAD, Y NO ES UN MATIZ
 * Esta app mide cuándo entra y sale la gente. Eso son horas presentes, no trabajo
 * hecho: quien atiende la caja en hora punta y quien está de pie en una tienda vacía
 * marcan lo mismo. Titular esta pantalla "productividad" haría que el número de
 * arriba se leyera como un juicio sobre las personas, y llevaría a decidir ascensos y
 * despidos con una cifra que no mide nada de eso. El ranking dice quién acumuló más
 * horas en el periodo, que es un dato útil y verdadero, y lo dice con esas palabras.
 *
 * POR QUÉ ES PESTAÑA PROPIA Y NO UNA ENTRADA DENTRO DE «MÁS»
 * Porque se pidió como importantísimo, y lo que vive dentro de «Más» se abre una vez
 * el primer día y no se vuelve a abrir. Un tablero que hay que buscar no se mira.
 *
 * EL PERIODO ES LA MISMA SEMANA QUE HORAS, con la misma navegación, y los datos salen
 * de las mismas dos consultas. Así «cuadra con Horas» no es algo que haya que vigilar
 * en cada cambio: es lo único que la pantalla puede hacer.
 */

type Señalado = { titulo: string; detalle: string } | null;

export function ReportsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const scope = useManagerScope();
  const language = currentLanguage();
  const now = useLiveClock('minute');

  /*
   * SEMANA O MES. Por semana sigue siendo lo de siempre; por mes, todo el reporte se
   * calcula sobre el mes civil. Ver `periodo.ts`. Cambiar de uno a otro vuelve al actual:
   * «tres semanas atrás» no significa nada contado en meses.
   */
  const [tipo, setTipo] = useState<TipoDePeriodo>('semana');
  const [offset, setOffset] = useState(0);
  const [señalado, setSeñalado] = useState<Señalado>(null);
  const [compartirAbierto, setCompartirAbierto] = useState(false);
  const [personaElegida, setPersonaElegida] = useState<string | null>(null);
  const [motivoAbierto, setMotivoAbierto] = useState<string | null>(null);
  /* Los días elegidos en el calendario, y si la hoja de elegirlos está abierta. */
  const [diasElegidos, setDiasElegidos] = useState<DateKey[]>([]);
  const [eligiendoDias, setEligiendoDias] = useState(false);

  const nowISO = now.toISOString();
  // Hoy en la zona de la SEDE, no en la del navegador: un gerente que mira el tablero
  // desde otro huso subrayaria el dia equivocado.
  const hoyKey = dateKeyOf(nowISO, scope.timezone);
  const periodo =
    (tipo === 'dias' ? periodoDeDias(diasElegidos, scope.timezone) : null) ??
    periodoDe({
      tipo,
      offset,
      nowISO,
      weekStartsOn: scope.weekStartsOn,
      timezone: scope.timezone,
    });
  const { from, to } = periodo;
  /*
   * CON DÍAS SUELTOS, las consultas traen del primero al último y aquí se quitan los que
   * no se eligieron. Ver `soloLosDias`: es texto para poder ser dependencia de un memo.
   */
  const soloDias = periodo.seguidos ? null : periodo.dias.join(',');
  /*
   * Sin `useMemo`, a proposito, y aqui y en `dias` por la misma razon.
   *
   * El React Compiler ya memoriza este componente entero. Con el `useMemo` escrito a
   * mano puesto, el compilador NO PODIA conservarlo —`weekDays(weekStart)` produce un
   * array que luego entra en una funcion importada, y desde fuera no puede probar que
   * no lo modifique— y ante la duda se rendia con el componente COMPLETO: cero
   * memorizacion en toda la pantalla, que es lo contrario de lo que el `useMemo`
   * buscaba. Lo dice `react-hooks/preserve-manual-memoization`, que aqui esta como
   * error. Quitandolo, memoriza el compilador y memoriza todo.
   */
  const range = { fromISO: periodo.fromISO, toISO: periodo.toISO };

  const organizationId = scope.organization?.id ?? null;
  const summaries = useDailySummaries({ locationId: scope.locationId, from, to });
  const sessions = useWorkSessions({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    fromISO: range.fromISO,
    toISO: range.toISO,
    cacheKey: { from, to },
  });
  const breaks = useBreakTimeByReason({ locationId: scope.locationId, from, to });
  const correcciones = useCorrecciones({ locationId: scope.locationId, from, to });
  // Las jornadas del periodo, al día con el horario publicado antes de contar tardanzas.
  useJornadasAlDia({ locationId: scope.locationId, from, to });
  const names = useEmployeeNames(organizationId);

  /*
   * LOS TURNOS DEL PERIODO: para saber a qué tenía que venir cada uno. Los pide el bono
   * —solo por mes, con los empleados: su estado y su fecha de alta— y, desde el 1-oct, las
   * FALTAS, en cualquier periodo. Las jornadas ya están arriba (`sessions`), sin el filtro
   * de persona: el bono es de todos. Ver `bono.ts` y `timesheets/faltas.ts`.
   */
  const turnosDelMes = useQuery({
    queryKey: ['reports', 'turnos', scope.locationId ?? 'none', from, to],
    queryFn: () =>
      fetchWeekShifts({
        organizationId: organizationId ?? '',
        locationId: scope.locationId ?? '',
        fromISO: periodo.fromISO,
        toISO: periodo.toISO,
      }),
    enabled: scope.locationId !== null && organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
  const empleados = useEmployees(organizationId);
  const inicioDelReloj = useInicioDelReloj({
    organizationId,
    locationId: scope.locationId,
    timezone: scope.timezone,
    enabled: true,
  });
  const relojDesde = inicioDelReloj.data;

  const nombre = (employeeId: string) => names.get(employeeId) ?? t('reports.unknownPerson');
  const etiquetaMotivo = breakReasonLabels(t);

  /*
   * Las horas extra APROBADAS del periodo, las mismas que suma Horas: extra es lo que
   * quien gestiona aprobó, no lo que pasa de un umbral (30-sep, ver `horas-extra.ts`).
   */
  const horasExtra = useHorasExtra({ organizationId, locationId: scope.locationId, from, to });
  const aprobadas = useMemo(() => aprobadasPorDia(horasExtra.data ?? []), [horasExtra.data]);
  const filasResumen = useSoloLosDias(summaries.data, soloDias);
  const filasSesiones = useSesionesDeLosDias(sessions.data, soloDias, scope.timezone);
  const filasPausas = useSoloLosDias(breaks.data, soloDias);
  const filasCorrecciones = useSoloLosDias(correcciones.data, soloDias);

  const ranking = useMemo(
    () => hoursByEmployee(filasResumen, aprobadas),
    [filasResumen, aprobadas],
  );
  /*
   * Tocar a alguien en el ranking FILTRA el resto del tablero a esa persona.
   *
   * Es lo que convierte cuatro graficos sueltos en algo con lo que se investiga: se ve
   * quien acumulo mas horas, se toca, y las otras tres responden «asi fue su semana,
   * estas fueron sus tardanzas, en esto se le fue el tiempo». Sin esto, la pregunta
   * siguiente —la unica que de verdad se hace uno— no tiene respuesta en la pantalla.
   *
   * El RANKING no se filtra, a proposito: dejarlo en una sola barra seria un grafico
   * de una barra, que no compara nada. Se queda entero con la fila resaltada, que
   * ademas es lo que permite salir del filtro tocando otra vez.
   */
  const resumenFiltrado = useMemo(
    () =>
      personaElegida === null
        ? filasResumen
        : filasResumen.filter((fila) => fila.employee_id === personaElegida),
    [filasResumen, personaElegida],
  );
  const sesionesFiltradas = useMemo(
    () =>
      personaElegida === null
        ? filasSesiones
        : filasSesiones.filter((fila) => fila.employee_id === personaElegida),
    [filasSesiones, personaElegida],
  );
  const pausasFiltradas = useMemo(
    () =>
      personaElegida === null
        ? filasPausas
        : filasPausas.filter((fila) => fila.employee_id === personaElegida),
    [filasPausas, personaElegida],
  );

  /*
   * LAS FALTAS DEL PERIODO (1-oct), con la regla de toda la app: un turno publicado que
   * terminó sin ninguna marca, desde que la sede usa el reloj. Solo de los días elegidos, y
   * solo de quien se tocó en el ranking, como el resto del tablero.
   */
  // Con lo que se dijo de cada una (2-oct): la misma consulta que Horas, Horario y Equipo.
  const justificaciones = useJustificaciones(organizationId, scope.locationId);
  const faltasDelPeriodo =
    sessions.data === undefined
      ? []
      : faltasDeLosTurnos({
          turnos: turnosDelMes.data ?? [],
          jornadas: sessions.data,
          relojDesde: () => relojDesde,
          ahoraISO: nowISO,
          timezone: scope.timezone,
          resoluciones: justificaciones.data ?? [],
        }).filter((falta) => periodo.dias.includes(falta.dia));
  /*
   * «—» MIENTRAS NO SE SABE (auditoría, 4-oct). Con las jornadas, los turnos, el reloj o lo
   * que se dijo de cada falta todavía cargando, la casilla decía «Faltas 0» —y en rojo las
   * que ya estaban justificadas—: una cifra tranquilizadora o alarmante que no era ninguna.
   */
  const faltasCargando =
    sessions.isPending ||
    turnosDelMes.isPending ||
    inicioDelReloj.isPending ||
    justificaciones.isPending;
  const faltasFiltradas =
    personaElegida === null
      ? faltasDelPeriodo
      : faltasDelPeriodo.filter((falta) => falta.employeeId === personaElegida);
  const faltasPorPersonaDelPeriodo = faltasPorPersona(faltasDelPeriodo);

  /*
   * TODO LO QUE PASÓ, Y CÓMO QUEDÓ (4-oct): faltas, tardanzas, salidas antes, horas que debe
   * y cumplidos especiales. Las mismas faltas y las mismas jornadas que el resto del tablero
   * —así «Llegó tarde» y «A tiempo» cuentan lo mismo—; las horas que debe, las de la sede.
   */
  const debidasDeLaSede = useHorasDebidasDeLaSede({ organizationId, locationId: scope.locationId });
  const incidencias = incidenciasDelPeriodo({
    faltas: faltasDelPeriodo,
    sesiones: filasSesiones,
    turnos: turnosDelMes.data ?? [],
    debidas: debidasDeLaSede.data ?? [],
    dias: periodo.dias,
    timezone: scope.timezone,
  });
  const incidenciasFiltradas =
    personaElegida === null
      ? incidencias
      : incidencias.filter((incidencia) => incidencia.employeeId === personaElegida);

  /*
   * LO PROGRAMADO Y LO QUE VA EN CURSO (2-oct): lo que dice «Cómo va». Lo programado son
   * los turnos publicados de los días que se miran (`programado.ts`); lo en curso, la misma
   * cuenta de Horas y Equipo (`dentroPorEmpleado`), y solo si el periodo llega a hoy.
   */
  const incluyeHoy = periodo.dias.includes(hoyKey);
  const workingNow = useWorkingNow(incluyeHoy ? scope.locationId : null);
  // Una salida o un descanso cambian quién está dentro (2-oct): lo mismo que hacen Horas y
  // Equipo, para que Reportes no siga contando dentro a quien ya se fue.
  useSesionesAlDiaCon(incluyeHoy ? scope.locationId : null, workingNow.data);
  const programado = programadoDelPeriodo({
    turnos: turnosDelMes.data ?? [],
    dias: periodo.dias,
    ahoraISO: nowISO,
    timezone: scope.timezone,
  });
  const dentro = incluyeHoy
    ? dentroPorEmpleado(sessions.data ?? [], enCursoPorSesionDe(workingNow.data), nowISO)
    : new Map<string, { minutos: number }>();
  /*
   * CON UNA PERSONA ELEGIDA, LAS CIFRAS DEL TOTAL SON SUYAS (auditoría, 4-oct). Se mezclaban:
   * el total, «Personas» y «Extra» seguían siendo de toda la tienda mientras «A tiempo» ya
   * era suyo, y las columnas comparaban sus horas con lo programado de todo el equipo. Lo
   * que habla de la tienda entera —los rankings y la tabla por persona— no se filtra: con
   * una sola barra no comparan nada.
   */
  const programadoFiltrado =
    personaElegida === null
      ? programado
      : programadoDelPeriodo({
          turnos: (turnosDelMes.data ?? []).filter((turno) => turno.employee_id === personaElegida),
          dias: periodo.dias,
          ahoraISO: nowISO,
          timezone: scope.timezone,
        });
  const dentroFiltrado =
    personaElegida === null
      ? [...dentro.values()]
      : [...dentro.entries()].filter(([id]) => id === personaElegida).map(([, valor]) => valor);
  const enCursoTotal = {
    personas: dentroFiltrado.length,
    minutos: dentroFiltrado.reduce((suma, persona) => suma + persona.minutos, 0),
  };

  const dias = minutesByDay(resumenFiltrado, periodo.dias);
  /* Lo trabajado en feriados, y si el periodo tiene alguno: ver `minutosEnFeriados`. */
  const enFeriados = minutosEnFeriados(resumenFiltrado, scope.timezone);
  const conFeriado = periodo.dias.some((dia) => feriadoDe(dia, scope.timezone) !== null);
  const puntualidad = useMemo(() => punctuality(sesionesFiltradas), [sesionesFiltradas]);
  // La de todos, para la tabla por persona y el ranking de tardanzas: no se filtran.
  const puntualidadDeTodos = useMemo(() => punctuality(filasSesiones), [filasSesiones]);
  const motivos = useMemo(() => minutesByReason(pausasFiltradas), [pausasFiltradas]);
  // Para el resumen que se comparte: los motivos del local entero, sin filtro.
  const motivosSinFiltrar = useMemo(() => minutesByReason(filasPausas), [filasPausas]);

  const rankingFiltrado =
    personaElegida === null
      ? ranking
      : ranking.filter((fila) => fila.employeeId === personaElegida);
  const totalMinutos = rankingFiltrado.reduce((suma, fila) => suma + fila.netMinutes, 0);
  const extraMinutos = rankingFiltrado.reduce((suma, fila) => suma + fila.overtimeMinutes, 0);
  const conExtra = ranking.filter((fila) => fila.overtimeMinutes > 0);

  // Sin `useMemo`, como `dias` y `range`: ver el comentario de `range`, arriba.
  const bonoDelMes = bonoDeAsistencia({
    turnos: turnosDelMes.data ?? [],
    sesiones: filasSesiones,
    empleados: empleados.data ?? [],
    desde: from,
    finISO: periodo.toISO,
    nowISO,
    timezone: scope.timezone,
    relojDesde,
    resoluciones: justificaciones.data ?? [],
  });

  const cargando = summaries.isPending || sessions.isPending;
  const error = summaries.error ?? sessions.error;

  // ------------------------------------------------------------- asistencia
  /*
   * Una fila por persona que trabajó, tenía turno, faltó o está dentro: las cuatro cosas,
   * porque quien no vino ningún día también tiene que salir —con cero—.
   */
  const puntualPorPersona = new Map(
    puntualidadDeTodos.byEmployee.map((fila) => [fila.employeeId, fila]),
  );
  const rankingPorPersona = new Map(ranking.map((fila) => [fila.employeeId, fila]));
  const idsDeAsistencia = new Set([
    ...ranking.map((fila) => fila.employeeId),
    ...programado.porPersona.keys(),
    ...faltasPorPersonaDelPeriodo.keys(),
    ...dentro.keys(),
  ]);
  const filasAsistencia: FilaDeAsistencia[] = [...idsDeAsistencia]
    .map((employeeId) => {
      const horas = rankingPorPersona.get(employeeId);
      const plan = programado.porPersona.get(employeeId);
      const puntual = puntualPorPersona.get(employeeId);
      return {
        employeeId,
        nombre: nombre(employeeId),
        trabajado: horas?.netMinutes ?? 0,
        enCurso: dentro.get(employeeId)?.minutos ?? 0,
        programado: plan?.total ?? 0,
        programadoHastaAhora: plan?.hastaAhora ?? 0,
        medidos: puntual?.measured ?? 0,
        tardanzas: puntual?.late ?? 0,
        faltas: faltasPorPersonaDelPeriodo.get(employeeId)?.length ?? 0,
        faltasJustificadas: contarFaltas(faltasPorPersonaDelPeriodo.get(employeeId) ?? [])
          .justificadas,
        extra: horas?.overtimeMinutes ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.trabajado + b.enCurso - (a.trabajado + a.enCurso) ||
        b.programado - a.programado ||
        a.nombre.localeCompare(b.nombre),
    );

  // --------------------------------------------------------------- ranking
  const filasRanking: RankingRow[] = ranking.map((fila) => ({
    id: fila.employeeId,
    label: nombre(fila.employeeId),
    valueText: minutesToHHmm(fila.netMinutes),
    hint: t('reports.daysWorked', { count: fila.days }),
    segments: [
      { value: fila.netMinutes, color: chart(colors).series1, label: t('reports.worked') },
    ],
  }));
  const maxRanking = ranking[0]?.netMinutes ?? 0;

  // ------------------------------------------------------------ horas extra
  const filasExtra: RankingRow[] = conExtra.map((fila) => ({
    id: fila.employeeId,
    label: nombre(fila.employeeId),
    valueText: minutesToHHmm(fila.overtimeMinutes),
    hint: t('reports.ofTotal', { total: minutesToHHmm(fila.netMinutes) }),
    // Dos series de verdad —normales y extra— así que se apilan, con leyenda
    // obligatoria y un hueco de superficie entre las dos.
    segments: [
      { value: fila.regularMinutes, color: chart(colors).series1, label: t('reports.regular') },
      { value: fila.overtimeMinutes, color: chart(colors).series2, label: t('reports.overtime') },
    ],
  }));
  const maxExtra = Math.max(...conExtra.map((fila) => fila.netMinutes), 0);

  // ----------------------------------------------------------- puntualidad
  const filasTardanza: RankingRow[] = puntualidadDeTodos.byEmployee
    .filter((fila) => fila.late > 0)
    .map((fila) => ({
      id: fila.employeeId,
      label: nombre(fila.employeeId),
      valueText: String(fila.late),
      hint: t('reports.ofShifts', { count: fila.measured }),
      segments: [
        { value: fila.late, color: chart(colors).attention, label: t('reports.lateArrivals') },
      ],
    }));
  const maxTardanza = Math.max(...filasTardanza.map((f) => f.segments[0]?.value ?? 0), 0);

  // ---------------------------------------------------------------- faltas
  /*
   * DOS TRAMOS (2-oct): primero las que cuentan en contra —sin justificar o sin revisar—,
   * macizas en rojo; después las justificadas, huecas en ámbar. Se ordena por las que
   * cuentan en contra: es a quien hay que llamar.
   */
  const filasFalta: RankingRow[] = [...faltasPorPersona(faltasFiltradas)]
    .map(([employeeId, suyas]) => ({ employeeId, suyas, cuenta: contarFaltas(suyas) }))
    .sort(
      (a, b) => b.cuenta.sinJustificar - a.cuenta.sinJustificar || b.cuenta.total - a.cuenta.total,
    )
    .map(({ employeeId, suyas, cuenta }) => ({
      id: employeeId,
      label: nombre(employeeId),
      valueText: String(suyas.length),
      // Qué días: «lun 28, mié 30». Con más de tres, los tres primeros y cuántos más.
      hint: [
        [
          ...suyas.slice(0, 3).map((falta) => formatDateKeyShort(falta.dia, language)),
          ...(suyas.length > 3 ? [t('reports.bonusMore', { count: suyas.length - 3 })] : []),
        ].join(', '),
        cuenta.justificadas > 0
          ? t('absence.justifiedCount', { count: cuenta.justificadas })
          : null,
      ]
        .filter((parte): parte is string => parte !== null)
        .join(' · '),
      segments: [
        {
          value: cuenta.sinJustificar,
          color: chart(colors).attention,
          label: t('reports.absencesAgainst'),
        },
        {
          value: cuenta.justificadas,
          color: colors.warning50,
          borde: colors.warning600,
          label: t('reports.absencesJustified'),
        },
      ],
    }));
  const maxFalta = Math.max(
    ...filasFalta.map((f) => f.segments.reduce((suma, tramo) => suma + tramo.value, 0)),
    0,
  );
  const hayFaltasJustificadas = faltasFiltradas.some(
    (falta) => falta.resolucion?.kind === 'justified',
  );

  // --------------------------------------------------------------- motivos
  const totalPausas = motivos.reduce((suma, fila) => suma + fila.minutes, 0);
  const filasMotivo: RankingRow[] = motivos.map((fila) => ({
    id: fila.reason,
    label: etiquetaMotivo[fila.reason],
    valueText: minutesToHHmm(fila.minutes),
    hint: t('reports.reasonShare', { percent: fila.sharePercent, count: fila.pauses }),
    // Solo se puede abrir lo que tiene algo dentro: «Comida» no pide explicación, así
    // que su fila no finge ser un botón.
    pressable: fila.notes.length > 0,
    segments: [
      { value: fila.minutes, color: chart(colors).series1, label: t('reports.breakTime') },
    ],
  }));
  const maxMotivo = motivos[0]?.minutes ?? 0;
  const notasAbiertas = motivos.find((fila) => fila.reason === motivoAbierto)?.notes ?? [];
  // El único motivo que pide explicación es «Otro», pero se busca por «tiene notas» y no
  // por su nombre: el día que otro motivo las pida, esto sigue funcionando.
  const motivoConNotas = motivos.find((fila) => fila.notes.length > 0);

  // ------------------------------------------------------------------ días
  /*
   * POR MES, UNA COLUMNA POR SEMANA y no una por día. Treinta columnas en un teléfono de
   * 360 son rayas de 9 px sin rótulo que se pueda leer; cinco semanas se comparan de un
   * vistazo, que es para lo que está el gráfico.
   */
  const minutosPorDia = new Map(dias.map((dia) => [dia.dateKey, dia.netMinutes]));
  /*
   * CON DÍAS ELEGIDOS, una columna por día mientras quepan —dos semanas— y por semana
   * cuando son más, por lo mismo que el mes. Por semana se cuentan SOLO los elegidos.
   */
  const porDia = tipo === 'semana' || (tipo === 'dias' && periodo.dias.length <= 14);
  /* Lo programado de una columna, para su contorno y para lo que se lee al señalarla. */
  const conProgramado = (minutos: number) =>
    minutos > 0
      ? {
          planned: minutos,
          plannedLabel: t('reports.plannedColumn', { hours: minutesToHHmm(minutos) }),
        }
      : {};
  const columnas: DayColumn[] = porDia
    ? dias.map((dia) => ({
        key: dia.dateKey,
        short: formatDayColumn(dia.dateKey, language),
        tiny: formatWeekdayShort(dia.dateKey, language),
        long: formatDateKeyLong(dia.dateKey, language),
        value: dia.netMinutes,
        valueText: minutesToHHmm(dia.netMinutes),
        isToday: dia.dateKey === hoyKey,
        ...conProgramado(programadoFiltrado.porDia.get(dia.dateKey)?.total ?? 0),
      }))
    : semanasDelMes(periodo.dias, scope.weekStartsOn).map((semana) => {
        const minutos = semana.dias.reduce((suma, d) => suma + (minutosPorDia.get(d) ?? 0), 0);
        return {
          key: semana.inicio,
          short: `${formatDateKeyShort(semana.inicio, language)}`,
          tiny: semana.inicio.slice(8).replace(/^0/, ''),
          long:
            tipo === 'dias'
              ? t('reports.weekColumnPicked', {
                  from: formatDateKeyShort(semana.inicio, language),
                  count: semana.dias.length,
                })
              : t('reports.weekColumn', {
                  from: formatDateKeyShort(semana.inicio, language),
                  to: formatDateKeyShort(semana.fin, language),
                }),
          value: minutos,
          valueText: minutesToHHmm(minutos),
          isToday: semana.dias.includes(hoyKey),
          isFuture: semana.inicio > hoyKey,
          ...conProgramado(
            semana.dias.reduce(
              (suma, d) => suma + (programadoFiltrado.porDia.get(d)?.total ?? 0),
              0,
            ),
          ),
        };
      });

  /*
   * Compartir. El contenido se arma AQUÍ, con lo que ya está en pantalla, y no con una
   * consulta nueva: si el archivo se pidiera aparte, lo enviado y lo visto podrían ser
   * dos cosas distintas —otra semana, otra sede— y nadie se enteraría hasta que alguien
   * comparase el correo con la pantalla.
   *
   * Y se comparte SIN el filtro de persona aplicado, a propósito: el botón está fuera
   * del filtro y dice «las horas de N personas». Mandar en silencio el reporte de una
   * sola porque quedó un filtro puesto sería exactamente lo contrario de decir qué se
   * está mandando.
   */
  const pausasPorPersona = useMemo(() => breakMinutesByEmployee(filasPausas), [filasPausas]);

  const periodoLegible = etiquetaDelPeriodo(periodo, language, t);

  /*
   * LAS FILAS QUE SE VAN A MANDAR, ANTES DE MANDARLAS (auditoría, 4-oct): la hoja anunciaba
   * «N personas» contando solo a quien tuvo horas, y el CSV llevaba también a quien solo
   * faltó; y con solo faltas el botón ni se podía usar. Ahora la hoja dice cuántas filas
   * lleva el archivo, y se puede compartir si hay alguna.
   */
  const filasDeExportar = buildExportRows({
    ranking,
    nameOf: nombre,
    punctuality: puntualidadDeTodos,
    breakMinutesByEmployee: pausasPorPersona,
    absencesByEmployee: new Map(
      [...faltasPorPersonaDelPeriodo].map(([employeeId, suyas]) => [employeeId, suyas.length]),
    ),
    justifiedAbsencesByEmployee: new Map(
      [...faltasPorPersonaDelPeriodo].map(([employeeId, suyas]) => [
        employeeId,
        contarFaltas(suyas).justificadas,
      ]),
    ),
  });
  // Sin el filtro de persona: ver «Y se comparte SIN el filtro», arriba.
  const totalDeTodos = ranking.reduce((suma, fila) => suma + fila.netMinutes, 0);
  const extraDeTodos = ranking.reduce((suma, fila) => suma + fila.overtimeMinutes, 0);
  /* Con días sueltos, el nombre del archivo lo dice: si no, parecía el rango entero. */
  const nombreDelArchivo = reportFileName({
    from,
    to,
    dias: periodo.seguidos ? null : periodo.dias.length,
  });

  const compartir = useMutation({
    mutationFn: async (formato: 'csv' | 'resumen') => {
      const filas = filasDeExportar;

      if (formato === 'csv') {
        const contenido = buildReportCsv({
          rows: filas,
          labels: {
            employee: t('reports.csvEmployee'),
            days: t('reports.csvDays'),
            netHours: t('reports.csvNetHours'),
            netDecimal: t('reports.csvNetDecimal'),
            regularHours: t('reports.csvRegular'),
            overtimeHours: t('reports.csvOvertime'),
            shifts: t('reports.csvShifts'),
            lateArrivals: t('reports.csvLate'),
            absences: t('reports.csvAbsences'),
            justifiedAbsences: t('reports.csvJustifiedAbsences'),
            breakMinutes: t('reports.csvBreakMinutes'),
          },
        });
        await compartirArchivo({
          nombre: nombreDelArchivo,
          // La marca de orden de bytes, igual que en el CSV de Horas: sin ella Excel
          // abre «Núñez» como «NuÃ±ez» y el reporte se devuelve.
          contenido: `${CSV_BOM}${contenido}`,
          tipoMime: 'text/csv',
          uti: 'public.comma-separated-values-text',
          titulo: nombreDelArchivo,
        });
        return filas.length;
      }

      const texto = buildReportSummary({
        labels: {
          heading: t('reports.summaryHeading', {
            location: scope.locations.find((sede) => sede.id === scope.locationId)?.name ?? '',
            period: periodoLegible,
          }),
          totalHours: t('reports.totalHours'),
          people: t('reports.people'),
          overtime: t('reports.overtime'),
          punctuality: t('reports.onTime'),
          punctualityUnknown: t('reports.punctualityNoDataShort'),
          absences: t('reports.absences'),
          topPerson: t('reports.summaryTop'),
          topReason: t('reports.summaryTopReason'),
          footer: t('reports.summaryFooter'),
        },
        totalMinutes: totalDeTodos,
        people: filas.length,
        overtimeMinutes: extraDeTodos,
        punctuality: puntualidadDeTodos,
        absences: faltasDelPeriodo.length,
        absencesDetail: detalleDeFaltas(t, faltasDelPeriodo),
        top:
          ranking[0] === undefined
            ? null
            : { name: nombre(ranking[0].employeeId), minutes: ranking[0].netMinutes },
        topReason:
          motivosSinFiltrar[0] === undefined
            ? null
            : {
                name: etiquetaMotivo[motivosSinFiltrar[0].reason],
                minutes: motivosSinFiltrar[0].minutes,
              },
      });

      await compartirArchivo({
        nombre: periodo.seguidos
          ? t('reports.summaryFileName', { from, to })
          : t('reports.summaryFileNameDays', { from, to, count: periodo.dias.length }),
        contenido: texto,
        tipoMime: 'text/plain',
        uti: 'public.plain-text',
        titulo: t('reports.shareTitle'),
      });
      return filas.length;
    },
    /*
     * Se reutiliza `timesheet_exported` y NO se inventa un décimo evento: §31 nombra
     * nueve y hay una prueba que lo comprueba contra este archivo. Esto ES una
     * exportación de hoja de tiempo, solo que iniciada desde otra pantalla, y se miden
     * los TAMAÑOS, nunca qué se exportó ni de quién.
     */
    onSuccess: (filas) => {
      track({ name: 'timesheet_exported', rowCount: filas, dayCount: periodo.dias.length });
      setCompartirAbierto(false);
    },
  });

  const señalarFila =
    (titulo: string) =>
    (row: RankingRow | null): void => {
      if (row === null) return setSeñalado(null);
      const tramos = row.segments.filter((tramo) => tramo.value > 0);
      const detalle =
        tramos.length > 1
          ? tramos.map((tramo) => `${tramo.label} ${minutesToHHmm(tramo.value)}`).join(' · ')
          : row.valueText;
      setSeñalado({ titulo, detalle: `${row.label}: ${detalle}` });
    };

  const lectura = (titulo: string): string | null =>
    señalado !== null && señalado.titulo === titulo ? señalado.detalle : null;

  return (
    <AppScreen scroll>
      <ResponsiveContainer>
        <Stack gap={spacing.lg}>
          <Stack gap={spacing.xs}>
            <AppText variant="title" accessibilityRole="header">
              {t('reports.title')}
            </AppText>
            {/*
              La advertencia va ARRIBA y no en una nota al pie. Es lo que separa leer
              este tablero bien de leerlo mal, y una nota al pie de un tablero no la
              lee nadie.
            */}
            <AppText variant="help" tone="subtle">
              {t('reports.subtitle')}
            </AppText>
          </Stack>

          {/*
            EL PERIODO Y COMPARTIR, EN LA MISMA FILA.

            «Compartir» vive junto al periodo y no al final de la pantalla, porque lo que
            se manda es «esta semana» y el botón tiene que estar donde se ve cuál es: al
            final, después de cinco gráficos, ya nadie recuerda qué semana está mirando.
            Eso ya estaba bien pensado; lo que estaba mal era que ocupara una fila entera
            para un solo botón, justo debajo de otra fila con el navegador de semana.

            Deshabilitado mientras no hay nada que mandar, que es más honesto que
            compartir un archivo con solo la fila de cabecera.
          */}
          <Row gap={spacing.md} wrap align="center" justify="space-between">
            <Row gap={spacing.md} wrap align="center" style={estilosDeCabecera.encoge}>
              {tipo === 'dia' ? (
                <DayNavigator
                  day={from}
                  language={language}
                  isToday={offset === 0}
                  onPrevious={() => setOffset((valor) => valor - 1)}
                  onNext={() => setOffset((valor) => valor + 1)}
                  onGoToToday={() => setOffset(0)}
                />
              ) : tipo === 'dias' ? (
                <BotonDeDiasElegidos
                  etiqueta={etiquetaDeDias(periodo, language, t)}
                  onPress={() => setEligiendoDias(true)}
                />
              ) : tipo === 'semana' ? (
                <WeekNavigator
                  weekStart={from}
                  language={language}
                  isCurrentWeek={offset === 0}
                  onPrevious={() => setOffset((valor) => valor - 1)}
                  onNext={() => setOffset((valor) => valor + 1)}
                  onGoToCurrent={() => setOffset(0)}
                />
              ) : (
                <MonthNavigator
                  monthStart={from}
                  language={language}
                  isCurrentMonth={offset === 0}
                  onPrevious={() => setOffset((valor) => valor - 1)}
                  onNext={() => setOffset((valor) => valor + 1)}
                  onGoToCurrent={() => setOffset(0)}
                />
              )}
              <SegmentedControl
                label={t('reports.periodType')}
                value={tipo}
                options={[
                  { value: 'dia', label: t('reports.periodDay') },
                  { value: 'semana', label: t('reports.periodWeek') },
                  { value: 'mes', label: t('reports.periodMonth') },
                  { value: 'dias', label: t('reports.periodDays') },
                ]}
                onChange={(valor) => {
                  setTipo(valor);
                  setOffset(0);
                  setSeñalado(null);
                  /*
                   * «Elegir días» abre el calendario con la última semana ya marcada: así
                   * el reporte de detrás nunca está vacío, y lo normal —«estos días de
                   * aquí»— es quitar o añadir alguno, no empezar de cero.
                   */
                  if (valor === 'dias') {
                    if (diasElegidos.length === 0) {
                      setDiasElegidos(diasEntre(addDaysToKey(hoyKey, -6), hoyKey));
                    }
                    setEligiendoDias(true);
                  }
                }}
                testID="report-period"
              />
            </Row>
            <SecondaryButton
              label={t('reports.share')}
              onPress={() => setCompartirAbierto(true)}
              disabled={filasDeExportar.length === 0}
              fullWidth={false}
              testID="report-share-open"
            />
          </Row>

          {eligiendoDias ? (
            <ElegirDiasSheet
              inicial={
                diasElegidos.length > 0 ? diasElegidos : diasEntre(addDaysToKey(hoyKey, -6), hoyKey)
              }
              hoy={hoyKey}
              weekStartsOn={scope.weekStartsOn}
              timezone={scope.timezone}
              language={language}
              locationId={scope.locationId}
              onApply={(elegidos) => {
                setDiasElegidos(elegidos);
                setEligiendoDias(false);
                setSeñalado(null);
              }}
              onClose={() => setEligiendoDias(false)}
            />
          ) : null}

          <ShareReportSheet
            visible={compartirAbierto}
            onClose={() => setCompartirAbierto(false)}
            periodo={periodoLegible}
            personas={filasDeExportar.length}
            compartiendo={compartir.isPending ? (compartir.variables ?? null) : null}
            onCsv={() => compartir.mutate('csv')}
            onResumen={() => compartir.mutate('resumen')}
            error={compartir.error}
          />

          <AsyncSection
            isPending={cargando}
            error={error}
            isEmpty={
              filasResumen.length === 0 && filasSesiones.length === 0 && programado.total === 0
            }
            loadingLabel={t('reports.loading')}
            emptyTitle={t('reports.emptyTitle')}
            emptyBody={t('reports.emptyBody')}
            onRetry={() => {
              void summaries.refetch();
              void sessions.refetch();
            }}
          >
            <Stack gap={spacing.lg}>
              {/*
                El aviso del filtro va ARRIBA del todo, antes de cualquier numero. Si
                estuviera al pie, se leeria el tablero entero creyendo que habla de la
                tienda cuando habla de una sola persona, y no hay forma de equivocarse
                mas cara que esa en una pantalla de horas.
              */}
              {personaElegida !== null ? (
                <InlineNotice
                  tone="info"
                  body={t('reports.personPicked', { name: nombre(personaElegida) })}
                  action={
                    <GhostButton
                      label={t('reports.clearPerson')}
                      onPress={() => setPersonaElegida(null)}
                      fullWidth={false}
                    />
                  }
                  testID="report-person-picked"
                />
              ) : null}

              {/*
                LO PRIMERO: lo trabajado contra lo programado, y quién está dentro ahora. Ver
                `resumen-del-periodo.tsx`: es lo que faltaba para que el primer día del mes no
                pareciera un mes vacío.
              */}
              <ResumenDelPeriodo
                titulo={tituloDelResumen(tipo, incluyeHoy, t)}
                trabajado={totalMinutos}
                enCurso={enCursoTotal}
                programado={programadoFiltrado}
                incluyeHoy={incluyeHoy}
              />

              <Row gap={spacing.sm} wrap align="stretch">
                <StatTile
                  label={t('reports.people')}
                  value={String(rankingFiltrado.length)}
                  icon="people-outline"
                  testID="report-people"
                />
                <StatTile
                  label={t('reports.overtime')}
                  value={minutesToHHmm(extraMinutos)}
                  tone={extraMinutos > 0 ? 'warning' : undefined}
                  icon="alert-circle-outline"
                  testID="report-overtime"
                />
                {conFeriado || enFeriados > 0 ? (
                  <StatTile
                    label={t('reports.onHolidays')}
                    value={minutesToHHmm(enFeriados)}
                    detalle={t('reports.onHolidaysDetail')}
                    icon="flag-outline"
                    testID="report-holidays"
                  />
                ) : null}
                <CasillaDeCorrecciones
                  consulta={{
                    data: filasCorrecciones,
                    isPending: correcciones.isPending,
                    error: correcciones.error,
                  }}
                  personaId={personaElegida}
                />
                <StatTile
                  label={t('reports.onTime')}
                  value={
                    puntualidad.onTimePercent === null
                      ? t('reports.noData')
                      : `${puntualidad.onTimePercent}%`
                  }
                  /*
                   * ANTES ESTO PINTABA UN 80% EN ROJO DE PELIGRO, con el tono `late`.
                   * Un 80% de puntualidad no es un error: es una cifra por debajo del
                   * objetivo, que es un aviso. Y el verde de `working` cuando se cumple
                   * tampoco aporta: celebrar lo esperado gasta color que hace falta
                   * para lo que no lo es.
                   */
                  tone={
                    puntualidad.onTimePercent !== null && puntualidad.onTimePercent < 90
                      ? 'warning'
                      : undefined
                  }
                  icon="walk-outline"
                  testID="report-ontime"
                />
                <StatTile
                  label={t('reports.absences')}
                  value={faltasCargando ? '—' : String(faltasFiltradas.length)}
                  detalle={
                    faltasCargando
                      ? t('reports.absencesDetail')
                      : (detalleDeFaltas(t, faltasFiltradas) ?? t('reports.absencesDetail'))
                  }
                  tone={faltasCargando ? undefined : tonoDelTotalDeFaltas(faltasFiltradas)}
                  icon="person-remove-outline"
                  testID="report-absences"
                />
              </Row>

              {/*
                EL BONO, SOLO POR MES, y arriba: es lo que se viene a mirar a fin de mes. Por
                semana no tiene sentido —el bono es mensual— y no se enseña a medias.
              */}
              {tipo === 'mes' ? (
                /*
                  CON TODO CARGADO O NADA (auditoría, 4-oct): sin las jornadas, sin desde
                  cuándo hay reloj o sin las justificaciones, el bono decía «Gana» de quien
                  todavía no se sabía si había faltado.
                */
                <AsyncSection
                  isPending={
                    turnosDelMes.isPending ||
                    empleados.isPending ||
                    sessions.isPending ||
                    inicioDelReloj.isPending ||
                    justificaciones.isPending
                  }
                  error={
                    turnosDelMes.error ??
                    empleados.error ??
                    sessions.error ??
                    inicioDelReloj.error ??
                    justificaciones.error
                  }
                  onRetry={() => {
                    void turnosDelMes.refetch();
                    void empleados.refetch();
                    void sessions.refetch();
                    void inicioDelReloj.refetch();
                    void justificaciones.refetch();
                  }}
                >
                  <BonoCard
                    resultados={bonoDelMes.resultados}
                    diasSinReloj={bonoDelMes.diasSinReloj}
                    mesTerminado={nowISO >= periodo.toISO}
                    nombre={nombre}
                    language={language}
                  />
                </AsyncSection>
              ) : null}

              <AsistenciaPorPersona
                filas={filasAsistencia}
                incluyeHoy={incluyeHoy}
                elegida={personaElegida}
                onElegir={(id) => setPersonaElegida((actual) => (actual === id ? null : id))}
              />

              <IncidenciasDelPeriodo
                incidencias={incidenciasFiltradas}
                nombre={nombre}
                timezone={scope.timezone}
                timeFormat={scope.timeFormat}
                language={language}
                elegida={personaElegida}
                onElegir={(id) => setPersonaElegida((actual) => (actual === id ? null : id))}
              />

              {/*
                LOS GRÁFICOS, DE DOS EN DOS cuando caben. Uno debajo de otro eran seis tarjetas
                a todo el ancho, y en un monitor la página medía cuatro pantallas para decir
                cosas que se leen juntas: quién y cuándo, tardanzas y faltas, extra y pausas.
              */}
              <View style={estilosDeCabecera.pareja}>
                <View style={estilosDeCabecera.celda}>
                  <ChartCard
                    title={t('reports.whoWorkedMost')}
                    subtitle={t('reports.whoWorkedMostHint')}
                    readout={lectura('ranking')}
                    footnote={t('reports.hoursAreNotOutput')}
                    estirar
                    testID="chart-ranking"
                  >
                    {filasRanking.length === 0 ? (
                      <AppText variant="help" tone="subtle">
                        {t('reports.noHours')}
                      </AppText>
                    ) : (
                      <RankingBars
                        rows={filasRanking}
                        max={maxRanking}
                        onPoint={señalarFila('ranking')}
                        onPress={(row) =>
                          setPersonaElegida((actual) => (actual === row.id ? null : row.id))
                        }
                        selectedId={personaElegida}
                        testID="ranking-hours"
                      />
                    )}
                  </ChartCard>
                </View>

                {/*
                UN SOLO DÍA NO TIENE «CÓMO VA»: sería una columna sola, que no compara nada.
                El ranking de arriba ya dice lo que hizo cada quien ese día.
              */}
                {tipo === 'dia' ? null : (
                  <View style={estilosDeCabecera.celda}>
                    <ChartCard
                      title={tituloDeColumnas(tipo, porDia, t)}
                      subtitle={subtituloDeColumnas(tipo, porDia, t)}
                      legend={
                        columnas.some((columna) => (columna.planned ?? 0) > 0)
                          ? [
                              { color: chart(colors).series1, label: t('reports.workedLegend') },
                              {
                                color: colors.hundido,
                                label: t('reports.planned'),
                                contorno: true,
                              },
                            ]
                          : undefined
                      }
                      readout={
                        señalado !== null && señalado.titulo === 'dias' ? señalado.detalle : null
                      }
                      estirar
                      testID="chart-week"
                    >
                      <DayColumns
                        days={columnas}
                        onPoint={(day) =>
                          setSeñalado(
                            day === null
                              ? null
                              : {
                                  titulo: 'dias',
                                  detalle:
                                    day.plannedLabel === undefined
                                      ? `${day.long}: ${day.valueText}`
                                      : `${day.long}: ${t('reports.workedColumn', { hours: day.valueText })} · ${day.plannedLabel}`,
                                },
                          )
                        }
                        testID="week-columns"
                      />
                    </ChartCard>
                  </View>
                )}
              </View>

              <View style={estilosDeCabecera.pareja}>
                <View style={estilosDeCabecera.celda}>
                  <ChartCard
                    title={t('reports.punctuality')}
                    subtitle={
                      puntualidad.onTimePercent === null
                        ? t('reports.punctualityNoData')
                        : /*
                           * DOS plurales en una frase, y `count` de i18next solo cubre uno.
                           * Con un solo `count` la frase salia «1 tardanzas de 1 turnos»
                           * en cuanto se filtraba por una persona —se vio al probar el
                           * filtro, no leyendo el codigo—. Asi que el numero de tardanzas
                           * se traduce aparte, con su propio plural, y entra ya escrito.
                           */
                          t('reports.punctualitySummary', {
                            percent: puntualidad.onTimePercent,
                            lateText: t('reports.lateCount', { count: puntualidad.late }),
                            count: puntualidad.measured,
                          })
                    }
                    readout={lectura('tardanzas')}
                    footnote={
                      puntualidad.unscheduled > 0
                        ? t('reports.unscheduledExcluded', { count: puntualidad.unscheduled })
                        : undefined
                    }
                    estirar
                    testID="chart-punctuality"
                  >
                    {filasTardanza.length === 0 ? (
                      <AppText variant="help" tone="subtle">
                        {t('reports.nobodyLate')}
                      </AppText>
                    ) : (
                      <RankingBars
                        rows={filasTardanza}
                        max={maxTardanza}
                        onPoint={señalarFila('tardanzas')}
                        testID="ranking-late"
                      />
                    )}
                  </ChartCard>
                </View>
                <View style={estilosDeCabecera.celda}>
                  {/*
                LAS FALTAS, al lado de las tardanzas (1-oct): las dos son lo que se mira para el
                bono y para hablar con alguien. Cada barra dice qué días.
              */}
                  <ChartCard
                    title={t('reports.absencesTitle')}
                    subtitle={t('reports.absencesHint')}
                    legend={
                      hayFaltasJustificadas
                        ? [
                            {
                              color: chart(colors).attention,
                              label: t('reports.absencesAgainst'),
                            },
                            {
                              color: colors.warning50,
                              borde: colors.warning600,
                              contorno: true,
                              label: t('reports.absencesJustified'),
                            },
                          ]
                        : undefined
                    }
                    readout={lectura('faltas')}
                    estirar
                    testID="chart-absences"
                  >
                    {filasFalta.length === 0 ? (
                      <AppText variant="help" tone="subtle">
                        {t('reports.nobodyAbsent')}
                      </AppText>
                    ) : (
                      <RankingBars
                        rows={filasFalta}
                        max={maxFalta}
                        onPoint={señalarFila('faltas')}
                        testID="ranking-absences"
                      />
                    )}
                  </ChartCard>
                </View>
              </View>

              <View style={estilosDeCabecera.pareja}>
                <View style={estilosDeCabecera.celda}>
                  <ChartCard
                    title={t('reports.overtimeTitle')}
                    subtitle={t('reports.overtimeHint')}
                    legend={[
                      { color: chart(colors).series1, label: t('reports.regular') },
                      { color: chart(colors).series2, label: t('reports.overtime') },
                    ]}
                    readout={lectura('extra')}
                    footnote={t('reports.overtimeIsInformational')}
                    estirar
                    testID="chart-overtime"
                  >
                    {filasExtra.length === 0 ? (
                      <AppText variant="help" tone="subtle">
                        {t('reports.noOvertime')}
                      </AppText>
                    ) : (
                      <RankingBars
                        rows={filasExtra}
                        max={maxExtra}
                        onPoint={señalarFila('extra')}
                        testID="ranking-overtime"
                      />
                    )}
                  </ChartCard>
                </View>
                <View style={estilosDeCabecera.celda}>
                  <ChartCard
                    title={t('reports.whereTimeGoes')}
                    subtitle={t('reports.whereTimeGoesHint', { total: minutesToHHmm(totalPausas) })}
                    readout={lectura('motivos')}
                    estirar
                    testID="chart-reasons"
                  >
                    <AsyncSection
                      isPending={breaks.isPending}
                      error={breaks.error}
                      isEmpty={filasMotivo.length === 0}
                      emptyTitle={t('reports.noBreaksTitle')}
                      emptyBody={t('reports.noBreaksBody')}
                      onRetry={() => void breaks.refetch()}
                    >
                      <Stack gap={spacing.sm}>
                        <RankingBars
                          rows={filasMotivo}
                          max={maxMotivo}
                          onPoint={señalarFila('motivos')}
                          onPress={(row) =>
                            setMotivoAbierto((actual) => (actual === row.id ? null : row.id))
                          }
                          selectedId={motivoAbierto}
                          testID="ranking-reasons"
                        />

                        {/*
                      LO QUE ESCRIBIÓ LA GENTE, que hasta ahora no leía nadie.
                      La app OBLIGA a poner un motivo al pausar por «Otro»; si esa frase
                      no se lee nunca, se le está pidiendo algo a cambio de nada.
                      Son frases sobre por qué alguien se ausentó —a veces médicas—, así
                      que viven AQUÍ y solo aquí: no van al resumen que se comparte por
                      chat ni al CSV que se manda por correo.
                    */}
                        {/*
                      EL AVISO DE QUE SE PUEDE ABRIR VA AQUÍ Y NO EN LA PISTA DE LA FILA.
                      Se probó a añadirlo a la pista —«9% del total · 1 pausa · toca para
                      ver 1 explicación»— y `responsive:check` lo cazó: en la disposición
                      ancha el nombre y su pista viven en una columna de 208 px fijos con
                      una sola línea, así que pedía 282 px y se recortaba desde el iPad
                      horizontal para arriba. Aquí abajo el texto envuelve y cabe en
                      cualquier ancho.
                    */}
                        {motivoConNotas !== undefined && motivoAbierto === null ? (
                          <AppText variant="help" tone="subtle">
                            {t('reports.reasonNotesToggle', {
                              reason: etiquetaMotivo[motivoConNotas.reason],
                              count: motivoConNotas.notes.length,
                            })}
                          </AppText>
                        ) : null}

                        {notasAbiertas.length > 0 ? (
                          <Stack gap={spacing.xs} testID="reason-notes">
                            {notasAbiertas.map((nota) => (
                              <Stack key={`${nota.employeeId}-${nota.at}`} gap={0}>
                                <AppText variant="label" tone="subtle">
                                  {`${formatDateKeyShort(dateKeyOf(nota.at, scope.timezone), language)} · ${nombre(
                                    nota.employeeId,
                                  )} · ${minutesToHHmm(nota.minutes)}`}
                                </AppText>
                                <AppText variant="body">{nota.note}</AppText>
                              </Stack>
                            ))}
                          </Stack>
                        ) : null}
                      </Stack>
                    </AsyncSection>
                  </ChartCard>
                </View>
              </View>
            </Stack>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

/** «Cómo va la semana» mientras dura; «Cómo fue la semana» cuando ya pasó. */
function tituloDelResumen(tipo: TipoDePeriodo, incluyeHoy: boolean, t: TFunction): string {
  const cuando = incluyeHoy ? 'now' : 'past';
  return t(`reports.hero.title.${tipo}.${cuando}`);
}

function tituloDeColumnas(tipo: TipoDePeriodo, porDia: boolean, t: TFunction): string {
  if (tipo === 'dias') return porDia ? t('reports.howTheDaysGo') : t('reports.howTheDaysGoWeeks');
  return tipo === 'mes' ? t('reports.howTheMonthGoes') : t('reports.howTheWeekGoes');
}

function subtituloDeColumnas(tipo: TipoDePeriodo, porDia: boolean, t: TFunction): string {
  if (tipo === 'dias') {
    return porDia ? t('reports.howTheDaysGoHint') : t('reports.howTheDaysGoWeeksHint');
  }
  return tipo === 'mes' ? t('reports.howTheMonthGoesHint') : t('reports.howTheWeekGoesHint');
}

const estilosDeCabecera = StyleSheet.create({
  /* Sin `minWidth: 0` esta fila no encoge y el navegador se sale en un teléfono. */
  encoge: { flexShrink: 1, minWidth: 0 },
  /*
   * DOS TARJETAS POR FILA cuando caben las dos a 460 px; si no, una debajo de otra. Lo
   * decide el ancho de la fila y no el de la ventana: con la barra lateral, una ventana de
   * 1024 deja 776 px, y ahí dos gráficos serían dos rayas.
   */
  pareja: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'stretch' },
  celda: { flexGrow: 1, flexShrink: 1, flexBasis: 460, minWidth: 0 },
});
