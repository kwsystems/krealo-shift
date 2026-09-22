import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { hoursByEmployee, minutesByDay, minutesByReason, punctuality } from './aggregate';
import {
  breakMinutesByEmployee,
  buildExportRows,
  buildReportCsv,
  buildReportSummary,
  reportFileName,
} from './export';
import { useBreakTimeByReason } from './hooks';
import { ShareReportSheet } from './share-sheet';
import { AsyncSection } from '@/components/schedule/data-states';
import { InlineNotice, StatTile } from '@/components/schedule/fields';
import { WeekNavigator } from '@/components/schedule/week-tools';
import { ChartCard } from '@/components/charts/chart-frame';
import { DayColumns, type DayColumn } from '@/components/charts/day-columns';
import { RankingBars, type RankingRow } from '@/components/charts/ranking-bars';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import {
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  formatDateKeyLong,
  formatDateKeyShort,
  formatDayColumn,
  formatWeekdayShort,
  weekDays,
  weekEnd,
  weekRangeInstants,
} from '@/features/schedules/week';
import { useEmployeeNames } from '@/features/team/hooks';
import { useDailySummaries, useWorkSessions } from '@/features/timesheets/hooks';
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

  const [weekOffset, setWeekOffset] = useState(0);
  const [señalado, setSeñalado] = useState<Señalado>(null);
  const [compartirAbierto, setCompartirAbierto] = useState(false);
  const [personaElegida, setPersonaElegida] = useState<string | null>(null);
  const [motivoAbierto, setMotivoAbierto] = useState<string | null>(null);

  const nowISO = now.toISOString();
  const thisWeekStart = currentWeekStart(nowISO, scope.weekStartsOn, scope.timezone);
  const weekStart = addWeeks(thisWeekStart, weekOffset);
  const from = weekStart;
  const to = weekEnd(weekStart);
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
  const range = weekRangeInstants(weekStart, scope.timezone);

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
  const names = useEmployeeNames(organizationId);

  const nombre = (employeeId: string) => names.get(employeeId) ?? t('reports.unknownPerson');
  const etiquetaMotivo = breakReasonLabels(t);

  const umbral = scope.settings.dailyOvertimeThresholdMinutes;
  const filasResumen = useMemo(() => summaries.data ?? [], [summaries.data]);
  const filasSesiones = useMemo(() => sessions.data ?? [], [sessions.data]);

  const ranking = useMemo(() => hoursByEmployee(filasResumen, umbral), [filasResumen, umbral]);
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
  const pausasFiltradas = useMemo(() => {
    const filas = breaks.data ?? [];
    return personaElegida === null
      ? filas
      : filas.filter((fila) => fila.employee_id === personaElegida);
  }, [breaks.data, personaElegida]);

  const dias = minutesByDay(resumenFiltrado, weekDays(weekStart));
  const puntualidad = useMemo(() => punctuality(sesionesFiltradas), [sesionesFiltradas]);
  const motivos = useMemo(() => minutesByReason(pausasFiltradas), [pausasFiltradas]);
  // Para el resumen que se comparte: los motivos del local entero, sin filtro.
  const motivosSinFiltrar = useMemo(() => minutesByReason(breaks.data ?? []), [breaks.data]);

  const totalMinutos = ranking.reduce((suma, fila) => suma + fila.netMinutes, 0);
  const extraMinutos = ranking.reduce((suma, fila) => suma + fila.overtimeMinutes, 0);
  const conExtra = ranking.filter((fila) => fila.overtimeMinutes > 0);
  // Hoy en la zona de la SEDE, no en la del navegador: un gerente que mira el tablero
  // desde otro huso subrayaria el dia equivocado.
  const hoyKey = dateKeyOf(nowISO, scope.timezone);

  const cargando = summaries.isPending || sessions.isPending;
  const error = summaries.error ?? sessions.error;

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
  const filasTardanza: RankingRow[] = puntualidad.byEmployee
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
  const columnas: DayColumn[] = dias.map((dia) => ({
    key: dia.dateKey,
    short: formatDayColumn(dia.dateKey, language),
    tiny: formatWeekdayShort(dia.dateKey, language),
    long: formatDateKeyLong(dia.dateKey, language),
    value: dia.netMinutes,
    valueText: minutesToHHmm(dia.netMinutes),
    isToday: dia.dateKey === hoyKey,
  }));

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
  const pausasPorPersona = useMemo(() => breakMinutesByEmployee(breaks.data ?? []), [breaks.data]);

  const periodoLegible = t('reports.periodRange', {
    from: formatDateKeyShort(from, language),
    to: formatDateKeyShort(to, language),
  });

  const compartir = useMutation({
    mutationFn: async (formato: 'csv' | 'resumen') => {
      const filas = buildExportRows({
        ranking: hoursByEmployee(filasResumen, umbral),
        nameOf: nombre,
        punctuality: punctuality(filasSesiones),
        breakMinutesByEmployee: pausasPorPersona,
      });

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
            breakMinutes: t('reports.csvBreakMinutes'),
          },
        });
        await compartirArchivo({
          nombre: reportFileName({ from, to }),
          // La marca de orden de bytes, igual que en el CSV de Horas: sin ella Excel
          // abre «Núñez» como «NuÃ±ez» y el reporte se devuelve.
          contenido: `${CSV_BOM}${contenido}`,
          tipoMime: 'text/csv',
          uti: 'public.comma-separated-values-text',
          titulo: reportFileName({ from, to }),
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
          topPerson: t('reports.summaryTop'),
          topReason: t('reports.summaryTopReason'),
          footer: t('reports.summaryFooter'),
        },
        totalMinutes: totalMinutos,
        people: ranking.length,
        overtimeMinutes: extraMinutos,
        punctuality: punctuality(filasSesiones),
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
        nombre: t('reports.summaryFileName', { from, to }),
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
      track({ name: 'timesheet_exported', rowCount: filas, dayCount: 7 });
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

          <WeekNavigator
            weekStart={weekStart}
            language={language}
            isCurrentWeek={weekOffset === 0}
            onPrevious={() => setWeekOffset((valor) => valor - 1)}
            onNext={() => setWeekOffset((valor) => valor + 1)}
            onGoToCurrent={() => setWeekOffset(0)}
          />

          {/*
            Compartir vive JUNTO al periodo, no al final de la pantalla. Lo que se manda
            es «esta semana», así que el botón tiene que estar donde se ve cuál es: al
            final, después de cinco gráficos, ya nadie recuerda qué semana está mirando.
            Deshabilitado mientras no hay nada que mandar, que es más honesto que
            compartir un archivo con solo la fila de cabecera.
          */}
          <Row>
            <SecondaryButton
              label={t('reports.share')}
              onPress={() => setCompartirAbierto(true)}
              disabled={ranking.length === 0}
              fullWidth={false}
              testID="report-share-open"
            />
          </Row>

          <ShareReportSheet
            visible={compartirAbierto}
            onClose={() => setCompartirAbierto(false)}
            periodo={periodoLegible}
            personas={ranking.length}
            compartiendo={compartir.isPending ? (compartir.variables ?? null) : null}
            onCsv={() => compartir.mutate('csv')}
            onResumen={() => compartir.mutate('resumen')}
            error={compartir.error}
          />

          <AsyncSection
            isPending={cargando}
            error={error}
            isEmpty={filasResumen.length === 0 && filasSesiones.length === 0}
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

              <Row gap={spacing.sm} wrap>
                <StatTile
                  label={t('reports.totalHours')}
                  value={minutesToHHmm(totalMinutos)}
                  icon="time-outline"
                  testID="report-total"
                />
                <StatTile
                  label={t('reports.people')}
                  value={String(ranking.length)}
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
              </Row>

              <ChartCard
                title={t('reports.whoWorkedMost')}
                subtitle={t('reports.whoWorkedMostHint')}
                readout={lectura('ranking')}
                footnote={t('reports.hoursAreNotOutput')}
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

              <ChartCard
                title={t('reports.howTheWeekGoes')}
                subtitle={t('reports.howTheWeekGoesHint')}
                readout={señalado !== null && señalado.titulo === 'dias' ? señalado.detalle : null}
                testID="chart-week"
              >
                <DayColumns
                  days={columnas}
                  onPoint={(day) =>
                    setSeñalado(
                      day === null
                        ? null
                        : { titulo: 'dias', detalle: `${day.long}: ${day.valueText}` },
                    )
                  }
                  testID="week-columns"
                />
              </ChartCard>

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

              <ChartCard
                title={t('reports.overtimeTitle')}
                subtitle={t('reports.overtimeHint')}
                legend={[
                  { color: chart(colors).series1, label: t('reports.regular') },
                  { color: chart(colors).series2, label: t('reports.overtime') },
                ]}
                readout={lectura('extra')}
                footnote={t('reports.overtimeIsInformational')}
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

              <ChartCard
                title={t('reports.whereTimeGoes')}
                subtitle={t('reports.whereTimeGoesHint', { total: minutesToHHmm(totalPausas) })}
                readout={lectura('motivos')}
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
            </Stack>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
