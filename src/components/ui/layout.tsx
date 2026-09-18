import type { ReactNode } from 'react';
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
    <ScrollView
      contentContainerStyle={[{ padding, gap: spacing.base }, style]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: 'row' },
}));
