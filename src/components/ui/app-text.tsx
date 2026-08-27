import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fontFamily, fontSize, lineHeight } from '@/theme/tokens';

/**
 * Único componente de texto de la app. Los componentes no fijan tamaños ni
 * colores a mano: eligen una variante y un tono de esta lista (§5).
 */
export type TextVariant =
  | 'kioskClock'
  | 'kioskTitle'
  | 'title'
  | 'section'
  | 'body'
  | 'bodyStrong'
  | 'help'
  | 'label';

export type TextTone = 'default' | 'muted' | 'subtle' | 'onPrimary' | 'success' | 'warning' | 'danger' | 'primary';

type Props = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Números tabulares para horas y totales, para que no bailen los dígitos (§5). */
  tabular?: boolean;
  /** Sobrescribe el tamaño cuando el kiosco interpola según ancho. */
  size?: number;
};

const toneColor: Record<TextTone, string> = {
  default: colors.ink900,
  muted: colors.ink700,
  subtle: colors.ink500,
  onPrimary: colors.white,
  success: colors.success600,
  warning: colors.warning600,
  danger: colors.danger600,
  primary: colors.primary600,
};

export function AppText({
  variant = 'body',
  tone = 'default',
  tabular = false,
  size,
  style,
  ...rest
}: Props) {
  const base = styles[variant] as TextStyle;
  return (
    <Text
      {...rest}
      style={[
        base,
        { color: toneColor[tone] },
        size !== undefined ? { fontSize: size, lineHeight: Math.round(size * lineHeight.tight) } : null,
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
