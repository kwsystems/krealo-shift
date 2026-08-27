import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useResponsive } from '@/hooks/use-responsive';
import { borderWidth, colors, radii, shadows, spacing } from '@/theme/tokens';

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

const backgrounds = {
  canvas: colors.canvas,
  kiosk: colors.primary50,
  surface: colors.surface,
} as const;

export function AppScreen({
  children,
  tone = 'canvas',
  scroll = false,
  padded = true,
  style,
  testID,
}: ScreenProps) {
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
    <SafeAreaView testID={testID} style={[styles.flex, { backgroundColor: backgrounds[tone] }]}>
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
  return (
    <View style={[styles.container, { maxWidth: maxWidths[width] }, style]}>{children}</View>
  );
}

type CardProps = {
  children: ReactNode;
  /** Solo las tarjetas flotantes y los modales llevan sombra (§5). */
  floating?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function Card({ children, floating = false, style, testID }: CardProps) {
  return (
    <View
      testID={testID}
      style={[styles.card, floating ? shadows.floating : shadows.card, style]}
    >
      {children}
    </View>
  );
}

export function Stack({
  children,
  gap = spacing.base,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: ViewStyle;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Row({
  children,
  gap = spacing.md,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
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

const styles = StyleSheet.create({
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
});
