import { Children, type ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useResponsive } from '@/hooks/use-responsive';
import { radii, shadows, spacing } from '@/theme/tokens';
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
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  row: { flexDirection: 'row' },
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
