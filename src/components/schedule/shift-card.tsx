import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Row } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { ShiftRow } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import { borderWidth, colors, radii, sizes, spacing } from '@/theme/tokens';
import { formatShiftRange, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';
import { minutesBetween } from '@/utils/time';

/**
 * Turno en la cuadrícula y en las listas (§11.3, §25 ShiftCard).
 *
 * Se toca para editar: no hay arrastrar y soltar, porque una interacción de toque
 * + formulario confiable es preferible a un drag-and-drop defectuoso (§11.3).
 *
 * Qué comunica cada turno, en este orden: horas, persona (si aplica), estado de
 * publicación y advertencias. El estado nunca es solo un color: lleva icono y
 * texto (§21).
 */
export function ShiftCard({
  shift,
  employeeName,
  jobRoleName,
  timezone,
  timeFormat,
  warnings = [],
  showEmployeeName = false,
  onPress,
  testID,
}: {
  shift: ShiftRow;
  employeeName?: string;
  jobRoleName?: string | null;
  timezone: string;
  timeFormat: TimeFormatPreference;
  warnings?: ScheduleWarning[];
  showEmployeeName?: boolean;
  onPress?: (shift: ShiftRow) => void;
  testID?: string;
}) {
  const { t } = useTranslation();

  const range = formatShiftRange(shift.starts_at, shift.ends_at, timezone, timeFormat);
  const netMinutes = Math.max(
    0,
    minutesBetween(shift.starts_at, shift.ends_at) - shift.planned_unpaid_break_minutes,
  );

  const isChanged = shift.status === 'draft' && shift.publication_version > 0;
  const statusLabel =
    shift.status === 'cancelled'
      ? t('schedule.statusCancelled')
      : shift.status === 'published'
        ? t('schedule.statusPublished')
        : isChanged
          ? t('schedule.changedBadge')
          : t('schedule.statusDraft');

  const accessibilityLabel = [
    showEmployeeName && employeeName !== undefined ? employeeName : null,
    range,
    minutesToHHmm(netMinutes),
    statusLabel,
    ...warnings.map((warning) =>
      warning.kind === 'overlap' ? t('schedule.overlapShort') : t('schedule.shortRestShort'),
    ),
  ]
    .filter((part): part is string => part !== null)
    .join('. ');

  const body = (
    <View
      style={[
        styles.card,
        shift.status === 'cancelled' ? styles.cancelled : null,
        warnings.length > 0 ? styles.warned : null,
      ]}
    >
      <AppText variant="bodyStrong" tabular numberOfLines={1}>
        {range}
      </AppText>
      {showEmployeeName && employeeName !== undefined ? (
        <AppText variant="help" tone="muted" numberOfLines={1}>
          {employeeName}
        </AppText>
      ) : null}
      {jobRoleName !== undefined && jobRoleName !== null ? (
        <AppText variant="label" tone="subtle" numberOfLines={1}>
          {jobRoleName}
        </AppText>
      ) : null}

      <Row gap={spacing.xs} wrap>
        <AppText variant="label" tone="subtle" tabular>
          {minutesToHHmm(netMinutes)}
        </AppText>
        {shift.planned_unpaid_break_minutes > 0 ? (
          <AppText variant="label" tone="subtle" tabular>
            {`· ${t('schedule.breakShort', { minutes: shift.planned_unpaid_break_minutes })}`}
          </AppText>
        ) : null}
      </Row>

      <StatusBadge
        label={statusLabel}
        compact
        tone={
          shift.status === 'published'
            ? 'working'
            : shift.status === 'cancelled'
              ? 'offShift'
              : 'info'
        }
        icon={
          shift.status === 'published'
            ? 'checkmark-circle'
            : shift.status === 'cancelled'
              ? 'close-circle-outline'
              : isChanged
                ? 'sync-outline'
                : 'create-outline'
        }
      />

      {warnings.length > 0 ? (
        <Row gap={spacing.xs}>
          <Ionicons name="alert-circle" size={14} color={colors.warning600} />
          <AppText variant="label" tone="warning" numberOfLines={2}>
            {warnings[0]?.kind === 'overlap'
              ? t('schedule.overlapShort')
              : t('schedule.shortRestShort')}
          </AppText>
        </Row>
      ) : null}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(shift)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={t('schedule.editShiftHint')}
      testID={testID}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

/** Celda vacía de la cuadrícula: siempre ofrece la acción siguiente (§20). */
export function EmptyShiftSlot({
  onPress,
  accessibilityLabel,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.slot, pressed ? styles.pressed : null]}
    >
      <Ionicons name="add" size={sizes.iconMobile} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: sizes.touchTargetPreferred,
  },
  cancelled: { opacity: 0.55, borderStyle: 'dashed' },
  warned: { borderColor: colors.warning600, borderWidth: borderWidth.focus },
  pressed: { opacity: 0.7 },
  slot: {
    minHeight: sizes.touchTargetPreferred,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
