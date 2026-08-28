import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { useResponsive } from '@/hooks/use-responsive';
import { borderWidth, colors, sizes, spacing } from '@/theme/tokens';

/**
 * Teclado y puntos de PIN del kiosco (§9.1).
 *
 * Decisiones que impone este componente:
 * - los dígitos NO se anuncian en voz alta al escribirlos: el iPad es compartido
 *   y VoiceOver leería el PIN de la persona en voz alta (§21). Se anuncia solo el
 *   progreso: "3 de 6 dígitos ingresados";
 * - al completar el PIN se valida automáticamente, sin botón "Aceptar" (§9.1);
 * - las teclas del kiosco son de 88 px para operarse a un brazo de distancia (§33).
 */

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
] as const;

export function PinDots({
  length,
  entered,
  error = false,
}: {
  length: number;
  entered: number;
  error?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View
      style={styles.dotsRow}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('a11y.pinProgress', { entered, total: length })}
      accessibilityHint={t('a11y.pinHiddenNotice')}
    >
      {Array.from({ length }, (_, index) => {
        const filled = index < entered;
        return (
          <View
            key={index}
            style={[styles.dot, filled ? styles.dotFilled : null, error ? styles.dotError : null]}
          />
        );
      })}
    </View>
  );
}

export function NumericKeypad({
  onDigit,
  onBackspace,
  onClear,
  size = 'kiosk',
  disabled = false,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  size?: 'kiosk' | 'mobile';
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { isCompact } = useResponsive();

  const keySize = size === 'kiosk' ? sizes.keypadKeyKiosk : sizes.keypadKeyMobile;
  const gap = isCompact ? spacing.md : spacing.base;

  const press = useCallback(
    (action: () => void) => () => {
      if (disabled) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      action();
    },
    [disabled],
  );

  return (
    <View style={[styles.keypad, { gap }]}>
      {KEYPAD_ROWS.map((row) => (
        <View key={row.join('')} style={[styles.keypadRow, { gap }]}>
          {row.map((digit) => (
            <KeypadKey
              key={digit}
              label={digit}
              accessibilityLabel={t('a11y.keypadDigit', { digit })}
              onPress={press(() => onDigit(digit))}
              keySize={keySize}
              disabled={disabled}
              testID={`keypad-${digit}`}
            />
          ))}
        </View>
      ))}
      <View style={[styles.keypadRow, { gap }]}>
        <KeypadKey
          label={t('kiosk.keypadDelete')}
          accessibilityLabel={t('a11y.keypadDelete')}
          onPress={press(onClear)}
          keySize={keySize}
          variant="muted"
          disabled={disabled}
          testID="keypad-clear"
        />
        <KeypadKey
          label="0"
          accessibilityLabel={t('a11y.keypadDigit', { digit: '0' })}
          onPress={press(() => onDigit('0'))}
          keySize={keySize}
          disabled={disabled}
          testID="keypad-0"
        />
        <KeypadKey
          icon="backspace-outline"
          accessibilityLabel={t('a11y.keypadBackspace')}
          onPress={press(onBackspace)}
          keySize={keySize}
          variant="muted"
          disabled={disabled}
          testID="keypad-backspace"
        />
      </View>
    </View>
  );
}

function KeypadKey({
  label,
  icon,
  accessibilityLabel,
  onPress,
  keySize,
  variant = 'default',
  disabled = false,
  testID,
}: {
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
  keySize: number;
  variant?: 'default' | 'muted';
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.key,
        { width: keySize, height: keySize, borderRadius: keySize / 2 },
        variant === 'muted' ? styles.keyMuted : null,
        pressed && !disabled ? styles.keyPressed : null,
        disabled ? styles.keyDisabled : null,
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={26} color={colors.ink700} />
      ) : (
        <AppText
          variant={variant === 'muted' ? 'help' : 'kioskTitle'}
          tone={variant === 'muted' ? 'muted' : 'default'}
          size={variant === 'muted' ? undefined : Math.round(keySize * 0.38)}
          tabular
          numberOfLines={1}
        >
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.base,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: sizes.pinDot,
    height: sizes.pinDot,
    borderRadius: sizes.pinDot / 2,
    borderWidth: borderWidth.focus,
    borderColor: colors.primary200,
    backgroundColor: colors.surface,
  },
  dotFilled: {
    backgroundColor: colors.primary500,
    borderColor: colors.primary500,
  },
  dotError: {
    borderColor: colors.danger600,
  },
  keypad: { alignItems: 'center' },
  keypadRow: { flexDirection: 'row' },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
  },
  keyMuted: { backgroundColor: colors.canvas },
  keyPressed: { backgroundColor: colors.primary100, borderColor: colors.primary200 },
  keyDisabled: { opacity: 0.4 },
});
