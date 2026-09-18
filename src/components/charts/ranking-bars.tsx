import { Pressable, View } from 'react-native';

import { Baseline } from './chart-frame';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import { chartMarks, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';

/**
 * Ranking de barras horizontales: la forma para «quién más» y «en qué se va».
 *
 * POR QUÉ HORIZONTAL Y NO COLUMNAS
 * Las categorías son nombres de personas y de motivos, no fechas. En columnas el
 * nombre se pone de lado o se corta; en barras horizontales cabe entero y a tamaño
 * de lectura, y la ordenación de mayor a menor se sigue con el ojo sin esfuerzo.
 *
 * DÓNDE VA EL NÚMERO, Y POR QUÉ NO DENTRO DE LA BARRA
 * En su propia columna a la derecha, alineado. Dentro de la barra el número de la
 * última fila —la más corta— no cabe y se corta, que es peor que no ponerlo; y
 * `overflow: hidden` para "arreglarlo" recorta las cifras, que es peor todavía.
 * Fuera y en columna, además, los números quedan alineados entre sí y se comparan
 * de un vistazo, que es justo lo que el gráfico existe para hacer.
 */

export type RankingSegment = {
  /** Minutos de este tramo. */
  value: number;
  color: string;
  /** Nombre del tramo para el lector de pantalla y la lectura al señalar. */
  label: string;
};

export type RankingRow = {
  id: string;
  label: string;
  /** Uno o dos tramos. Con dos, se apilan y los separa un hueco de superficie. */
  segments: RankingSegment[];
  /** El número que se escribe a la derecha, ya formateado. */
  valueText: string;
  /** Texto de apoyo bajo el nombre (p. ej. «3 de 12 turnos»). */
  hint?: string;
};

export function RankingBars({
  rows,
  /** El 100% de la escala. Todas las filas se miden contra el mismo máximo. */
  max,
  onPoint,
  onPress,
  selectedId,
  testID,
}: {
  rows: RankingRow[];
  max: number;
  /** Señalar una fila (dedo o puntero): alimenta la lectura de `ChartCard`. */
  onPoint?: (row: RankingRow | null) => void;
  onPress?: (row: RankingRow) => void;
  selectedId?: string | null;
  testID?: string;
}) {
  const styles = useEstilos();
  const { isCompact, isWide } = useResponsive();
  // Con `max` a cero todas las barras valen cero: se dividiría por cero y saldría NaN,
  // que en React Native no es una barra vacía sino un ancho inválido.
  const escala = max > 0 ? max : 1;

  return (
    <Stack gap={spacing.sm} testID={testID}>
      {rows.map((row) => {
        const total = row.segments.reduce((suma, tramo) => suma + tramo.value, 0);
        const conValor = row.segments.filter((tramo) => tramo.value > 0);
        const accesible =
          `${row.label}: ${row.valueText}` +
          (conValor.length > 1
            ? `, ${conValor.map((t) => `${t.label} ${Math.round(t.value)}`).join(', ')}`
            : '');

        const barra = (
          <View style={styles.plot}>
            <View style={[styles.bar, { width: `${Math.min(100, (total / escala) * 100)}%` }]}>
              {conValor.map((tramo, indice) => {
                const ultimo = indice === conValor.length - 1;
                return (
                  <View
                    key={tramo.label}
                    style={[
                      styles.segment,
                      {
                        flexGrow: tramo.value,
                        backgroundColor: tramo.color,
                        // Solo el extremo del dato se redondea. El que apoya en la
                        // línea base queda cuadrado, para que se lea como apoyado.
                        borderTopRightRadius: ultimo ? chartMarks.endRadius : 0,
                        borderBottomRightRadius: ultimo ? chartMarks.endRadius : 0,
                        // El hueco en color superficie es lo que separa dos tramos.
                        // Un borde alrededor sería tinta que no es dato.
                        marginRight: ultimo ? 0 : chartMarks.surfaceGap,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        );

        const contenido = isCompact ? (
          <Stack gap={spacing.xs}>
            <Row justify="space-between" gap={spacing.sm}>
              <AppText variant="body" numberOfLines={1} style={styles.nombreAncho}>
                {row.label}
              </AppText>
              <AppText variant="bodyStrong" tabular>
                {row.valueText}
              </AppText>
            </Row>
            {barra}
            {row.hint !== undefined ? (
              <AppText variant="label" tone="subtle">
                {row.hint}
              </AppText>
            ) : null}
          </Stack>
        ) : (
          <Row gap={spacing.md}>
            <View style={isWide ? styles.nombreAncho2 : styles.nombre}>
              <AppText variant="body" numberOfLines={1}>
                {row.label}
              </AppText>
              {row.hint !== undefined ? (
                <AppText variant="label" tone="subtle" numberOfLines={1}>
                  {row.hint}
                </AppText>
              ) : null}
            </View>
            {barra}
            <AppText variant="bodyStrong" tabular style={styles.valor}>
              {row.valueText}
            </AppText>
          </Row>
        );

        return (
          <Pressable
            key={row.id}
            testID={`ranking-row-${row.id}`}
            accessibilityRole={onPress === undefined ? undefined : 'button'}
            accessibilityLabel={accesible}
            accessibilityState={
              selectedId === undefined ? undefined : { selected: selectedId === row.id }
            }
            onHoverIn={() => onPoint?.(row)}
            onHoverOut={() => onPoint?.(null)}
            onPressIn={() => onPoint?.(row)}
            onPress={onPress === undefined ? undefined : () => onPress(row)}
            style={[styles.fila, selectedId === row.id ? styles.filaElegida : null]}
          >
            {contenido}
          </Pressable>
        );
      })}
      <Baseline />
    </Stack>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  fila: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginHorizontal: -spacing.xs,
    borderRadius: spacing.sm,
  },
  filaElegida: { backgroundColor: colors.primary50 },
  /*
   * El ancho del nombre no es uno solo, y no por gusto. Con 132 px fijos, en un monitor
   * salia «Diego Paredes ...» y «Hector Ramirez...» cortados mientras sobraba media
   * pantalla a la derecha; y en una ventana estrecha, 200 px fijos dejarian la barra
   * sin sitio. Se vio en la captura del arnes, no leyendo el codigo.
   */
  nombre: { width: 132 },
  nombreAncho2: { width: 208 },
  nombreAncho: { flexShrink: 1 },
  valor: { width: 72, textAlign: 'right' },
  // El área de trazado ocupa lo que sobra: así todas las filas comparten escala.
  plot: { flex: 1, justifyContent: 'center', minHeight: chartMarks.barThickness },
  bar: { flexDirection: 'row', height: chartMarks.barThickness, minWidth: 2 },
  segment: { height: chartMarks.barThickness, flexBasis: 0 },
}));

/*
 * Aquí había un `export const SERIE_UNICA = chart.series1`. Se borra por dos razones:
 * no lo usaba nadie —ni un solo sitio en todo el proyecto— y era color congelado, que
 * es justo lo que esta tarea vino a quitar. Quien necesite ese color lo pide con
 * `chart(colors).series1`, que sabe en qué tema está.
 */
