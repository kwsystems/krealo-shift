import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import { chart, chartMarks, colors, sizes, spacing } from '@/theme/tokens';

/**
 * Las siete columnas de la semana: una por día, una sola serie.
 *
 * COLUMNAS Y NO UNA LÍNEA. Siete días son siete cubos cerrados de horas, no una
 * medición continua. Una línea entre dos días dibuja una pendiente que sugiere que a
 * mitad de la noche del martes hubo un valor intermedio, y no lo hubo.
 *
 * EL NÚMERO NO VA EN LAS SIETE. Un valor sobre cada columna es ruido que nadie lee.
 * Se rotula el máximo —la respuesta a «cuál fue el día fuerte», que es la pregunta— y
 * el día señalado. El resto lo lleva la línea del máximo arriba y la lectura al tocar.
 */

export type DayColumn = {
  key: string;
  /** Etiqueta del eje cuando hay sitio: «lun 15». */
  short: string;
  /** Etiqueta del eje en un teléfono, donde «lun 15» siete veces no entra: «lun». */
  tiny: string;
  /** Nombre completo para el lector de pantalla y la lectura. */
  long: string;
  value: number;
  valueText: string;
  /** Hoy se marca, porque un día a medias no se compara con uno completo. */
  isToday?: boolean;
  /** Un día futuro no es un día con cero horas: no se ha trabajado todavía. */
  isFuture?: boolean;
};

export function DayColumns({
  days,
  onPoint,
  pointedKey,
  testID,
}: {
  days: DayColumn[];
  onPoint?: (day: DayColumn | null) => void;
  pointedKey?: string | null;
  testID?: string;
}) {
  const { isCompact } = useResponsive();
  const max = Math.max(...days.map((day) => day.value), 0);
  const escala = max > 0 ? max : 1;
  // Solo el máximo lleva número fijo; si empatan, el primero, para no rotular dos.
  const claveMaxima = max > 0 ? (days.find((day) => day.value === max)?.key ?? null) : null;

  return (
    <Stack gap={spacing.xs} testID={testID}>
      {/*
        La línea del máximo, SIN número encima.
        Lo llevaba, y era la misma cifra dos veces: el techo de la escala es por
        definición el valor de la columna más alta, y esa columna ya lleva su número
        rotulado en la tapa. Repetirlo invitaba a buscar la diferencia entre dos cifras
        que no pueden diferir. Se vio mirando la captura, que es para lo que se mira.
      */}
      <View style={styles.rejilla} />

      <Row align="flex-end" justify="space-between" style={styles.plot}>
        {days.map((day) => {
          const alto =
            day.value > 0
              ? Math.max(3, Math.round((day.value / escala) * chartMarks.columnPlotHeight))
              : 0;
          const rotulado = day.key === claveMaxima || day.key === pointedKey;

          return (
            <Pressable
              key={day.key}
              testID={`day-column-${day.key}`}
              accessibilityLabel={`${day.long}: ${day.valueText}`}
              onHoverIn={() => onPoint?.(day)}
              onHoverOut={() => onPoint?.(null)}
              onPressIn={() => onPoint?.(day)}
              style={styles.columna}
            >
              <View style={styles.tapa}>
                {rotulado ? (
                  <AppText variant="label" tone="muted" tabular numberOfLines={1}>
                    {day.valueText}
                  </AppText>
                ) : null}
              </View>
              <View
                style={[
                  styles.barra,
                  {
                    height: alto,
                    backgroundColor: day.key === pointedKey ? colors.primary700 : chart.series1,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </Row>

      {/* Línea base: aquí apoyan las columnas, así que va pegada al trazado. */}
      <View style={styles.base} />

      <Row justify="space-between">
        {days.map((day) => (
          <View key={day.key} style={styles.etiqueta}>
            <AppText
              variant="label"
              tone={day.isFuture === true ? 'subtle' : 'muted'}
              style={day.isToday === true ? styles.hoy : undefined}
              numberOfLines={1}
            >
              {isCompact ? day.tiny : day.short}
            </AppText>
          </View>
        ))}
      </Row>
    </Stack>
  );
}

const styles = StyleSheet.create({
  rejilla: { height: 1, backgroundColor: chart.grid },
  base: { height: 1, backgroundColor: chart.grid },
  plot: { height: chartMarks.columnPlotHeight + sizes.iconMobile },
  columna: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  // Altura fija para el número: reservada siempre, aunque esa columna no lo lleve.
  // Sin ella, rotular al señalar empujaría la columna hacia abajo y el gráfico
  // entero bailaría bajo el dedo.
  tapa: { height: sizes.iconMobile, justifyContent: 'flex-end', paddingBottom: spacing.xs },
  barra: {
    width: chartMarks.columnThickness,
    borderTopLeftRadius: chartMarks.endRadius,
    borderTopRightRadius: chartMarks.endRadius,
  },
  etiqueta: { flex: 1, alignItems: 'center' },
  hoy: { textDecorationLine: 'underline' },
});
