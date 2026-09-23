import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { InlineNotice, LimitBar } from './fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import type { ShiftPublication } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import { formatDateKeyLong, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
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
}: {
  weekStart: DateKey;
  language: SupportedLanguage;
  isCurrentWeek: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToCurrent: () => void;
}) {
  const { t } = useTranslation();
  const weekLabel = t('schedule.weekOf', { date: formatDateKeyLong(weekStart, language) });

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
      <FlechaDeSemana
        direccion="anterior"
        etiqueta={t('schedule.previousWeek')}
        onPress={onPrevious}
        testID="week-previous"
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
        testID="week-next"
      />
      {isCurrentWeek ? null : (
        <GhostButton
          label={t('schedule.goToThisWeek')}
          onPress={onGoToCurrent}
          fullWidth={false}
          testID="week-current"
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

export function ScheduleWarnings({ warnings }: { warnings: ScheduleWarning[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;

  return (
    <Stack gap={spacing.sm}>
      {warnings.map((warning, index) => {
        if (warning.kind === 'overlap') {
          return (
            <InlineNotice
              key={`overlap-${warning.shiftIds.join('-')}-${index}`}
              tone="late"
              icon="alert-circle"
              title={t('schedule.overlapTitle')}
              body={t('schedule.overlapWarning', { name: warning.employeeName })}
            />
          );
        }
        if (warning.kind === 'shortRest') {
          return (
            <InlineNotice
              key={`rest-${warning.shiftIds.join('-')}-${index}`}
              tone="onBreak"
              icon="time-outline"
              title={t('schedule.shortRestTitle')}
              body={t('schedule.shortRestWarning', {
                hours: minutesToHHmm(warning.restMinutes),
              })}
            />
          );
        }
        return (
          <InlineNotice
            key={`weekly-${warning.employeeId}-${index}`}
            tone="onBreak"
            icon="trending-up-outline"
            title={t('schedule.weeklyLimitTitle')}
            body={t('schedule.weeklyLimitWarning', { name: warning.employeeName })}
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
}: {
  totals: EmployeeTotal[];
  weeklyLimitMinutes: number;
  totalMinutes: number;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <AppText variant="bodyStrong">
        {t('schedule.totalWeeklyHours', { hours: minutesToHHmm(totalMinutes) })}
      </AppText>
      {totals.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('schedule.noShiftsThisWeek')}
        </AppText>
      ) : (
        <Stack gap={spacing.md}>
          {totals.map((total) => (
            <LimitBar
              key={total.employeeId}
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
          ))}
        </Stack>
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
});
