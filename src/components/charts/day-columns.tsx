import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { chart, chartMarks, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';

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
  /**
   * LO PROGRAMADO ESE DÍA (2-oct), dibujado como el contorno de la columna que se esperaba:
   * la columna llena es lo trabajado, el contorno detrás es lo que se programó. Programado
   * contra real en cada día, como en Homebase.
   */
  planned?: number;
  /** «08:00 programadas», para el lector de pantalla y la lectura al señalar. */
  plannedLabel?: string;
};

/**
 * Ancho de etiqueta por debajo del cual la larga («dom 27») ya no cabe.
 *
 * Medido, no estimado: «dom 27» pide 42 px y es la más ancha de las siete en español.
 * Se piden 46 para dejar cuatro de aire: un umbral que acierte justo al píxel vuelve a
 * recortar en cuanto cambie una fuente o una traducción.
 */
const ANCHO_MINIMO_ETIQUETA_LARGA = 46;

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
  const { colors } = useTheme();
  const styles = useEstilos();
  /**
   * Ancho de UNA columna, medido. 0 hasta el primer layout.
   *
   * SE MIDE EN VEZ DE DEDUCIRLO DEL ANCHO DE LA VENTANA, y ese era el fallo. La
   * etiqueta se elegía con `isCompact`, o sea «la ventana mide menos de 400 px», y lo
   * que decide si «dom 27» cabe no es la ventana: es su propia casilla, que son siete
   * repartiéndose una tarjeta cuyo ancho depende del panel y de la barra lateral. El
   * resultado medido era absurdo: a 390 px salía «D 27» y cabía, y a 414 px —más
   * ancho— salía «dom 27» recortado a «dom…». Una pantalla mayor mostrando menos.
   *
   * Y SE MIDE LA CASILLA, NO LA FILA PARTIDA EN SIETE. Lo intenté así primero y a 430 px
   * seguía recortando: la fila incluye los huecos entre etiquetas, así que dividirla
   * entre siete daba 49 px donde la casilla real medía 38. Once píxeles de más, que son
   * exactamente la diferencia entre caber y no caber.
   *
   * No oscila: la casilla es `flex: 1`, así que su ancho lo fija el reparto de la fila y
   * no el texto que se elija.
   */
  const [anchoDeEtiqueta, setAnchoDeEtiqueta] = useState(0);
  const max = Math.max(...days.map((day) => Math.max(day.value, day.planned ?? 0)), 0);
  const maxTrabajado = Math.max(...days.map((day) => day.value), 0);
  const escala = max > 0 ? max : 1;
  // Solo el máximo lleva número fijo; si empatan, el primero, para no rotular dos.
  const claveMaxima =
    maxTrabajado > 0 ? (days.find((day) => day.value === maxTrabajado)?.key ?? null) : null;

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
          const altoProgramado =
            (day.planned ?? 0) > 0
              ? Math.max(3, Math.round(((day.planned ?? 0) / escala) * chartMarks.columnPlotHeight))
              : 0;

          return (
            <Pressable
              key={day.key}
              testID={`day-column-${day.key}`}
              // El valor trabajado va el ÚLTIMO: los arneses leen la última cifra.
              accessibilityLabel={
                day.plannedLabel === undefined
                  ? `${day.long}: ${day.valueText}`
                  : `${day.long}: ${day.plannedLabel}, ${day.valueText}`
              }
              onHoverIn={() => onPoint?.(day)}
              onHoverOut={() => onPoint?.(null)}
              onPressIn={() => onPoint?.(day)}
              /*
               * `onPress` ADEMÁS de `onPressIn`, y no es redundante: era una parada del
               * teclado que no hacía nada.
               *
               * `Pressable` en web se pinta con `tabindex`, así que estas siete columnas
               * están en el recorrido del tabulador. Pero solo respondían a `onPressIn`
               * y a `onHoverIn`, y ninguno de los dos se dispara con Enter: quien navega
               * con teclado pasaba por siete paradas y pulsar no mostraba el valor. La
               * alternativa —sacarlas del recorrido— era peor: su `accessibilityLabel`
               * es la única forma de que un lector de pantalla lea el dato de cada día.
               */
              onPress={() => onPoint?.(day)}
              style={styles.columna}
            >
              <View style={styles.tapa}>
                {rotulado ? (
                  <AppText variant="label" tone="muted" tabular numberOfLines={1}>
                    {day.valueText}
                  </AppText>
                ) : null}
              </View>
              <View style={[styles.pila, { height: Math.max(alto, altoProgramado) }]}>
                {altoProgramado > 0 ? (
                  <View
                    style={[styles.programado, { height: altoProgramado }]}
                    testID={`day-planned-${day.key}`}
                  />
                ) : null}
                <View
                  style={[
                    styles.barra,
                    {
                      height: alto,
                      backgroundColor:
                        day.key === pointedKey ? colors.primary700 : chart(colors).series1,
                    },
                  ]}
                />
              </View>
            </Pressable>
          );
        })}
      </Row>

      {/* Línea base: aquí apoyan las columnas, así que va pegada al trazado. */}
      <View style={styles.base} />

      {/*
        El ancho se toma de la fila de etiquetas y se divide entre los días: es el mismo
        reparto que hace `justify="space-between"` con columnas de `flex: 1`.
      */}
      <Row justify="space-between">
        {days.map((day, indice) => (
          <View
            key={day.key}
            style={styles.etiqueta}
            /*
              Basta con medir la PRIMERA: las siete son `flex: 1` y se reparten la fila
              a partes iguales. Medirlas todas serían siete `setState` por layout para
              guardar el mismo número.
            */
            onLayout={
              indice === 0
                ? (evento: LayoutChangeEvent) => setAnchoDeEtiqueta(evento.nativeEvent.layout.width)
                : undefined
            }
          >
            <AppText
              variant="label"
              tone={day.isFuture === true ? 'subtle' : 'muted'}
              style={day.isToday === true ? styles.hoy : undefined}
              numberOfLines={1}
            >
              {anchoDeEtiqueta < ANCHO_MINIMO_ETIQUETA_LARGA ? day.tiny : day.short}
            </AppText>
          </View>
        ))}
      </Row>
    </Stack>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  rejilla: { height: 1, backgroundColor: chart(colors).grid },
  base: { height: 1, backgroundColor: chart(colors).grid },
  plot: { height: chartMarks.columnPlotHeight + sizes.iconMobile },
  columna: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  // Altura fija para el número: reservada siempre, aunque esa columna no lo lleve.
  // Sin ella, rotular al señalar empujaría la columna hacia abajo y el gráfico
  // entero bailaría bajo el dedo.
  tapa: { height: sizes.iconMobile, justifyContent: 'flex-end', paddingBottom: spacing.xs },
  /* La columna y su contorno de lo programado, apoyados los dos en la línea base. */
  pila: {
    width: chartMarks.columnThickness + 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  /*
   * LO PROGRAMADO EN CONTORNO, más ancho que la columna para que se vea alrededor de ella:
   * `reglaFuerte` llega al 3:1 que pide una marca con significado, y no es un relleno porque
   * no es algo que pasó.
   */
  programado: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.reglaFuerte,
    backgroundColor: colors.hundido,
    borderTopLeftRadius: chartMarks.endRadius,
    borderTopRightRadius: chartMarks.endRadius,
  },
  barra: {
    width: chartMarks.columnThickness,
    borderTopLeftRadius: chartMarks.endRadius,
    borderTopRightRadius: chartMarks.endRadius,
  },
  etiqueta: { flex: 1, alignItems: 'center' },
  hoy: { textDecorationLine: 'underline' },
}));
