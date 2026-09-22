import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { fontFamily, fontSize, lineHeight, type ColorSet } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * Único componente de texto de la app. Los componentes no fijan tamaños ni
 * colores a mano: eligen una variante y un tono de esta lista (§5).
 */
export type TextVariant =
  'kioskClock' | 'kioskTitle' | 'title' | 'section' | 'body' | 'bodyStrong' | 'help' | 'label';

export type TextTone =
  'default' | 'muted' | 'subtle' | 'onPrimary' | 'success' | 'warning' | 'danger' | 'primary';

type Props = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Números tabulares para horas y totales, para que no bailen los dígitos (§5). */
  tabular?: boolean;
  /** Sobrescribe el tamaño cuando el kiosco interpola según ancho. */
  size?: number;
  /**
   * Este texto vive en una caja de tamaño fijo, así que no puede crecer con el ajuste
   * de «tamaño del texto» del sistema.
   *
   * Existe para el caso en que la caja es fija pero el tamaño NO se calcula: la
   * etiqueta «Borrar» del teclado del reloj, dentro de un círculo de diámetro fijo. El
   * primer intento fue pasarle un `size` con el valor que ya tenía, y era un error
   * sutil: `size` reescribe también el alto de línea con otro multiplicador —`tight` en
   * vez del `relaxed` de su variante—, así que la etiqueta habría pasado de 21 a 16 px
   * de alto de línea. Yo lo había escrito como «no cambia nada de lo que se ve», y no
   * era verdad. Una propiedad que dice lo que quiere decir no deforma nada.
   */
  enCajaFija?: boolean;
};

/**
 * El color de cada tono, como FUNCIÓN del juego de color.
 *
 * Era un objeto constante y por tanto el color de TODO EL TEXTO de la app quedaba fijado
 * al cargar este módulo. Es el caso más caro de los colores congelados: no afecta a una
 * pantalla, afecta a cada palabra.
 *
 * `onPrimary` ya no es `white`: en oscuro el acento se aclara y el blanco encima se
 * queda en 3,65:1. Ese token existe justo para esto.
 */
const colorDelTono = (colors: ColorSet): Record<TextTone, string> => ({
  default: colors.ink900,
  muted: colors.ink700,
  subtle: colors.ink500,
  onPrimary: colors.onPrimary,
  success: colors.success600,
  warning: colors.warning600,
  danger: colors.danger600,
  primary: colors.primary600,
});

export function AppText({
  variant = 'body',
  tone = 'default',
  tabular = false,
  size,
  enCajaFija = false,
  style,
  ...rest
}: Props) {
  const { colors } = useTheme();
  // `styles` sigue siendo una constante de módulo a propósito: esta hoja solo lleva
  // tipografía y medidas, que no dependen del tema. Solo el color se resuelve por tema.
  const base = styles[variant] as TextStyle;

  /*
   * EL ESCALADO DE TEXTO DEL SISTEMA SE CORTA DONDE EL TAMAÑO YA SE CALCULÓ, y en
   * ningún otro sitio.
   *
   * En React Native el texto crece con el ajuste de «tamaño del texto» del sistema, sin
   * tope, y eso es una función de accesibilidad de verdad: quien la necesita la usa. Por
   * eso NO se apaga en el panel, donde el texto se lee y crecer solo ayuda.
   *
   * Donde sí se corta es donde el tamaño viene de una medida de la pantalla. El reloj
   * de fichaje interpola su hora y sus títulos entre un mínimo y un máximo según el
   * ancho y el alto disponibles (`scaleFont` y `scaleFontAlto`), y los dígitos del
   * teclado salen del diámetro de su tecla. Multiplicar eso por el ajuste del sistema
   * no lo hace más legible: lo escala DOS VECES y rompe el encaje que el cálculo
   * acababa de conseguir.
   *
   * Y ahí encajar no es un detalle: `kiosco:check` pasa con DIEZ píxeles de holgura en
   * un iPhone SE de 320×568. Diez píxeles no sobreviven a un multiplicador de texto, y
   * el síntoma sería la última fila del teclado —«Borrar», «0» y el borrado de dígito—
   * fuera de la pantalla, en un iPad atornillado a la pared. Nadie podría fichar y no
   * habría nada que tocar para arreglarlo.
   *
   * La señal es que el llamante haya calculado el tamaño, que la variante sea del reloj,
   * o que lo diga explícitamente con `enCajaFija`. No una lista de componentes: una
   * lista se queda desactualizada en el momento en que alguien añade una pantalla.
   */
  const tamanoYaCalculado =
    size !== undefined || enCajaFija || variant === 'kioskClock' || variant === 'kioskTitle';

  return (
    <Text
      {...rest}
      allowFontScaling={!tamanoYaCalculado}
      style={[
        base,
        { color: colorDelTono(colors)[tone] },
        size !== undefined
          ? { fontSize: size, lineHeight: Math.round(size * lineHeight.tight) }
          : null,
        tabular ? styles.tabular : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  kioskClock: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.kioskClockMin,
    lineHeight: Math.round(fontSize.kioskClockMin * lineHeight.tight),
  },
  kioskTitle: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.kioskTitleMin,
    lineHeight: Math.round(fontSize.kioskTitleMin * lineHeight.tight),
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.titleMobileMin,
    lineHeight: Math.round(fontSize.titleMobileMin * lineHeight.tight),
  },
  section: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sectionMin,
    lineHeight: Math.round(fontSize.sectionMin * lineHeight.normal),
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.relaxed),
  },
  bodyStrong: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.relaxed),
  },
  help: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.help,
    lineHeight: Math.round(fontSize.help * lineHeight.relaxed),
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.label,
    lineHeight: Math.round(fontSize.label * lineHeight.normal),
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
