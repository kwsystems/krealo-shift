import { useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyShiftSlot, ShiftCard } from './shift-card';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import type { ShiftRow } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import { formatDateKeyShort, formatDayColumn, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/**
 * Vistas del editor de horarios (§11.3).
 *
 * En iPad: empleados en filas y días en columnas. En iPhone: tarjetas por día.
 * Nunca una tabla de escritorio comprimida en un teléfono (§33).
 */

/** Anchos derivados de la escala de espaciado, no números sueltos (§5). */
const NAME_COLUMN_WIDTH = spacing.huge * 3.5;

/**
 * ANCHO MÍNIMO de una columna de día, no su ancho fijo.
 *
 * Era `width` fijo, y con siete días más la columna de nombres la rejilla medía
 * exactamente 1176 px SIEMPRE: en un iPad de 768 y en un monitor de 1920 igual. Las dos
 * consecuencias, medidas:
 *
 *   - en 1920 sobraban 448 px de hueco a la derecha y las columnas seguían estrechas,
 *     apretando los turnos sin ninguna razón;
 *   - y al revés, el ancho no bajaba nunca, así que por debajo de 1176 la rejilla se
 *     arrastra —eso sigue pasando y no lo arregla este cambio: ver abajo—.
 *
 * Ahora cada día pide `flex: 1` con este mínimo: reparte el ancho disponible cuando
 * sobra, y cuando no llega se queda en el mínimo y la rejilla se arrastra. El mínimo es
 * el ancho por debajo del cual la hora del turno ya no se lee, que es lo que de verdad
 * lo fija: 144 px de columna menos 16 de la celda y menos 16 de la tarjeta dejan 112 px
 * para un «03:00 – 09:00» que mide 104. Ocho de margen, no cero: ver `shift-card.tsx`.
 *
 * EL MÍNIMO SON 136 PX Y NO 144, y los ocho de diferencia son la semana entera en un
 * monitor de 1440: ahí quedan 1144 px para la rejilla, que entre siete días y la
 * columna de nombres dan 139,4 por día. Con 144 de mínimo el domingo se quedaba fuera
 * por 32 px; con 136 cabe. Y 136 sigue siendo legible: descontando 16 de la celda y 16
 * de la tarjeta quedan 104 px, y el texto más ancho que tiene que caber dentro es
 * «Publicado» con 56. La hora ya no manda porque puede partirse en dos líneas.
 *
 * LO QUE ESTO NO ARREGLA, y está medido: en 1280, 1024 y 768 la rejilla sigue pidiendo
 * 1120 px y se arrastra. Meter siete días en un portátil de 1280 pediría columnas de
 * 116, y por debajo de 136 los turnos dejan de leerse. Eso ya no es un ancho que
 * ajustar, es decidir cuántos días se ven a la vez, y tiene su propia tarea.
 */
const DAY_COLUMN_MIN_WIDTH = spacing.huge * 3 - spacing.sm;

/**
 * Turno con su fecha local ya calculada, para no repetir la conversión de zona
 * horaria en cada celda de la cuadrícula.
 */
export type DatedShift = ShiftRow & { dateKey: DateKey };

export type EmployeeRow = {
  employeeId: string;
  name: string;
  shifts: DatedShift[];
  scheduledMinutes: number;
};

export type GridProps = {
  days: DateKey[];
  rows: EmployeeRow[];
  todayKey: DateKey;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  jobRoleNames: Map<string, string>;
  warningsFor: (shiftId: string) => ScheduleWarning[];
  onSelectShift: (shift: ShiftRow) => void;
  onAddShift: (params: { employeeId: string; dateKey: DateKey }) => void;
  readOnly?: boolean;
};

export function WeekGrid({
  days,
  rows,
  todayKey,
  timezone,
  timeFormat,
  language,
  jobRoleNames,
  warningsFor,
  onSelectShift,
  onAddShift,
  readOnly = false,
}: GridProps) {
  const styles = useEstilos();
  const { t } = useTranslation();
  /** Ancho que el `ScrollView` tiene de verdad en pantalla. 0 hasta el primer layout. */
  const [anchoVisible, setAnchoVisible] = useState(0);

  /*
   * EL ANCHO DE COLUMNA SE CALCULA, y no se deja al flexbox. Lo intenté con `flex: 1`
   * más `minWidth`, y con `minWidth: '100%'` en la fila: las dos veces las columnas
   * salieron a 180 px en vez de a su mínimo de 144, y la rejilla creció de 1176 a 1426,
   * o sea que se veían MENOS días que antes. La razón es que dentro de un `ScrollView`
   * horizontal el contenedor de contenido se dimensiona a su CONTENIDO, así que
   * `flexGrow` reparte el máximo intrínseco y un `100 %` se resuelve contra algo que ya
   * depende del contenido. No hay forma de expresarlo en estilos.
   *
   * Con el ancho visible medido sí se puede decir exactamente lo que se quiere: reparte
   * el hueco entre los días y nunca bajes del mínimo. Si no llega, la rejilla se
   * arrastra, que es lo correcto —comprimir más dejaría los turnos ilegibles—.
   */
  const anchoDeDia =
    anchoVisible === 0
      ? DAY_COLUMN_MIN_WIDTH
      : Math.max(
          DAY_COLUMN_MIN_WIDTH,
          Math.floor((anchoVisible - NAME_COLUMN_WIDTH) / Math.max(1, days.length)),
        );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={styles.grid}
      onLayout={(evento: LayoutChangeEvent) => setAnchoVisible(evento.nativeEvent.layout.width)}
    >
      <View>
        <Row gap={0} align="stretch">
          <View style={[styles.headerCell, styles.nameColumn]}>
            <AppText variant="label" tone="subtle">
              {t('schedule.employee')}
            </AppText>
          </View>
          {days.map((day) => (
            <View
              key={day}
              style={[
                styles.headerCell,
                { width: anchoDeDia },
                day === todayKey ? styles.cabeceraDeHoy : null,
              ]}
            >
              <AppText variant="label" tone={day === todayKey ? 'primary' : 'subtle'}>
                {formatDayColumn(day, language)}
              </AppText>
            </View>
          ))}
        </Row>

        {rows.map((row) => (
          <Row key={row.employeeId} gap={0} align="stretch">
            <View style={[styles.cell, styles.nameColumn]}>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {row.name}
              </AppText>
              {/*
                EL NÚMERO DICE QUÉ ES. Antes ponía «05:30» debajo del nombre y nada más:
                quien lo ve por primera vez no sabe si son las horas de la semana, las de
                hoy, las que lleva trabajadas o la hora de entrada. Cinco caracteres de
                etiqueta resuelven una ambigüedad que obliga a preguntar.
              */}
              <AppText variant="label" tone="subtle" tabular numberOfLines={1}>
                {t('schedule.weekTotalShort', { total: minutesToHHmm(row.scheduledMinutes) })}
              </AppText>
            </View>

            {days.map((day) => {
              const dayShifts = row.shifts.filter((shift) => shift.dateKey === day);
              return (
                <View key={`${row.employeeId}-${day}`} style={[styles.cell, { width: anchoDeDia }]}>
                  <Stack gap={spacing.xs}>
                    {dayShifts.map((shift) => (
                      <ShiftCard
                        key={shift.id}
                        shift={shift}
                        timezone={timezone}
                        timeFormat={timeFormat}
                        jobRoleName={
                          shift.job_role_id === null
                            ? null
                            : (jobRoleNames.get(shift.job_role_id) ?? null)
                        }
                        warnings={warningsFor(shift.id)}
                        onPress={readOnly ? undefined : onSelectShift}
                        testID={`shift-${shift.id}`}
                      />
                    ))}
                    {readOnly ? null : (
                      <EmptyShiftSlot
                        onPress={() => onAddShift({ employeeId: row.employeeId, dateKey: day })}
                        accessibilityLabel={t('schedule.addShiftFor', {
                          name: row.name,
                          date: formatDateKeyShort(day, language),
                        })}
                        testID={`add-shift-${row.employeeId}-${day}`}
                      />
                    )}
                  </Stack>
                </View>
              );
            })}
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

export type DayListProps = {
  days: DateKey[];
  shiftsByDay: Map<DateKey, DatedShift[]>;
  employeeNames: Map<string, string>;
  jobRoleNames: Map<string, string>;
  todayKey: DateKey;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  warningsFor: (shiftId: string) => ScheduleWarning[];
  onSelectShift: (shift: ShiftRow) => void;
  onAddShift: (params: { dateKey: DateKey }) => void;
  readOnly?: boolean;
};

export function DayList({
  days,
  shiftsByDay,
  employeeNames,
  jobRoleNames,
  todayKey,
  timezone,
  timeFormat,
  language,
  warningsFor,
  onSelectShift,
  onAddShift,
  readOnly = false,
}: DayListProps) {
  const styles = useEstilos();
  const { t } = useTranslation();

  return (
    <Stack gap={spacing.base}>
      {days.map((day) => {
        const dayShifts = shiftsByDay.get(day) ?? [];
        return (
          <View key={day} style={styles.dayBlock}>
            <Row justify="space-between">
              <AppText variant="bodyStrong" tone={day === todayKey ? 'primary' : 'default'}>
                {formatDayColumn(day, language)}
              </AppText>
              <AppText variant="label" tone="subtle" tabular>
                {t('schedule.shiftsCount', { count: dayShifts.length })}
              </AppText>
            </Row>

            {dayShifts.length === 0 ? (
              <AppText variant="help" tone="subtle">
                {t('schedule.noShiftsThatDay')}
              </AppText>
            ) : (
              <Stack gap={spacing.sm}>
                {dayShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    showEmployeeName
                    employeeName={employeeNames.get(shift.employee_id) ?? ''}
                    jobRoleName={
                      shift.job_role_id === null
                        ? null
                        : (jobRoleNames.get(shift.job_role_id) ?? null)
                    }
                    timezone={timezone}
                    timeFormat={timeFormat}
                    warnings={warningsFor(shift.id)}
                    onPress={readOnly ? undefined : onSelectShift}
                    testID={`shift-${shift.id}`}
                  />
                ))}
              </Stack>
            )}

            {readOnly ? null : (
              <EmptyShiftSlot
                onPress={() => onAddShift({ dateKey: day })}
                accessibilityLabel={t('schedule.addShiftOn', {
                  date: formatDateKeyShort(day, language),
                })}
                testID={`add-shift-${day}`}
              />
            )}
          </View>
        );
      })}
    </Stack>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  grid: { paddingBottom: spacing.sm, flexGrow: 1 },
  headerCell: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    justifyContent: 'center',
  },
  cell: {
    padding: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  nameColumn: { width: NAME_COLUMN_WIDTH, flexGrow: 0, flexShrink: 0 },
  /*
   * `flex: 1` con mínimo, y el mínimo manda: cuando siete mínimos más la columna de
   * nombres no caben, `minWidth` gana al encogido y la rejilla se arrastra en vez de
   * comprimir los turnos hasta que no se lean.
   */
  /*
   * HOY SE MARCA EN LA CABECERA, NO TIÑENDO LA COLUMNA ENTERA.
   *
   * El tinte bajaba por toda la columna hasta cortarse en seco donde acababa la última
   * fila, así que parecía un bloque de color pegado a la rejilla más que «este es hoy». Y
   * al teñir el fondo de las celdas competía con los propios turnos, que es lo que hay
   * que mirar.
   *
   * Ahora la cabecera del día lleva el acento —fondo tenue y texto en color— y la columna
   * se queda limpia. Un día se identifica por su rótulo, que es donde se mira para
   * saber qué día es.
   */
  cabeceraDeHoy: {
    backgroundColor: colors.primary50,
    borderTopLeftRadius: radii.input,
    borderTopRightRadius: radii.input,
  },
  dayBlock: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.base,
  },
}));
