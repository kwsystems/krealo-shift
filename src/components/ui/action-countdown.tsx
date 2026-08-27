import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from './app-text';
import { SecondaryButton } from './buttons';
import { borderWidth, colors, durations, radii, spacing } from '@/theme/tokens';

/**
 * Cuenta regresiva antes de una acción irreversible (§5, §9.4).
 *
 * Existe por una razón concreta: evitar que alguien marque salida cuando quería
 * iniciar descanso. Mientras corre, "Cancelar" siempre está visible.
 *
 * El aro de progreso se anima solo si el sistema no pide reducir movimiento; el
 * número y el texto funcionan igual en ambos casos, así que el usuario nunca
 * depende de la animación para entender qué pasa (§21).
 */
export function ActionCountdown({
  seconds = Math.round(durations.actionCountdownMs / 1000),
  onComplete,
  onCancel,
  label,
  testID,
}: {
  seconds?: number;
  onComplete: () => void;
  onCancel: () => void;
  label?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(seconds);
  const [reduceMotion, setReduceMotion] = useState(false);
  const completed = useRef(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (remaining <= 0) {
      // Guardamos contra un doble disparo si el componente se re-renderiza.
      if (!completed.current) {
        completed.current = true;
        onComplete();
      }
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onComplete]);

  return (
    <View style={styles.container} testID={testID}>
      <View
        style={[styles.ring, reduceMotion ? null : styles.ringActive]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('a11y.countdownRunning', { seconds: remaining })}
      >
        <AppText variant="title" tone="primary" tabular>
          {String(Math.max(remaining, 0))}
        </AppText>
      </View>

      <AppText variant="body" tone="muted" style={styles.centered}>
        {label ?? t('kiosk.confirmCountdown', { seconds: remaining })}
      </AppText>

      <SecondaryButton
        label={t('common.cancel')}
        onPress={onCancel}
        testID="countdown-cancel"
        accessibilityHint={t('a11y.countdownRunning', { seconds: remaining })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.base, alignSelf: 'stretch' },
  ring: {
    width: 96,
    height: 96,
    borderRadius: radii.pill,
    borderWidth: 4,
    borderColor: colors.primary200,
    backgroundColor: colors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringActive: { borderColor: colors.primary500, borderWidth: borderWidth.focus * 2 },
  centered: { textAlign: 'center' },
});
