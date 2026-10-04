import { useState } from 'react';
import { Platform, ScrollView, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  EmptyShiftSlot,
  minutoDelDia,
  RestDayChip,
  ShiftCard,
  ventanaDeLosTurnos,
} from './shift-card';
import { ChipDeDisponibilidad } from '@/components/availability/chip-de-disponibilidad';
import { tonoDelPuesto } from '@/theme/tonos';
import {
  chocaConElTurno,
  disponibilidadDelDia,
  type Disponibilidad,
} from '@/features/availability/disponibilidad';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import type { ShiftRow } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import type { EstadoDelTurno } from '@/features/schedules/en-turno';
import { contarFaltas, type Falta } from '@/features/timesheets/faltas';
import { EtiquetaDeFeriado } from '@/components/schedule/feriado';
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
 * LA COLUMNA DE NOMBRES NO SE VA AL ARRASTRAR.
 *
 * EL FALLO QUE ARREGLA, que no es el que parecía. Por debajo de 1120 px la rejilla se
 * arrastra en horizontal, y la respuesta obvia —apretar las columnas— está medida y
 * descartada: meter siete días en 1280 pide columnas de 116 px, y ahí el turno deja de
 * leerse. Un horario con turnos ilegibles es peor que uno que se arrastra.
 *
 * Pero al arrastrar hacia el domingo se iba TAMBIÉN la columna de empleados, así que
 * dejabas de ver de quién era la fila que estabas mirando. Eso sí es un fallo, y es el
 * que molesta de verdad: sin el nombre delante, una rejilla de turnos es una cuadrícula
 * de horas sin dueño, y poner un turno en la fila equivocada es un error que llega hasta
 * la tienda. Con la columna fija, arrastrar pasa de perder información a solo pedir un
 * gesto: es como funciona cualquier hoja de cálculo, y por la misma razón.
 *
 * `position: 'sticky'` EXISTE EN react-native-web Y NO ESTÁ EN LOS TIPOS DE RN, de ahí el
 * casteo. En nativo no se aplica —ahí `ScrollView` no es un contenedor CSS con scroll— y
 * la rejilla se queda como estaba, que es lo correcto: el panel se usa en web.
 *
 * EL LÍMITE, dicho en voz alta: el horario semanal se ARMA en pantalla grande. De 1440 px
 * para arriba cabe la semana entera sin arrastrar; por debajo se arrastra con los nombres
 * delante, y en un teléfono la vista Semana ya cae sola en la lista por días.
 */
const COLUMNA_PEGAJOSA = { position: 'sticky', left: 0, zIndex: 1 } as unknown as ViewStyle;

/**
 * Turno con su fecha local ya calculada, para no repetir la conversión de zona
 * horaria en cada celda de la cuadrícula.
 */
export type DatedShift = ShiftRow & { dateKey: DateKey };

/** Día libre marcado, ya asociado a su persona y a su día. */
export type DatedRestDay = { id: string; employeeId: string; dateKey: DateKey };

export type EmployeeRow = {
  employeeId: string;
  name: string;
  shifts: DatedShift[];
  restDays: DatedRestDay[];
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
  /** Si la persona de ese turno está dentro ahora. Sin él, ninguna tarjeta se pinta. */
  enCursoFor?: (shift: ShiftRow) => EstadoDelTurno;
  onSelectShift: (shift: ShiftRow) => void;
  onAddShift: (params: { employeeId: string; dateKey: DateKey }) => void;
  onSelectRestDay: (restDay: DatedRestDay) => void;
  readOnly?: boolean;
  /** Lo que cada persona dijo de sus días (1-oct): sale en su celda y avisa en su turno. */
  disponibilidad?: readonly Disponibilidad[];
  /** Los turnos que son falta (1-oct), con lo que se dijo de cada una: ver `faltas.ts`. */
  faltas?: ReadonlyMap<string, Falta>;
  /** Los turnos en curso de quien no ha llegado (2-oct): ver `turnoSinLlegar`. */
  sinLlegar?: ReadonlySet<string>;
  /** Los turnos cumplidos por un motivo especial (4-oct), con su jornada: ver `creditShiftAsWorked`. */
  cumplidos?: ReadonlyMap<string, { credit_reason: string | null; credit_note?: string | null }>;
};

/**
 * ¿Este turno choca con lo que la persona dijo de ese día? Devuelve el texto del aviso o
 * `null`. Lo usan la rejilla y la lista por días.
 */
function avisoDeDisponibilidad(
  filas: readonly Disponibilidad[],
  shift: DatedShift,
  timezone: string,
  texto: string,
): string | null {
  const turno = {
    desde: minutoDelDia(shift.starts_at, timezone),
    hasta: minutoDelDia(shift.ends_at, timezone),
  };
  return disponibilidadDelDia(filas, shift.employee_id, shift.dateKey).some((fila) =>
    chocaConElTurno(fila, turno),
  )
    ? texto
    : null;
}

const SIN_FALTAS: ReadonlyMap<string, Falta> = new Map();
const NADIE_SIN_LLEGAR: ReadonlySet<string> = new Set();
const NINGUN_CUMPLIDO: ReadonlyMap<
  string,
  { credit_reason: string | null; credit_note?: string | null }
> = new Map();

export function WeekGrid({
  days,
  rows,
  todayKey,
  timezone,
  timeFormat,
  language,
  jobRoleNames,
  warningsFor,
  enCursoFor,
  onSelectShift,
  onAddShift,
  onSelectRestDay,
  readOnly = false,
  disponibilidad = [],
  faltas = SIN_FALTAS,
  sinLlegar = NADIE_SIN_LLEGAR,
  cumplidos = NINGUN_CUMPLIDO,
}: GridProps) {
  const styles = useEstilos();
  const { t } = useTranslation();
  /* Solo en web: ver `COLUMNA_PEGAJOSA`. En nativo no hay `sticky` que valga. */
  const fija = Platform.OS === 'web' ? styles.columnaFija : null;
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
  /* La regla de la franja de cada turno: el día de la tienda en ESTA semana. */
  const ventana = ventanaDeLosTurnos(
    rows.flatMap((row) => row.shifts),
    timezone,
  );

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
      /* Lo usa `responsive:check` para que su exención de arrastre sea SOLO de la rejilla. */
      testID="week-grid"
      onLayout={(evento: LayoutChangeEvent) => setAnchoVisible(evento.nativeEvent.layout.width)}
    >
      <View>
        <Row gap={0} align="stretch">
          <View style={[styles.headerCell, styles.nameColumn, fija]} testID="grid-name-header">
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
              /* El día en el identificador, no solo en el rótulo: un arnés necesita saber
                 QUE semana está mirando, y el rótulo («lun 28») depende del idioma. */
              testID={`grid-day-${day}`}
            >
              <AppText variant="label" tone={day === todayKey ? 'primary' : 'subtle'}>
                {formatDayColumn(day, language)}
              </AppText>
              {/* El feriado, al armar el horario: ver `src/domain/feriados-peru.ts`. */}
              <EtiquetaDeFeriado dateKey={day} timezone={timezone} />
            </View>
          ))}
        </Row>

        {rows.map((row) => (
          <Row key={row.employeeId} gap={0} align="stretch">
            <View
              style={[styles.cell, styles.nameColumn, fija]}
              testID={`grid-name-${row.employeeId}`}
            >
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
              {/* Sus faltas de la semana, contadas al lado de su nombre: se ven sin buscarlas. */}
              {(() => {
                const suyas = row.shifts.flatMap((shift) => {
                  const falta = faltas.get(shift.id);
                  return falta === undefined ? [] : [falta];
                });
                if (suyas.length === 0) return null;
                // Ámbar si todas están justificadas: ya no cuentan en contra.
                const enContra = contarFaltas(suyas).sinJustificar > 0;
                return (
                  <AppText
                    variant="label"
                    tone={enContra ? 'danger' : 'warning'}
                    testID={`grid-faltas-${row.employeeId}`}
                  >
                    {t('schedule.absencesCount', { count: suyas.length })}
                  </AppText>
                );
              })()}
            </View>

            {days.map((day) => {
              const dayShifts = row.shifts.filter((shift) => shift.dateKey === day);
              const descanso = row.restDays.find((libre) => libre.dateKey === day);
              const loQueDijo = disponibilidadDelDia(disponibilidad, row.employeeId, day);
              return (
                <View key={`${row.employeeId}-${day}`} style={[styles.cell, { width: anchoDeDia }]}>
                  <Stack gap={spacing.xs}>
                    {/*
                      LO QUE DIJO DE ESE DÍA, arriba de todo (1-oct): «no puede», «prefiere
                      14:00–22:00» o un comentario. Se ve al poner el turno, que es cuando
                      sirve. El comentario entero está en Equipo → Disponibilidad.
                    */}
                    {loQueDijo.map((fila) => (
                      <ChipDeDisponibilidad
                        key={fila.id}
                        fila={fila}
                        testID={`grid-disponibilidad-${row.employeeId}-${day}`}
                      />
                    ))}
                    {descanso === undefined ? null : (
                      <RestDayChip
                        label={t('schedule.restDay')}
                        onPress={readOnly ? undefined : () => onSelectRestDay(descanso)}
                        accessibilityLabel={t('schedule.restDayFor', {
                          name: row.name,
                          date: formatDateKeyShort(day, language),
                        })}
                        testID={`rest-day-${row.employeeId}-${day}`}
                      />
                    )}
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
                        enCurso={enCursoFor?.(shift) ?? null}
                        falta={faltas.get(shift.id) ?? null}
                        sinLlegar={sinLlegar.has(shift.id)}
                        cumplido={cumplidos.get(shift.id) ?? null}
                        ventana={ventana}
                        tonoDelPuesto={tonoDelPuesto([...jobRoleNames.keys()], shift.job_role_id)}
                        avisoDeDisponibilidad={avisoDeDisponibilidad(
                          disponibilidad,
                          shift,
                          timezone,
                          t('availability.conflict'),
                        )}
                        onPress={readOnly ? undefined : onSelectShift}
                        testID={`shift-${shift.id}`}
                      />
                    ))}
                    {/*
                      EL «+» SOLO EN EL HUECO (1-oct). Iba también debajo de cada turno y de
                      cada descanso, y doblaba el alto de todas las filas: con ocho personas
                      la semana no cabía en un monitor de 1080. Un segundo turno el mismo día
                      se pone con «Duplicar» en la hoja del turno, o con «Agregar turno».
                    */}
                    {readOnly || dayShifts.length > 0 || descanso !== undefined ? null : (
                      <EmptyShiftSlot
                        sutil
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
  restDaysByDay: Map<DateKey, DatedRestDay[]>;
  employeeNames: Map<string, string>;
  jobRoleNames: Map<string, string>;
  todayKey: DateKey;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  warningsFor: (shiftId: string) => ScheduleWarning[];
  /** Si la persona de ese turno está dentro ahora. Sin él, ninguna tarjeta se pinta. */
  enCursoFor?: (shift: ShiftRow) => EstadoDelTurno;
  onSelectShift: (shift: ShiftRow) => void;
  onAddShift: (params: { dateKey: DateKey }) => void;
  onSelectRestDay: (restDay: DatedRestDay) => void;
  readOnly?: boolean;
  disponibilidad?: readonly Disponibilidad[];
  faltas?: ReadonlyMap<string, Falta>;
  /** Los turnos en curso de quien no ha llegado (2-oct): ver `turnoSinLlegar`. */
  sinLlegar?: ReadonlySet<string>;
  /** Los turnos cumplidos por un motivo especial (4-oct), con su jornada: ver `creditShiftAsWorked`. */
  cumplidos?: ReadonlyMap<string, { credit_reason: string | null; credit_note?: string | null }>;
};

export function DayList({
  days,
  shiftsByDay,
  restDaysByDay,
  employeeNames,
  jobRoleNames,
  todayKey,
  timezone,
  timeFormat,
  language,
  warningsFor,
  enCursoFor,
  onSelectShift,
  onAddShift,
  onSelectRestDay,
  readOnly = false,
  disponibilidad = [],
  faltas = SIN_FALTAS,
  sinLlegar = NADIE_SIN_LLEGAR,
  cumplidos = NINGUN_CUMPLIDO,
}: DayListProps) {
  const styles = useEstilos();
  const { t } = useTranslation();
  const ventana = ventanaDeLosTurnos(Array.from(shiftsByDay.values()).flat(), timezone);

  return (
    <Stack gap={spacing.md}>
      {days.map((day) => {
        const dayShifts = shiftsByDay.get(day) ?? [];
        const descansos = restDaysByDay.get(day) ?? [];
        return (
          <View key={day} style={styles.dayBlock}>
            <Row justify="space-between">
              <Stack gap={spacing.xs} style={styles.encoge}>
                <AppText variant="bodyStrong" tone={day === todayKey ? 'primary' : 'default'}>
                  {formatDayColumn(day, language)}
                </AppText>
                <EtiquetaDeFeriado dateKey={day} timezone={timezone} />
              </Stack>
              <AppText variant="label" tone="subtle" tabular>
                {t('schedule.shiftsCount', { count: dayShifts.length })}
              </AppText>
            </Row>

            {/* Lo que dijo cada persona de ese día, con su nombre: aquí no hay fila de persona. */}
            {(() => {
              const personas = [...new Set(disponibilidad.map((fila) => fila.employee_id))];
              const delDia = personas.flatMap((persona) =>
                disponibilidadDelDia(disponibilidad, persona, day),
              );
              return delDia.length === 0 ? null : (
                <Row gap={spacing.xs} wrap>
                  {delDia.map((fila) => (
                    <ChipDeDisponibilidad
                      key={fila.id}
                      fila={fila}
                      nombre={employeeNames.get(fila.employee_id) ?? ''}
                      testID={`dia-disponibilidad-${fila.employee_id}-${day}`}
                    />
                  ))}
                </Row>
              );
            })()}

            {dayShifts.length === 0 && descansos.length === 0 ? (
              <AppText variant="help" tone="subtle">
                {t('schedule.noShiftsThatDay')}
              </AppText>
            ) : dayShifts.length === 0 ? null : (
              <Stack gap={spacing.xs}>
                {dayShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    enFila
                    ventana={ventana}
                    tonoDelPuesto={tonoDelPuesto([...jobRoleNames.keys()], shift.job_role_id)}
                    avisoDeDisponibilidad={avisoDeDisponibilidad(
                      disponibilidad,
                      shift,
                      timezone,
                      t('availability.conflict'),
                    )}
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
                    enCurso={enCursoFor?.(shift) ?? null}
                    falta={faltas.get(shift.id) ?? null}
                    sinLlegar={sinLlegar.has(shift.id)}
                    cumplido={cumplidos.get(shift.id) ?? null}
                    onPress={readOnly ? undefined : onSelectShift}
                    testID={`shift-${shift.id}`}
                  />
                ))}
              </Stack>
            )}

            {/*
              LOS DIAS LIBRES, DESPUES DE LOS TURNOS Y CON NOMBRE. En la lista por días de
              un teléfono no hay columna de persona, así que un «Descanso» a secas no
              diría de quién es: el nombre va dentro de la etiqueta.
            */}
            {descansos.length === 0 ? null : (
              <Stack gap={spacing.xs}>
                {descansos.map((descanso) => (
                  <RestDayChip
                    key={descanso.id}
                    label={t('schedule.restDayOf', {
                      name: employeeNames.get(descanso.employeeId) ?? '',
                    })}
                    onPress={readOnly ? undefined : () => onSelectRestDay(descanso)}
                    accessibilityLabel={t('schedule.restDayFor', {
                      name: employeeNames.get(descanso.employeeId) ?? '',
                      date: formatDateKeyShort(day, language),
                    })}
                    testID={`rest-day-${descanso.employeeId}-${day}`}
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
    /*
     * ARRIBA Y NO AL CENTRO: la semana de un feriado, su columna lleva dos líneas y la
     * fila crece; centradas, las demás bajaban y los nombres de los días quedaban a
     * alturas distintas.
     */
    justifyContent: 'flex-start',
    // El día y, si lo es, «Feriado · …» debajo: sin hueco, la segunda línea se pegaba.
    gap: spacing.xs,
  },
  /* El nombre del día se encoge antes que el recuento de turnos: el del feriado es largo. */
  encoge: { flexShrink: 1, minWidth: 0 },
  cell: {
    /*
     * CUATRO DE LADO Y NO OCHO (1-oct): en 1280 la columna queda en su mínimo de 136 y
     * con ocho la hora del turno se partía en dos líneas por cuatro píxeles.
     */
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  nameColumn: { width: NAME_COLUMN_WIDTH, flexGrow: 0, flexShrink: 0 },
  /*
    EL FONDO Y EL FILO NO SON ADORNO. Una columna pegajosa sin fondo deja que los días
    pasen POR DEBAJO del nombre y se lean los dos a la vez, que es peor que no fijarla.
    Y el filo derecho es lo que dice que la rejilla sigue: sin él, la columna fija y la
    primera de días se leen como una sola tabla que casualmente no se mueve.
  */
  columnaFija: {
    ...COLUMNA_PEGAJOSA,
    backgroundColor: colors.canvas,
    borderRightWidth: borderWidth.hairline,
    borderRightColor: colors.border,
  },
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
    padding: spacing.md,
  },
}));
