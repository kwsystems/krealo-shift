import { Children, useState, type ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useResponsive } from '@/hooks/use-responsive';
import { borderWidth, radii, shadows, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';
import type { ColorSet } from '@/theme/tokens';

/**
 * Contenedores base (§25).
 *
 * `ResponsiveContainer` evita los dos defectos que la especificación prohíbe:
 * formularios estrechos flotando en un iPad vacío y tablas de escritorio
 * comprimidas en iPhone (§33).
 */

type ScreenProps = {
  children: ReactNode;
  /** Fondo lavanda del kiosco o lienzo gris de la app administrativa. */
  tone?: 'canvas' | 'kiosk' | 'surface';
  scroll?: boolean;
  /** El kiosco maneja su propio layout a pantalla completa. */
  padded?: boolean;
  style?: ViewStyle;
  testID?: string;
};

/**
 * El fondo de cada tono, como FUNCIÓN del juego de color.
 *
 * Era un objeto constante de módulo, y ahí estaba congelado el color claro: se evaluaba
 * al cargar el archivo y no volvía a mirarse. Es la misma trampa que `StyleSheet.create`,
 * solo que sin StyleSheet, y por eso no la cazó la migración de hojas de estilo —la
 * encontró un barrido aparte de usos de `colors` fuera de toda función—.
 */
const fondoDelTono = (colors: ColorSet) =>
  ({
    canvas: colors.canvas,
    kiosk: colors.primary50,
    surface: colors.surface,
  }) as const;

export function AppScreen({
  children,
  tone = 'canvas',
  scroll = false,
  padded = true,
  style,
  testID,
}: ScreenProps) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const { isCompact } = useResponsive();
  const padding = padded ? (isCompact ? spacing.base : spacing.xl) : 0;

  const content = scroll ? (
    /*
     * AQUÍ HABÍA UN `showsVerticalScrollIndicator={false}`, y se quita. En el teléfono
     * no se notaba —el indicador nativo aparece al arrastrar y se va solo—, pero la web
     * es desde septiembre la superficie principal, y en un navegador esa línea es lo
     * único que dice que una pantalla sigue hacia abajo. Sin ella, Horas y Ajustes
     * parecían terminar donde terminaba la ventana.
     *
     * El aspecto de la barra se define en `app/+html.tsx`, porque no hay forma de
     * pintarla desde React Native.
     */
    <ScrollView
      contentContainerStyle={[{ padding, gap: spacing.base }, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, { padding }, style]}>{children}</View>
  );

  return (
    <SafeAreaView
      testID={testID}
      style={[styles.flex, { backgroundColor: fondoDelTono(colors)[tone] }]}
    >
      {content}
    </SafeAreaView>
  );
}

type ContainerProps = {
  children: ReactNode;
  /** Ancho máximo del contenido centrado. Los formularios usan `form`. */
  width?: 'form' | 'content' | 'full';
  style?: ViewStyle;
};

const maxWidths = {
  form: 520,
  content: 1200,
  full: undefined,
} as const;

export function ResponsiveContainer({ children, width = 'content', style }: ContainerProps) {
  const styles = useEstilos();
  return <View style={[styles.container, { maxWidth: maxWidths[width] }, style]}>{children}</View>;
}

type CardProps = {
  children: ReactNode;
  /** Solo las tarjetas flotantes y los modales llevan sombra (§5). */
  floating?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function Card({ children, floating = false, style, testID }: CardProps) {
  const styles = useEstilos();
  return (
    <View testID={testID} style={[styles.card, floating ? shadows.floating : shadows.card, style]}>
      {children}
    </View>
  );
}

export function Stack({
  children,
  gap = spacing.base,
  style,
  testID,
}: {
  children: ReactNode;
  gap?: number;
  style?: ViewStyle;
  /** Igual que en `Row`: los arneses y las pruebas E2E señalan contenedores. */
  testID?: string;
}) {
  return (
    <View testID={testID} style={[{ gap }, style]}>
      {children}
    </View>
  );
}

export function Row({
  children,
  gap = spacing.md,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const styles = useEstilos();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        styles.row,
        { gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? 'wrap' : 'nowrap' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  flex: { flex: 1 },
  container: { width: '100%', alignSelf: 'center' },
  /*
   * UN PLANO SE VE PORQUE ES UN PLANO, no porque lleve un marco dibujado.
   *
   * La tarjeta se apoya en `surface` sobre el lienzo, y esa diferencia de tono ya la
   * separa en los dos temas (en claro blanco sobre #F7F7FA, en oscuro #1C1A24 sobre
   * #131118). La sombra remata en claro; en oscuro no se ve y no hace falta, porque ahí
   * el salto de color es mayor.
   *
   * SE QUITA EL BORDE porque era la mitad del problema de «demasiado básico»: con un
   * perfil de 1 px en la tarjeta, otro en cada ficha de dentro y otro en cada chip, la
   * pantalla era una pila de marcos del mismo peso y no había forma de saber qué mirar
   * primero. Las fichas de dato se pasaron a plano el mismo día; dejar la tarjeta con
   * marco habría dejado dos lenguajes conviviendo, que es peor que el problema original.
   *
   * Lo que SÍ conserva marco, y a propósito: el aviso importante de Inicio y el botón de
   * peligro. Ahí el marco de color es información, no decoración.
   */
  card: {
    /*
     * `raised` Y NO `surface`, y el token existía sin usarse desde que se escribió el
     * sistema de planos. En CLARO los dos son blanco, así que no cambia nada. En OSCURO
     * `raised` es #252230 contra una superficie #1C1A24: ahí está la elevación, porque en
     * oscuro una sombra negra sobre fondo casi negro no existe. Estaba escrito en el
     * propio proyecto —«en claro la elevación es sombra; en oscuro tiene que ser color»—
     * y no estaba hecho.
     */
    backgroundColor: colors.raised,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: colors.filoElevado,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  row: { flexDirection: 'row' },
  separadorDeRegistro: { height: borderWidth.hairline, backgroundColor: colors.regla },
  separadorDeCabecera: { height: borderWidth.hairline, backgroundColor: colors.reglaFuerte },
  encima: { backgroundColor: colors.encima },
  pulsado: { backgroundColor: colors.pulsado },
  /*
   * EL FOCO ES UN ANILLO POR DENTRO (`borderWidth` hacia adentro no existe en React Native,
   * así que se hace con un borde del ancho de foco y color de acento). Va por dentro y no
   * por fuera para no mover el contenido: un borde que aparece empujaría la fila entera
   * 2 px, y una lista que salta al tabular es peor que una sin foco visible.
   */
  conFoco: {
    borderWidth: borderWidth.focus,
    borderColor: colors.primary500,
    borderRadius: radii.input,
  },
  barra: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    /*
     * ALINEADOS POR ARRIBA, que es donde están sus etiquetas. Con `flex-end` los mandos
     * se alineaban por el suelo, así que el que tuviera dos filas de chips subía su
     * etiqueta y las cuatro quedaban a alturas distintas: la fila se leía torcida sin
     * que nada estuviera mal colocado.
     */
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  /*
   * `flexBasis: 0` con `flexGrow: 1` reparte el sobrante a partes iguales; el `minWidth`
   * que pone quien llama es lo que decide cuándo saltan de renglón en vez de estrujarse.
   */
  celdaDeBarra: { flexGrow: 1, flexBasis: 0 },
  /* La acción no crece: mide lo que mide su etiqueta y se queda al final de la fila. */
  accionDeBarra: { flexGrow: 0, marginLeft: 'auto' },
}));

/**
 * LA BARRA DE CONTROL: los mandos de una pantalla en una fila, no en una pila.
 *
 * POR QUÉ EXISTE, medido y no opinado. En Equipo, a 1366×768, la lista de gente empezaba
 * en y=510: el **66 % de la pantalla era mando**. Cuatro bloques a ancho completo, uno
 * encima de otro —buscador, sede, estado, puesto— cada uno con su etiqueta arriba. En
 * Reportes, el 59 %. Y en Horario, siete filas de mandos antes del primer turno.
 *
 * Lo caro no es cada control: es que cada uno ocupe el ancho entero y se apile. Puestos
 * en fila, los mismos cuatro caben en uno o dos renglones y la pantalla empieza a servir
 * para lo que se abrió.
 *
 * ENVUELVE CADA HIJO, y por eso no vale un `Row` pelado: dentro de una fila, un campo o
 * un selector se estira o se encoge hasta lo ilegible según lo que tenga al lado. Aquí
 * cada uno recibe la misma base flexible con un mínimo, así que crecen juntos y, cuando
 * ya no caben, saltan de renglón en vez de estrujarse.
 *
 * `accion` va al final y separada: es la acción primaria de la pantalla —«Agregar
 * empleado», «Agregar turno»— y tiene que leerse como una cosa distinta de los filtros,
 * no como el quinto mando de la fila.
 */
export function BarraDeControl({
  children,
  accion,
  minimoPorControl = 200,
  testID,
}: {
  children: ReactNode;
  accion?: ReactNode;
  /** Ancho mínimo de cada control antes de saltar de renglón. */
  minimoPorControl?: number;
  testID?: string;
}) {
  const styles = useEstilos();
  return (
    <View style={styles.barra} testID={testID}>
      {Children.map(children, (hijo) =>
        hijo === null || hijo === undefined || hijo === false ? null : (
          <View style={[styles.celdaDeBarra, { minWidth: minimoPorControl }]}>{hijo}</View>
        ),
      )}
      {accion === undefined ? null : <View style={styles.accionDeBarra}>{accion}</View>}
    </View>
  );
}

/**
 * LA SEPARACIÓN DE UN LIBRO DE REGISTRO: una regla fina entre filas, nada más.
 *
 * POR QUÉ. Cada fila de Horas y de Equipo venía envuelta en su propia `Card`, así que una
 * hoja de quince sesiones eran quince planos flotando con su sombra y su hueco: una tabla
 * convertida en una pila de cajas. Y cuesta caro en lo que más falta hace ahí —el alto de
 * pantalla— porque cada caja paga su relleno, su sombra y el hueco con la siguiente.
 *
 * En un libro de registro las filas comparten superficie y las separa una línea. Se lee
 * mejor por la misma razón por la que una tabla se lee mejor que quince fichas: el ojo
 * recorre una columna en vez de saltar entre objetos.
 */
export function SeparadorDeRegistro() {
  const styles = useEstilos();
  return <View style={styles.separadorDeRegistro} testID="separador-de-registro" />;
}

/**
 * La regla de debajo de los rótulos de columna. MÁS MARCADA que las de entre filas, y eso
 * es información y no adorno: separa dos cosas distintas —qué significa cada columna, y
 * los datos— mientras que las de abajo separan dos cosas iguales entre sí. Con todas las
 * rayas al mismo peso, la cabecera se leía como un asiento más de la lista.
 */
export function SeparadorDeCabecera() {
  const styles = useEstilos();
  return <View style={styles.separadorDeCabecera} testID="separador-de-cabecera" />;
}

/**
 * LA RESPUESTA AL PUNTERO, AL DEDO Y AL TECLADO de cualquier cosa que se pulse.
 *
 * POR QUÉ HACÍA FALTA. Contados los elementos pulsables de cinco pantallas —4 en Inicio,
 * 16 en Equipo, 33 en Horas, 88 en Horario, 11 en Reportes— NINGUNO parecía pulsable.
 * Lo único que había era una opacidad del 0,9 al pulsar, o sea una señal que llega cuando
 * ya has decidido pulsar. Al pasar el puntero por encima no pasaba nada en absoluto, y en
 * un panel que se usa con ratón una fila que no responde al puntero se lee como texto.
 *
 * ES UN HOOK Y NO UN COMPONENTE porque los pulsables de esta app ya traen su propio
 * `Pressable` con su `accessibilityRole`, su etiqueta y su pista. Envolverlos en otro
 * componente obligaría a reenviar todo eso, y reenviar props de accesibilidad es
 * exactamente donde se pierden en silencio. Así cada sitio conserva los suyos y solo añade
 * tres cosas.
 *
 * EL FOCO SE PINTA APARTE del ratón, y no es lo mismo: quien navega con teclado necesita
 * ver DÓNDE está, no si algo está caliente. Por eso es un anillo y no un fondo.
 *
 * Uso:
 *   const respuesta = useRespuestaAlPuntero();
 *   <Pressable {...respuesta.props} ...>
 *     {({ pressed }) => <View style={[estilos.fila, ...respuesta.estilo(pressed)]}>…</View>}
 *   </Pressable>
 *
 * El estilo va en el hijo y no en el `Pressable` a propósito: el hijo es quien lleva el
 * color de superficie, así que un fondo puesto en el padre quedaría tapado por él.
 */
export function useRespuestaAlPuntero() {
  const [encima, setEncima] = useState(false);
  const [conFoco, setConFoco] = useState(false);
  const estilos = useEstilos();

  return {
    props: {
      onHoverIn: () => setEncima(true),
      onHoverOut: () => setEncima(false),
      onFocus: () => setConFoco(true),
      onBlur: () => setConFoco(false),
    },
    /** `pressed` manda sobre el puntero: si estás pulsando, da igual que además estés encima. */
    estilo: (pressed: boolean) => [
      encima && !pressed ? estilos.encima : null,
      pressed ? estilos.pulsado : null,
      conFoco ? estilos.conFoco : null,
    ],
  };
}
