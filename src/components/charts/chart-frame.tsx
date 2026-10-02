import type { ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Card, Row, Stack } from '@/components/ui/layout';
import { chart, radii, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';

/**
 * El marco común de todos los gráficos: título, lectura, leyenda y nota al pie.
 *
 * Existe para que las cuatro respuestas del tablero se lean como el mismo objeto y
 * no como cuatro tarjetas inventadas por separado, y para tener UN solo sitio donde
 * se cumple la regla de la leyenda: obligatoria en cuanto hay dos series, prohibida
 * cuando hay una sola —una caja con un único cuadrito no dice nada que el título no
 * diga ya, y se come el espacio del gráfico.
 */

export type LegendItem = {
  color: string;
  label: string;
  /** Muestra en contorno: lo que se esperaba, no lo que pasó (lo programado). */
  contorno?: boolean;
  /** El color del contorno, si no es el de la regla: el tramo hueco de `RankingBars`. */
  borde?: string;
};

export function ChartCard({
  title,
  subtitle,
  legend,
  readout,
  footnote,
  children,
  estirar = false,
  testID,
}: {
  title: string;
  subtitle?: string;
  /** Dos o más entradas pintan la leyenda; una sola NO pinta nada, a propósito. */
  legend?: LegendItem[];
  /**
   * La capa de detalle, adaptada a una app que se toca.
   *
   * En un gráfico HTML esto sería el tooltip al pasar el ratón. En un iPad no hay
   * ratón, así que el dato del elemento señalado —por dedo o por puntero— se escribe
   * aquí, en un sitio fijo bajo el título, en vez de en una burbuja flotante que el
   * propio dedo tapa.
   */
  readout?: string | null;
  footnote?: string;
  children: ReactNode;
  /** Llenar el alto de su celda: dos tarjetas lado a lado miden lo mismo. */
  estirar?: boolean;
  testID?: string;
}) {
  const styles = useEstilos();
  const hayLeyenda = legend !== undefined && legend.length >= 2;

  return (
    <Card testID={testID} style={estirar ? ESTIRADA : undefined}>
      <Stack gap={spacing.xs}>
        <AppText variant="section" accessibilityRole="header">
          {title}
        </AppText>
        {/*
          La lectura sustituye al subtítulo cuando hay algo señalado: son la misma
          línea, así que señalar no mueve el gráfico ni un píxel hacia abajo. Un
          gráfico que da un salto al tocarlo se siente roto.
        */}
        {readout !== undefined && readout !== null ? (
          <AppText variant="help" tone="default" testID={`${testID ?? 'chart'}-readout`}>
            {readout}
          </AppText>
        ) : subtitle !== undefined ? (
          <AppText variant="help" tone="subtle">
            {subtitle}
          </AppText>
        ) : null}
      </Stack>

      {hayLeyenda ? (
        <Row gap={spacing.base} wrap>
          {legend.map((item) => (
            <Row key={item.label} gap={spacing.xs}>
              <View
                style={[
                  styles.swatch,
                  item.contorno === true
                    ? {
                        backgroundColor: item.color,
                        borderWidth: item.borde === undefined ? 1 : 1.5,
                        borderColor: item.borde ?? styles.contorno.borderColor,
                      }
                    : { backgroundColor: item.color },
                ]}
              />
              {/* El texto va en tinta, NUNCA del color de la serie: el cuadrito de al
                  lado es el que lleva la identidad. */}
              <AppText variant="label" tone="muted">
                {item.label}
              </AppText>
            </Row>
          ))}
        </Row>
      ) : null}

      {children}

      {footnote !== undefined ? (
        <AppText variant="label" tone="subtle">
          {footnote}
        </AppText>
      ) : null}
    </Card>
  );
}

const ESTIRADA = { flexGrow: 1 } as const;

/** Línea base del gráfico: un pelo sólido, del color de la rejilla. Nunca punteada. */
export function Baseline() {
  const styles = useEstilos();
  return <View style={styles.baseline} />;
}

const useEstilos = estilosDelTema((colors) => ({
  swatch: { width: 12, height: 12, borderRadius: radii.pill, backgroundColor: colors.border },
  contorno: { borderColor: colors.reglaFuerte },
  baseline: { height: 1, backgroundColor: chart(colors).grid },
}));
