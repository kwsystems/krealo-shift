import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AsyncSection } from '@/components/schedule/data-states';
import { SegmentedControl } from '@/components/schedule/fields';
import { MonthNavigator, WeekNavigator } from '@/components/schedule/week-tools';
import { RankingBars, type RankingRow } from '@/components/charts/ranking-bars';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { periodoDe, semanasDelMes } from '@/features/reports/periodo';
import {
  dateKeyOf,
  formatDateKeyShort,
  formatWeekdayShort,
  type DateKey,
} from '@/features/schedules/week';
import type { DentroDeLaPersona } from '@/features/timesheets/en-curso';
import { alertsForSession } from '@/features/timesheets/alerts';
import { useDailySummaries, useWorkSessions } from '@/features/timesheets/hooks';
import { estadoDeFalta } from '@/features/timesheets/faltas';
import {
  detalleDeFaltas,
  etiquetaDeFalta,
  tonoDelTotalDeFaltas,
} from '@/features/timesheets/textos-de-falta';
import { useFaltasDeLaSemana } from '@/features/timesheets/use-faltas';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { chart, chartMarks, radii, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import {
  formatClockTime,
  formatShiftRange,
  minutesToHHmm,
  type TimeFormatPreference,
} from '@/utils/time';

/**
 * LAS HORAS DE UNA PERSONA, DÍA POR DÍA Y SEMANA POR SEMANA, en su ficha de Equipo.
 *
 * Andree (30-sep): «no solo ver que ha hecho 36 horas, sino cada día cuántas, cada semana…
 * para que podamos ver cuánto ha trabajado». Antes la ficha tenía una lista de fechas con
 * un número al lado, solo de los últimos siete días.
 *
 * POR DÍA ES UNA TARJETA DE MARCACIÓN: un casillero por día de la semana, con la hora a la
 * que entró y salió, una barra y el total. La entrada y la salida van porque «trabajó ocho
 * horas» no dice si fue de nueve a cinco o partido en dos; y el casillero del día, como en
 * la tarjeta de papel, deja ver de un vistazo qué días vino y cuáles no.
 *
 * POR SEMANA son las semanas del mes, con cuántos días trabajó y su promedio por día: la
 * pregunta de fin de mes. Recortadas al mes, igual que en Reportes, y por lo mismo.
 *
 * LAS CIFRAS SON LAS DE HORAS Y REPORTES: salen de las mismas consultas, con la misma
 * clave de caché, y lo que lleva hoy quien sigue dentro se suma al día en que entró, igual
 * que en su fila de Horas.
 */

type Vista = 'dia' | 'semana';

/** Una jornada entera de ocho horas no llena la barra: la llena una de diez. */
const ESCALA_MINIMA = 600;

type FaltaDelDia = { texto: string; enContra: boolean };

export function HorasDeLaPersona({
  employeeId,
  organizationId,
  locationId,
  enCurso,
  nowISO,
  timezone,
  timeFormat,
  weekStartsOn,
  language,
}: {
  employeeId: string;
  organizationId: string | null;
  locationId: string | null;
  enCurso?: DentroDeLaPersona;
  nowISO: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  weekStartsOn: number;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const [vista, setVista] = useState<Vista>('dia');
  const [offset, setOffset] = useState(0);

  const hoy = dateKeyOf(nowISO, timezone);
  const periodo = periodoDe({
    tipo: vista === 'dia' ? 'semana' : 'mes',
    offset,
    nowISO,
    weekStartsOn,
    timezone,
  });
  const resumenes = useDailySummaries({ locationId, from: periodo.from, to: periodo.to });
  // Las entradas y salidas solo hacen falta por día; por semana no se piden.
  const jornadas = useWorkSessions({
    organizationId,
    locationId: vista === 'dia' ? locationId : null,
    fromISO: periodo.fromISO,
    toISO: periodo.toISO,
    cacheKey: { from: periodo.from, to: periodo.to },
  });

  /*
   * SUS FALTAS DE LA SEMANA (1-oct). Un día sin horas decía «Día libre» aunque tuviera turno
   * y no hubiera venido: justo lo contrario de lo que pasó. Ver `faltas.ts`.
   */
  const faltasDeLaSemana = useFaltasDeLaSemana({
    organizationId,
    locationId: vista === 'dia' ? locationId : null,
    weekStart: periodo.from,
    timezone,
    nowISO,
  });
  // Con lo que se dijo de cada una (2-oct): «… sin ninguna marca · Justificada · Descanso médico».
  const faltasPorDia = new Map<DateKey, FaltaDelDia>();
  for (const falta of faltasDeLaSemana.porPersona.get(employeeId) ?? []) {
    const rango = formatShiftRange(
      falta.turno.starts_at,
      falta.turno.ends_at,
      timezone,
      timeFormat,
    );
    const texto = `${t('team.absentShift', { range: rango })} · ${etiquetaDeFalta(t, falta)}`;
    const antes = faltasPorDia.get(falta.dia);
    const enContra = estadoDeFalta(falta) !== 'justificada';
    faltasPorDia.set(
      falta.dia,
      antes === undefined
        ? { texto, enContra }
        : { texto: `${antes.texto}\n${texto}`, enContra: antes.enContra || enContra },
    );
  }

  const susFaltas = vista === 'dia' ? (faltasDeLaSemana.porPersona.get(employeeId) ?? []) : [];
  const cuantasFaltas = susFaltas.length;
  const detalleDeSusFaltas = detalleDeFaltas(t, susFaltas);
  const diaEnCurso = enCurso === undefined ? null : dateKeyOf(enCurso.desde, timezone);
  const minutosPorDia = new Map<DateKey, number>();
  for (const fila of resumenes.data ?? []) {
    if (fila.employee_id !== employeeId) continue;
    minutosPorDia.set(fila.work_date, (minutosPorDia.get(fila.work_date) ?? 0) + fila.net_minutes);
  }
  /*
   * «NECESITA REVISIÓN» CON LA REGLA DEL FILTRO DE HORAS (2-oct): un día con alguna jornada
   * con aviso (`alertsForSession`). Antes se leía `needs_review` del resumen, un estado que
   * el servidor no escribe: en producción ningún día salía nunca por revisar, y Horas sí
   * listaba esas jornadas bajo el mismo nombre.
   */
  const porRevisar = new Set<DateKey>();
  for (const jornada of jornadas.data ?? []) {
    if (jornada.employee_id !== employeeId) continue;
    if (alertsForSession(jornada, nowISO).length > 0) {
      porRevisar.add(dateKeyOf(jornada.starts_at, timezone));
    }
  }
  if (diaEnCurso !== null && enCurso !== undefined && periodo.dias.includes(diaEnCurso)) {
    minutosPorDia.set(diaEnCurso, (minutosPorDia.get(diaEnCurso) ?? 0) + enCurso.minutos);
  }
  const total = periodo.dias.reduce((suma, dia) => suma + (minutosPorDia.get(dia) ?? 0), 0);
  const diasTrabajados = periodo.dias.filter((dia) => (minutosPorDia.get(dia) ?? 0) > 0).length;

  return (
    <Stack gap={spacing.md} testID="person-hours">
      <Row gap={spacing.sm} align="center" justify="space-between" wrap>
        <AppText variant="bodyStrong" accessibilityRole="header">
          {t('team.hoursTitle')}
        </AppText>
        <SegmentedControl
          label={t('team.hoursView')}
          value={vista}
          options={[
            { value: 'dia', label: t('team.hoursByDay') },
            { value: 'semana', label: t('team.hoursByWeek') },
          ]}
          onChange={(valor) => {
            setVista(valor);
            setOffset(0);
          }}
          testID="person-hours-view"
        />
      </Row>

      {vista === 'dia' ? (
        <WeekNavigator
          weekStart={periodo.from}
          language={language}
          isCurrentWeek={offset === 0}
          onPrevious={() => setOffset((valor) => valor - 1)}
          onNext={() => setOffset((valor) => valor + 1)}
          onGoToCurrent={() => setOffset(0)}
          testIDPrefix="person-week"
        />
      ) : (
        <MonthNavigator
          monthStart={periodo.from}
          language={language}
          isCurrentMonth={offset === 0}
          onPrevious={() => setOffset((valor) => valor - 1)}
          onNext={() => setOffset((valor) => valor + 1)}
          onGoToCurrent={() => setOffset(0)}
          testIDPrefix="person-month"
        />
      )}

      <AsyncSection
        isPending={resumenes.isPending}
        error={resumenes.error}
        onRetry={() => void resumenes.refetch()}
      >
        {vista === 'dia' ? (
          <TarjetaDeLaSemana
            dias={periodo.dias}
            hoy={hoy}
            minutosPorDia={minutosPorDia}
            porRevisar={porRevisar}
            tramos={tramosPorDia(
              (jornadas.data ?? []).filter((sesion) => sesion.employee_id === employeeId),
              timezone,
              timeFormat,
              language,
            )}
            diaEnCurso={diaEnCurso}
            faltas={faltasPorDia}
            language={language}
          />
        ) : (
          <SemanasDelMes
            dias={periodo.dias}
            hoy={hoy}
            minutosPorDia={minutosPorDia}
            weekStartsOn={weekStartsOn}
            language={language}
          />
        )}

        {/* EL TOTAL, al pie y con el promedio: la cifra que se viene a buscar. */}
        <View style={estilos.pie} testID="person-hours-total">
          <Row justify="space-between" align="center" gap={spacing.md}>
            <AppText variant="bodyStrong">
              {vista === 'dia' ? t('team.weekTotal') : t('team.monthTotal')}
            </AppText>
            <AppText variant="section" tabular testID="person-hours-total-value">
              {minutesToHHmm(total)}
            </AppText>
          </Row>
          <AppText variant="help" tone="subtle">
            {diasTrabajados === 0
              ? t('team.noDaysWorked')
              : t('team.daysAndAverage', {
                  count: diasTrabajados,
                  average: minutesToHHmm(Math.round(total / diasTrabajados)),
                })}
          </AppText>
          {cuantasFaltas === 0 ? null : (
            <AppText
              variant="help"
              tone={tonoDelTotalDeFaltas(susFaltas) === 'warning' ? 'warning' : 'danger'}
              testID="person-hours-faltas"
            >
              {detalleDeSusFaltas === undefined
                ? t('schedule.absencesCount', { count: cuantasFaltas })
                : `${t('schedule.absencesCount', { count: cuantasFaltas })} · ${detalleDeSusFaltas}`}
            </AppText>
          )}
        </View>
      </AsyncSection>
    </Stack>
  );
}

type Jornada = { employee_id: string; starts_at: string; ends_at: string | null };

/** «09:58 – 19:02», por día de entrada; varias jornadas el mismo día van seguidas. */
function tramosPorDia(
  jornadas: readonly Jornada[],
  timezone: string,
  timeFormat: TimeFormatPreference,
  language: SupportedLanguage,
): Map<DateKey, string> {
  const porDia = new Map<DateKey, string[]>();
  const ordenadas = [...jornadas].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (const jornada of ordenadas) {
    const dia = dateKeyOf(jornada.starts_at, timezone);
    const entrada = formatClockTime(jornada.starts_at, timezone, timeFormat, language);
    const salida =
      jornada.ends_at === null
        ? '…'
        : formatClockTime(jornada.ends_at, timezone, timeFormat, language);
    porDia.set(dia, [...(porDia.get(dia) ?? []), `${entrada} – ${salida}`]);
  }
  return new Map([...porDia].map(([dia, tramos]) => [dia, tramos.join(' · ')]));
}

function TarjetaDeLaSemana({
  dias,
  hoy,
  minutosPorDia,
  porRevisar,
  tramos,
  diaEnCurso,
  faltas,
  language,
}: {
  dias: readonly DateKey[];
  hoy: DateKey;
  minutosPorDia: ReadonlyMap<DateKey, number>;
  porRevisar: ReadonlySet<DateKey>;
  tramos: ReadonlyMap<DateKey, string>;
  diaEnCurso: DateKey | null;
  /** Lo que faltó cada día, ya escrito, y si cuenta en contra (rojo) o está justificado. */
  faltas: ReadonlyMap<DateKey, FaltaDelDia>;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const escala = Math.max(ESCALA_MINIMA, ...dias.map((dia) => minutosPorDia.get(dia) ?? 0));

  return (
    <Stack gap={spacing.sm} testID="person-hours-days">
      {dias.map((dia) => {
        const minutos = minutosPorDia.get(dia) ?? 0;
        const futuro = dia > hoy;
        const esHoy = dia === hoy;
        const revisar = porRevisar.has(dia);
        const falta = faltas.get(dia);
        const detalle = futuro
          ? null
          : (tramos.get(dia) ??
            (falta !== undefined ? null : minutos > 0 ? null : t('team.dayOff')));
        const valor = futuro || minutos === 0 ? '—' : minutesToHHmm(minutos);
        return (
          <Row
            key={dia}
            gap={spacing.md}
            align="center"
            testID={`person-day-${dia}`}
            accessibilityLabel={[
              formatDateKeyShort(dia, language),
              valor === '—' ? t('team.noHoursThatDay') : valor,
              detalle,
              dia === diaEnCurso ? t('timesheet.live') : null,
              revisar ? t('states.needsReviewBadge') : null,
              falta === undefined ? null : falta.texto,
            ]
              .filter((parte): parte is string => parte !== null)
              .join(', ')}
          >
            {/* El casillero del día, como en la tarjeta de papel. */}
            <View
              style={[
                estilos.sello,
                esHoy ? estilos.selloDeHoy : null,
                futuro ? estilos.selloFuturo : null,
              ]}
            >
              <AppText variant="label" tone={esHoy ? 'primary' : 'subtle'}>
                {formatWeekdayShort(dia, language)}
              </AppText>
              <AppText
                variant="bodyStrong"
                tone={esHoy ? 'primary' : futuro ? 'subtle' : 'default'}
                tabular
              >
                {String(Number(dia.slice(8)))}
              </AppText>
            </View>
            <Stack gap={spacing.xs} style={estilos.centro}>
              {detalle === null ? null : (
                <AppText
                  variant="label"
                  tone={revisar ? 'danger' : 'muted'}
                  tabular
                  testID={`person-day-${dia}-tramos`}
                >
                  {revisar ? `${detalle} · ${t('states.needsReviewBadge')}` : detalle}
                </AppText>
              )}
              {falta === undefined ? null : (
                <AppText
                  variant="label"
                  tone={falta.enContra ? 'danger' : 'warning'}
                  tabular
                  testID={`person-day-${dia}-falta`}
                >
                  {falta.texto}
                </AppText>
              )}
              {/* Un día que no ha llegado no tiene pista: no es un día a cero, es un día por venir. */}
              <View style={[estilos.pista, futuro ? estilos.sinPista : null]}>
                {minutos > 0 && !futuro ? (
                  <View
                    style={[
                      estilos.barra,
                      {
                        width: `${Math.min(100, (minutos / escala) * 100)}%`,
                        backgroundColor: chart(colors).series1,
                      },
                    ]}
                  />
                ) : null}
              </View>
            </Stack>
            <Stack gap={0} style={estilos.total}>
              <AppText
                variant="bodyStrong"
                tone={valor === '—' ? 'subtle' : 'default'}
                tabular
                style={estilos.derecha}
                testID={`person-day-${dia}-total`}
              >
                {valor}
              </AppText>
              {dia === diaEnCurso ? (
                <AppText variant="label" tone="subtle" style={estilos.derecha}>
                  {t('timesheet.live')}
                </AppText>
              ) : null}
            </Stack>
          </Row>
        );
      })}
    </Stack>
  );
}

function SemanasDelMes({
  dias,
  hoy,
  minutosPorDia,
  weekStartsOn,
  language,
}: {
  dias: readonly DateKey[];
  hoy: DateKey;
  minutosPorDia: ReadonlyMap<DateKey, number>;
  weekStartsOn: number;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const semanas = semanasDelMes(dias, weekStartsOn).filter((semana) => semana.inicio <= hoy);
  const filas: RankingRow[] = semanas.map((semana) => {
    const minutos = semana.dias.reduce((suma, dia) => suma + (minutosPorDia.get(dia) ?? 0), 0);
    const trabajados = semana.dias.filter((dia) => (minutosPorDia.get(dia) ?? 0) > 0).length;
    return {
      id: semana.inicio,
      label: `${formatDateKeyShort(semana.inicio, language)} – ${formatDateKeyShort(semana.fin, language)}`,
      hint:
        trabajados === 0
          ? t('team.noDaysWorked')
          : t('team.daysAndAverage', {
              count: trabajados,
              average: minutesToHHmm(Math.round(minutos / trabajados)),
            }),
      valueText: minutesToHHmm(minutos),
      segments: [{ value: minutos, color: chart(colors).series1, label: t('reports.worked') }],
    };
  });
  const max = Math.max(ESCALA_MINIMA * 5, ...filas.map((fila) => fila.segments[0]?.value ?? 0));

  if (filas.length === 0) {
    return (
      <AppText variant="help" tone="subtle">
        {t('team.monthNotStarted')}
      </AppText>
    );
  }
  return <RankingBars rows={filas} max={max} testID="person-hours-weeks" />;
}

const useEstilos = estilosDelTema((colors) => ({
  sello: {
    width: sizes.touchTargetMin,
    minHeight: sizes.touchTargetMin,
    borderRadius: radii.input,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.hundido,
    flexShrink: 0,
  },
  selloDeHoy: { backgroundColor: colors.primary50 },
  /* Un día que no ha llegado no tiene casillero lleno: solo su contorno. */
  selloFuturo: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  centro: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  pista: {
    height: 8,
    borderRadius: chartMarks.endRadius,
    backgroundColor: colors.hundido,
    overflow: 'hidden',
  },
  sinPista: { backgroundColor: 'transparent' },
  barra: { height: 8, borderRadius: chartMarks.endRadius },
  total: { width: 64, flexShrink: 0 },
  derecha: { textAlign: 'right' },
  pie: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
