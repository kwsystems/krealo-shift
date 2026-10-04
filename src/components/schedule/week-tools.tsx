import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { InlineNotice, LimitBar } from './fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import type { ShiftPublication } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import {
  addDaysToKey,
  dateKeyOf,
  formatDateKeyLong,
  formatDateKeyShort,
  formatDayLong,
  formatMonthLong,
  localTimeOf,
  type DateKey,
} from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { useResponsive } from '@/hooks/use-responsive';
import { useTheme } from '@/theme/use-theme';
import { estilosDelTema } from '@/theme/estilos';
import { radii, sizes, spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/** Herramientas del editor de horarios: navegación, avisos, totales e historial (§11.3). */

export function WeekNavigator({
  weekStart,
  language,
  isCurrentWeek,
  onPrevious,
  onNext,
  onGoToCurrent,
  testIDPrefix = 'week',
  corto = false,
}: {
  weekStart: DateKey;
  language: SupportedLanguage;
  isCurrentWeek: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToCurrent: () => void;
  /** Para cuando hay dos en pantalla: la ficha de Equipo lleva el suyo. */
  testIDPrefix?: string;
  /**
   * «28 sep – 4 oct» en vez de «Semana del 28 de septiembre de 2026» (1-oct): en un
   * teléfono el título largo ocupaba dos líneas entre las flechas.
   */
  corto?: boolean;
}) {
  const { t } = useTranslation();
  const weekLabel = corto
    ? `${formatDateKeyShort(weekStart, language)} – ${formatDateKeyShort(addDaysToKey(weekStart, 6), language)}`
    : t('schedule.weekOf', { date: formatDateKeyLong(weekStart, language) });

  /*
   * UN SOLO CONTROL, y antes eran cuatro cosas en dos filas: el título de la semana en
   * una y tres botones debajo. En Horario eso era una de las SIETE filas de mandos que
   * empujaban la rejilla hasta y=700 de 900 px, y en Reportes parte del 59 % de pantalla
   * gastada antes del primer número.
   *
   * Ahora la navegación es lo que es —ir atrás, ir adelante— con flechas a los lados del
   * título, que es como se lee un calendario en cualquier sitio.
   *
   * «IR A ESTA SEMANA» SOLO APARECE CUANDO SIRVE. Antes estaba siempre, apagado la mayor
   * parte del tiempo: un botón que no se puede pulsar ocupa el mismo sitio que uno que
   * sí, y encima enseña una acción imposible. Si ya estás en esta semana, no hay nada a
   * lo que volver.
   */
  return (
    <Row gap={spacing.sm} wrap align="center" style={estilosFlex.fila}>
      {/*
        LAS FLECHAS Y EL TÍTULO NO SE SEPARAN NUNCA: van en su propia fila, que no parte
        línea. Antes compartían la fila que sí la parte, y en un teléfono el título no cabía
        junto a las flechas, así que cada una caía en su renglón —«‹», el título, «›», uno
        debajo de otro— y la flecha de avanzar quedaba lejos de lo que avanza. Ahora lo que
        cede es el título, que se parte en dos líneas entre sus flechas; y lo único que baja
        de renglón es «Ir a esta semana».
      */}
      <Row gap={spacing.sm} align="center" style={estilosFlex.fila}>
        <FlechaDeSemana
          direccion="anterior"
          etiqueta={t('schedule.previousWeek')}
          onPress={onPrevious}
          testID={`${testIDPrefix}-previous`}
        />
        {/*
        SE TIENE QUE PODER ENCOGER. Sin `flexShrink`, un texto dentro de una fila mide lo
        que mide y empuja: «Semana del 21 de septiembre de 2026» con las dos flechas se
        salía 62 px por la derecha en un teléfono de 414 px, y con `overflow-x: hidden`
        eso no es un texto apretado sino un texto que no está. Lo midió
        `responsive:check`, no se vio leyendo el código.
      */}
        <AppText variant="section" accessibilityRole="header" style={estilosFlex.creceYEncoge}>
          {weekLabel}
        </AppText>
        <FlechaDeSemana
          direccion="siguiente"
          etiqueta={t('schedule.nextWeek')}
          onPress={onNext}
          testID={`${testIDPrefix}-next`}
        />
      </Row>
      {isCurrentWeek ? null : (
        <GhostButton
          label={t('schedule.goToThisWeek')}
          onPress={onGoToCurrent}
          fullWidth={false}
          testID={`${testIDPrefix}-current`}
        />
      )}
    </Row>
  );
}

/**
 * El navegador de MES, gemelo del de semana: las mismas flechas pegadas al título y el
 * mismo «Ir a este mes» que solo sale cuando sirve. Lo usa Reportes cuando se mira por
 * mes, que es como se lleva todo en la tienda.
 */
export function MonthNavigator({
  monthStart,
  language,
  isCurrentMonth,
  onPrevious,
  onNext,
  onGoToCurrent,
  testIDPrefix = 'month',
}: {
  /** Cualquier día del mes; se usa el 1. */
  monthStart: DateKey;
  language: SupportedLanguage;
  isCurrentMonth: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToCurrent: () => void;
  /** Para cuando hay dos en pantalla: la hoja de elegir días lleva el suyo. */
  testIDPrefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <Row gap={spacing.sm} wrap align="center" style={estilosFlex.fila}>
      <Row gap={spacing.sm} align="center" style={estilosFlex.fila}>
        <FlechaDeSemana
          direccion="anterior"
          etiqueta={t('schedule.previousMonth')}
          onPress={onPrevious}
          testID={`${testIDPrefix}-previous`}
        />
        <AppText
          variant="section"
          accessibilityRole="header"
          style={estilosFlex.creceYEncoge}
          testID={`${testIDPrefix}-title`}
        >
          {formatMonthLong(monthStart, language)}
        </AppText>
        <FlechaDeSemana
          direccion="siguiente"
          etiqueta={t('schedule.nextMonth')}
          onPress={onNext}
          testID={`${testIDPrefix}-next`}
        />
      </Row>
      {isCurrentMonth ? null : (
        <GhostButton
          label={t('schedule.goToThisMonth')}
          onPress={onGoToCurrent}
          fullWidth={false}
          testID={`${testIDPrefix}-current`}
        />
      )}
    </Row>
  );
}

/**
 * El navegador de DÍA, tercer gemelo: Reportes de un solo día (30-sep). «Ir a hoy» solo
 * sale cuando no se está en hoy.
 */
export function DayNavigator({
  day,
  language,
  isToday,
  onPrevious,
  onNext,
  onGoToToday,
}: {
  day: DateKey;
  language: SupportedLanguage;
  isToday: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToToday: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Row gap={spacing.sm} wrap align="center" style={estilosFlex.fila}>
      <Row gap={spacing.sm} align="center" style={estilosFlex.fila}>
        <FlechaDeSemana
          direccion="anterior"
          etiqueta={t('schedule.previousDay')}
          onPress={onPrevious}
          testID="day-previous"
        />
        <AppText
          variant="section"
          accessibilityRole="header"
          style={estilosFlex.creceYEncoge}
          testID="day-title"
        >
          {formatDayLong(day, language)}
        </AppText>
        <FlechaDeSemana
          direccion="siguiente"
          etiqueta={t('schedule.nextDay')}
          onPress={onNext}
          testID="day-next"
        />
      </Row>
      {isToday ? null : (
        <GhostButton
          label={t('schedule.goToToday')}
          onPress={onGoToToday}
          fullWidth={false}
          testID="day-current"
        />
      )}
    </Row>
  );
}

/**
 * La flecha de una semana. Es un botón de icono, así que su nombre accesible lo lleva
 * escrito: sin `accessibilityLabel`, un lector de pantalla anuncia «botón» y ya está, y
 * quien navega sin ver la pantalla no sabe si retrocede o avanza.
 */
function FlechaDeSemana({
  direccion,
  etiqueta,
  onPress,
  testID,
}: {
  direccion: 'anterior' | 'siguiente';
  etiqueta: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  const estilos = useEstilosDeFlecha();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [estilos.flecha, pressed ? estilos.flechaPulsada : null]}
    >
      <Ionicons
        name={direccion === 'anterior' ? 'chevron-back' : 'chevron-forward'}
        size={20}
        color={colors.ink700}
      />
    </Pressable>
  );
}

const estilosFlex = StyleSheet.create({
  /*
   * `minWidth: 0` ADEMÁS de `flexShrink`, y hace falta el par: en la web un elemento
   * flexible no baja de su ancho de contenido aunque se le diga que encoja, así que sin
   * esto el texto de la semana seguía empujando la fila 62 px fuera de un teléfono de
   * 414. Con los dos, el título envuelve en dos líneas, que es lo que tenía que pasar.
   */
  fila: { flexShrink: 1, minWidth: 0 },
  creceYEncoge: { flexShrink: 1, minWidth: 0 },
});

const useEstilosDeFlecha = estilosDelTema((colors) => ({
  flecha: {
    /* El mínimo táctil manda: un icono de 20 px necesita 44 de zona que se pueda tocar. */
    width: sizes.touchTargetMin,
    height: sizes.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.hundido,
  },
  flechaPulsada: { backgroundColor: colors.primary50 },
}));

/**
 * LOS AVISOS DICEN QUIÉN, CUÁNDO Y CUÁNTO (auditoría, 4-oct). «Descanso insuficiente entre
 * turnos: 9:00» no decía de quién ni qué noche, y «supera el límite semanal» no decía por
 * cuánto: para arreglarlo había que buscar el turno en la rejilla. Ahora cada aviso trae el
 * nombre, el día y las horas de los turnos de los que habla.
 */
export function ScheduleWarnings({
  warnings,
  shifts,
  timezone,
  language,
  minimumRestMinutes,
}: {
  warnings: ScheduleWarning[];
  /** Los turnos de la semana, para decir de cuáles habla cada aviso. */
  shifts: { id: string; startsAt: string; endsAt: string }[];
  timezone: string;
  language: SupportedLanguage;
  minimumRestMinutes: number;
}) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;

  const porId = new Map(shifts.map((shift) => [shift.id, shift]));
  const dia = (instante: string) => formatDateKeyShort(dateKeyOf(instante, timezone), language);
  const hora = (instante: string) => localTimeOf(instante, timezone);
  const tramo = (id: string) => {
    const turno = porId.get(id);
    return turno === undefined ? '' : `${hora(turno.startsAt)}–${hora(turno.endsAt)}`;
  };

  return (
    <Stack gap={spacing.sm}>
      {warnings.map((warning, index) => {
        if (warning.kind === 'overlap') {
          const primero = porId.get(warning.shiftIds[0]);
          return (
            <InlineNotice
              key={`overlap-${warning.shiftIds.join('-')}-${index}`}
              tone="late"
              icon="alert-circle"
              title={t('schedule.overlapTitle')}
              body={t('schedule.overlapWarning', {
                name: warning.employeeName,
                day: primero === undefined ? '' : dia(primero.startsAt),
                first: tramo(warning.shiftIds[0]),
                second: tramo(warning.shiftIds[1]),
              })}
              testID="schedule-warning-overlap"
            />
          );
        }
        if (warning.kind === 'shortRest') {
          const antes = porId.get(warning.shiftIds[0]);
          const despues = porId.get(warning.shiftIds[1]);
          return (
            <InlineNotice
              key={`rest-${warning.shiftIds.join('-')}-${index}`}
              tone="onBreak"
              icon="time-outline"
              title={t('schedule.shortRestTitle')}
              body={t('schedule.shortRestWarning', {
                name: warning.employeeName,
                fromDay: antes === undefined ? '' : dia(antes.endsAt),
                fromTime: antes === undefined ? '' : hora(antes.endsAt),
                toDay: despues === undefined ? '' : dia(despues.startsAt),
                toTime: despues === undefined ? '' : hora(despues.startsAt),
                hours: minutesToHHmm(warning.restMinutes),
                minimum: minutesToHHmm(minimumRestMinutes),
              })}
              testID="schedule-warning-rest"
            />
          );
        }
        return (
          <InlineNotice
            key={`weekly-${warning.employeeId}-${index}`}
            tone="onBreak"
            icon="trending-up-outline"
            title={t('schedule.weeklyLimitTitle')}
            body={t('schedule.weeklyLimitWarning', {
              name: warning.employeeName,
              hours: minutesToHHmm(warning.minutes),
              limit: minutesToHHmm(warning.limitMinutes),
            })}
            testID="schedule-warning-weekly"
          />
        );
      })}
    </Stack>
  );
}

export type EmployeeTotal = {
  employeeId: string;
  name: string;
  minutes: number;
};

/** §25 WeeklyHoursSummary: total por empleado y comparación con el límite (§11.3). */
export function WeeklyHoursSummary({
  totals,
  weeklyLimitMinutes,
  totalMinutes,
  draftMinutes = 0,
}: {
  totals: EmployeeTotal[];
  weeklyLimitMinutes: number;
  totalMinutes: number;
  /**
   * Lo que de ese total está en borrador (2-oct). Horario suma los borradores porque es
   * donde se arma la semana; Inicio y Reportes cuentan solo lo publicado. Sin decirlo, el
   * mismo día Horario decía 144:00 e Inicio 122:00, y parecía que uno de los dos fallaba.
   */
  draftMinutes?: number;
}) {
  const { t } = useTranslation();
  /*
   * EN COLUMNAS EN PANTALLA ANCHA (1-oct): ocho barras a todo el ancho de un monitor eran
   * 400 px para dos datos por persona. Mismo ancho de columna para todas, para que las
   * barras se puedan comparar de un vistazo.
   */
  const { density } = useResponsive();
  const columnas = density === 'extraWide' ? 3 : density === 'wide' ? 2 : 1;

  return (
    <Card>
      <AppText variant="bodyStrong">
        {t('schedule.totalWeeklyHours', { hours: minutesToHHmm(totalMinutes) })}
      </AppText>
      {draftMinutes > 0 ? (
        <AppText variant="help" tone="subtle" testID="weekly-total-drafts">
          {t('schedule.totalWeeklyDrafts', {
            drafts: minutesToHHmm(draftMinutes),
            published: minutesToHHmm(Math.max(0, totalMinutes - draftMinutes)),
          })}
        </AppText>
      ) : null}
      {totals.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('schedule.noShiftsThisWeek')}
        </AppText>
      ) : (
        <View style={styles.columnas}>
          {totals.map((total) => (
            <View
              key={total.employeeId}
              style={[columnas > 1 ? styles.columna : null, { width: `${100 / columnas}%` }]}
            >
              <LimitBar
                label={total.name}
                value={total.minutes}
                limit={weeklyLimitMinutes}
                valueLabel={
                  weeklyLimitMinutes > 0
                    ? `${minutesToHHmm(total.minutes)} / ${minutesToHHmm(weeklyLimitMinutes)}`
                    : minutesToHHmm(total.minutes)
                }
                testID={`weekly-total-${total.employeeId}`}
              />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export function PublicationHistory({
  publications,
  timezone,
  timeFormat,
  language,
}: {
  publications: ShiftPublication[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <AppText variant="bodyStrong">{t('schedule.publishHistory')}</AppText>
      {publications.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('schedule.noPublicationsYet')}
        </AppText>
      ) : (
        <View style={styles.history}>
          {publications.map((publication) => (
            <Row key={publication.id} justify="space-between" gap={spacing.md} align="flex-start">
              <AppText variant="help" tone="muted">
                {t('schedule.publicationVersion', { version: publication.publication_version })}
              </AppText>
              <AppText variant="help" tone="subtle" tabular>
                {`${formatClockTime(publication.published_at, timezone, timeFormat, language)} · ${t(
                  'schedule.publicationChanged',
                  { count: publication.changed_shift_ids.length },
                )}`}
              </AppText>
            </Row>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  history: { gap: spacing.sm },
  /* El hueco va dentro de cada columna y no en `gap`: así los porcentajes suman 100. */
  columnas: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  columna: { paddingRight: spacing.xl },
});
