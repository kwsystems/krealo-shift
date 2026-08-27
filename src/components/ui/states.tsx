import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from './app-text';
import { SecondaryButton } from './buttons';
import { Card, Row } from './layout';
import {
  borderWidth,
  colors,
  radii,
  sizes,
  spacing,
  statusPalette,
  type StatusTone,
} from '@/theme/tokens';

/**
 * Estados obligatorios en todas las pantallas (§20) y señales de estado (§5).
 *
 * Regla que impone este archivo: el color nunca es la única forma de comunicar
 * un estado — cada insignia lleva icono y texto, y expone su estado a VoiceOver.
 */

type IconName = keyof typeof Ionicons.glyphMap;

/** Insignia de estado: icono + texto + color, en ese orden de importancia. */
export function StatusBadge({
  label,
  tone = 'info',
  icon,
  compact = false,
}: {
  label: string;
  tone?: StatusTone;
  icon?: IconName;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const palette = statusPalette[tone];
  const resolvedIcon: IconName = icon ?? defaultIcons[tone];

  return (
    <View
      accessibilityLabel={t('a11y.statusBadge', { status: label })}
      style={[
        styles.badge,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          paddingVertical: compact ? spacing.xs : spacing.sm,
          paddingHorizontal: compact ? spacing.sm : spacing.md,
        },
      ]}
    >
      <Ionicons name={resolvedIcon} size={14} color={palette.fg} />
      <AppText variant="label" style={{ color: palette.fg }}>
        {label}
      </AppText>
    </View>
  );
}

const defaultIcons: Record<StatusTone, IconName> = {
  offShift: 'moon-outline',
  working: 'checkmark-circle',
  onBreak: 'cafe-outline',
  late: 'alert-circle',
  info: 'information-circle-outline',
};

/** Estado vacío: icono, una frase y una acción. Nunca una caja hueca (§20). */
/**
 * Los estados compartidos aceptan `testID` porque son justo lo que un flujo E2E
 * necesita afirmar: que apareció el vacío y no un error, que el aviso de sin
 * conexión está visible, que el indicador de sincronización cambió. Sin esto los
 * flujos de `e2e/` no pueden comprobar el estado offline, que es el caso más
 * delicado de la app.
 *
 * `OfflineBanner` y `SyncIndicator` traen un valor por defecto porque siempre hay
 * uno solo en pantalla; los demás lo reciben de quien los usa.
 */
export function EmptyState({
  title,
  body,
  icon = 'file-tray-outline',
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  body?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.centeredState} testID={testID}>
      <Ionicons name={icon} size={40} color={colors.ink500} style={styles.dimIcon} />
      <AppText variant="section" style={styles.centerText}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="help" tone="subtle" style={styles.centerText}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <SecondaryButton label={actionLabel} onPress={onAction} fullWidth={false} />
      ) : null}
    </View>
  );
}

/** Error recuperable, siempre con reintento. Nunca se muestra un stack trace (§20). */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel,
  testID,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.centeredState} testID={testID}>
      <Ionicons name="warning-outline" size={40} color={colors.danger600} />
      <AppText variant="section" style={styles.centerText}>
        {title ?? t('states.errorTitle')}
      </AppText>
      <AppText variant="help" tone="subtle" style={styles.centerText}>
        {body ?? t('states.errorBody')}
      </AppText>
      {onRetry ? (
        <SecondaryButton
          label={retryLabel ?? t('common.retry')}
          onPress={onRetry}
          fullWidth={false}
        />
      ) : null}
    </View>
  );
}

/** Carga: skeleton o spinner con texto, nunca una pantalla en blanco (§20). */
export function LoadingState({ label, testID }: { label?: string; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centeredState} testID={testID}>
      <ActivityIndicator color={colors.primary600} />
      <AppText variant="help" tone="subtle">
        {label ?? t('common.loading')}
      </AppText>
    </View>
  );
}

/**
 * Aviso de sin conexión. No bloquea el uso: el kiosco debe seguir fichando (§9.7).
 */
export function OfflineBanner({
  pendingCount = 0,
  testID = 'offline-banner',
}: {
  pendingCount?: number;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.offlineBanner} accessibilityRole="alert" testID={testID}>
      <Ionicons name="cloud-offline-outline" size={18} color={colors.warning600} />
      <AppText variant="label" style={{ color: colors.warning600 }}>
        {t('states.offlineBanner', { count: pendingCount })}
      </AppText>
    </View>
  );
}

/** Indicador discreto de conexión y sincronización (§9.1). */
export function SyncIndicator({
  online,
  syncing = false,
  pendingCount = 0,
  testID = 'sync-indicator',
}: {
  online: boolean;
  syncing?: boolean;
  pendingCount?: number;
  testID?: string;
}) {
  const { t } = useTranslation();
  const tone = !online ? colors.warning600 : pendingCount > 0 ? colors.info600 : colors.success600;

  return (
    <Row
      gap={spacing.xs}
      testID={testID}
      accessibilityLabel={`${t('a11y.syncIndicator')}: ${
        online ? t('a11y.connectionOnline') : t('a11y.connectionOffline')
      }`}
    >
      {syncing ? (
        <ActivityIndicator size="small" color={tone} />
      ) : (
        <Ionicons
          name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
          size={16}
          color={tone}
        />
      )}
      {pendingCount > 0 ? (
        <AppText variant="label" style={{ color: tone }} tabular>
          {String(pendingCount)}
        </AppText>
      ) : null}
    </Row>
  );
}

/** Explica por qué se pide un permiso antes de pedirlo (§25 PermissionExplainer). */
export function PermissionExplainer({
  title,
  body,
  actionLabel,
  onAction,
  icon = 'lock-closed-outline',
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  icon?: IconName;
}) {
  return (
    <Card>
      <Row gap={spacing.md} align="flex-start">
        <Ionicons name={icon} size={sizes.iconMobile} color={colors.primary600} />
        <View style={styles.flexOne}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="help" tone="subtle">
            {body}
          </AppText>
        </View>
      </Row>
      <SecondaryButton label={actionLabel} onPress={onAction} />
    </Card>
  );
}

export function Section({
  title,
  action,
  children,
  style,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ gap: spacing.md }, style]}>
      <Row justify="space-between">
        <AppText variant="section">{title}</AppText>
        {action}
      </Row>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: borderWidth.hairline,
    alignSelf: 'flex-start',
  },
  centeredState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  centerText: { textAlign: 'center' },
  dimIcon: { opacity: 0.4 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning50,
    borderColor: colors.warning600,
    borderWidth: borderWidth.hairline,
    borderRadius: radii.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  flexOne: { flex: 1, gap: spacing.xs },
});
