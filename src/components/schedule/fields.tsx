import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Card, Row } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import {
  borderWidth,
  colors,
  radii,
  shadows,
  sizes,
  spacing,
  statusPalette,
  type StatusTone,
} from '@/theme/tokens';

/**
 * Controles compartidos del panel administrativo.
 *
 * Viven en `components/schedule` porque el alcance de esta tarea no permite crear
 * `components/ui`, que es donde deberían estar: los usan también Equipo, Horas,
 * Solicitudes y Configuración. Cuando `components/ui` esté libre, este archivo se
 * mueve tal cual.
 *
 * Reglas que imponen estos controles (§21, §33):
 *   - objetivo táctil mínimo 44 y preferible 52;
 *   - el estado seleccionado se comunica con texto, borde e icono, nunca solo con
 *     color, y se expone a VoiceOver con `accessibilityState.selected`;
 *   - ningún valor visual sale de fuera de `theme/tokens`.
 */

type IconName = keyof typeof Ionicons.glyphMap;

export type Option<T extends string> = {
  value: T;
  label: string;
  /** Texto secundario: sirve para explicar una opción delicada sin abrir un modal. */
  hint?: string;
};

/** Fila etiqueta + valor. La base de los detalles y del historial. */
export function KeyValueRow({
  label,
  value,
  tone = 'default',
  testID,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'danger' | 'success';
  testID?: string;
}) {
  return (
    <Row justify="space-between" gap={spacing.md} align="flex-start" style={styles.keyValue}>
      <AppText variant="help" tone="subtle" style={styles.keyValueLabel}>
        {label}
      </AppText>
      <AppText
        variant="bodyStrong"
        tone={tone === 'default' ? 'default' : tone === 'muted' ? 'muted' : tone}
        tabular
        style={styles.keyValueValue}
        testID={testID}
      >
        {value}
      </AppText>
    </Row>
  );
}

/**
 * Tarjeta compacta de cifra del inicio administrativo (§11.1).
 * El número va con su etiqueta completa: un número suelto no dice nada.
 */
export function StatTile({
  label,
  value,
  tone = 'info',
  icon,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  icon?: IconName;
  onPress?: () => void;
  testID?: string;
}) {
  const palette = statusPalette[tone];
  const content = (
    <View style={[styles.tile, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Row gap={spacing.xs}>
        {icon !== undefined ? <Ionicons name={icon} size={16} color={palette.fg} /> : null}
        <AppText variant="label" style={{ color: palette.fg }}>
          {label}
        </AppText>
      </Row>
      <AppText variant="section" tabular style={{ color: palette.fg }}>
        {value}
      </AppText>
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

/** Selector de una opción. En pantallas anchas se ve completo; en iPhone, con scroll. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  emptyLabel,
  testID,
}: {
  label: string;
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  emptyLabel?: string;
  testID?: string;
}) {
  return (
    <View style={styles.field} testID={testID}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      {options.length === 0 && emptyLabel !== undefined ? (
        <AppText variant="help" tone="subtle">
          {emptyLabel}
        </AppText>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {options.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              hint={option.hint}
              selected={option.value === value}
              onPress={() => onChange(option.value)}
              testID={`${testID ?? 'select'}-${option.value}`}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** Selector múltiple: ubicaciones y puestos de un empleado (§11.2). */
export function MultiSelectField<T extends string>({
  label,
  values,
  options,
  onToggle,
  emptyLabel,
  testID,
}: {
  label: string;
  values: T[];
  options: Option<T>[];
  onToggle: (value: T) => void;
  emptyLabel?: string;
  testID?: string;
}) {
  return (
    <View style={styles.field} testID={testID}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      {options.length === 0 && emptyLabel !== undefined ? (
        <AppText variant="help" tone="subtle">
          {emptyLabel}
        </AppText>
      ) : (
        <Row wrap gap={spacing.sm} align="flex-start">
          {options.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={values.includes(option.value)}
              onPress={() => onToggle(option.value)}
              testID={`${testID ?? 'multi'}-${option.value}`}
            />
          ))}
        </Row>
      )}
    </View>
  );
}

export function Chip({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={hint === undefined ? label : `${label}. ${hint}`}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      {/* El check no es decorativo: sin él, la selección sería solo color (§21). */}
      {selected ? <Ionicons name="checkmark" size={14} color={colors.primary700} /> : null}
      <AppText variant="label" tone={selected ? 'primary' : 'muted'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Interruptor con etiqueta y explicación. */
export function ToggleField({
  label,
  hint,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Row justify="space-between" gap={spacing.md} align="center" style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint !== undefined ? (
          <AppText variant="help" tone="subtle">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ false: colors.border, true: colors.primary200 }}
        thumbColor={value ? colors.primary600 : colors.surface}
        testID={testID}
      />
    </Row>
  );
}

/** Control segmentado: vista semanal/diaria, pestañas de solicitudes, secciones. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  testID?: string;
}) {
  return (
    <View accessibilityLabel={label} style={styles.segmentWrapper} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            testID={`${testID ?? 'segment'}-${option.value}`}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <AppText variant="label" tone={selected ? 'primary' : 'muted'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Hoja modal para formularios largos (§25 ConfirmSheet es para confirmar; esto es
 * para editar). En iPad se centra con ancho de formulario en lugar de estirarse
 * de lado a lado (§33).
 */
export function AdminSheet({
  visible,
  title,
  onClose,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { isWide } = useResponsive();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, isWide ? styles.backdropCentered : null]}>
        <Pressable
          style={styles.backdropTouchable}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <View style={[styles.sheet, isWide ? styles.sheetWide : null]} testID={testID}>
          <Row justify="space-between" align="center">
            <AppText variant="section" style={styles.sheetTitle}>
              {title}
            </AppText>
            <GhostButton label={t('common.close')} onPress={onClose} fullWidth={false} />
          </Row>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetBody}
          >
            {children}
          </ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

/** Aviso en línea, para advertencias que no bloquean (§20). */
export function InlineNotice({
  tone = 'info',
  title,
  body,
  icon,
  action,
}: {
  tone?: StatusTone;
  title: string;
  body?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  const palette = statusPalette[tone];
  const resolvedIcon: IconName = icon ?? 'information-circle-outline';

  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]}
    >
      <Row gap={spacing.sm} align="flex-start">
        <Ionicons name={resolvedIcon} size={sizes.iconMobile} color={palette.fg} />
        <View style={styles.noticeText}>
          <AppText variant="bodyStrong" style={{ color: palette.fg }}>
            {title}
          </AppText>
          {body !== undefined ? (
            <AppText variant="help" style={{ color: palette.fg }}>
              {body}
            </AppText>
          ) : null}
          {action}
        </View>
      </Row>
    </View>
  );
}

/** Barra de comparación con un límite configurado (§11.3). */
export function LimitBar({
  label,
  value,
  limit,
  valueLabel,
  testID,
}: {
  label: string;
  value: number;
  limit: number;
  valueLabel: string;
  testID?: string;
}) {
  const ratio = limit <= 0 ? 0 : Math.min(1, value / limit);
  const over = limit > 0 && value > limit;

  return (
    <View
      style={styles.field}
      accessible
      accessibilityLabel={`${label}: ${valueLabel}`}
      testID={testID}
    >
      <Row justify="space-between">
        <AppText variant="help" tone="subtle">
          {label}
        </AppText>
        <AppText variant="label" tone={over ? 'danger' : 'muted'} tabular>
          {valueLabel}
        </AppText>
      </Row>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.round(ratio * 100)}%` },
            over ? styles.barFillOver : null,
          ]}
        />
      </View>
    </View>
  );
}

/** Tarjeta con título y contenido, para agrupar formularios. */
export function FormCard({
  title,
  description,
  children,
  style,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Card style={style}>
      <AppText variant="bodyStrong">{title}</AppText>
      {description !== undefined ? (
        <AppText variant="help" tone="subtle">
          {description}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  keyValue: { minHeight: spacing.xl },
  keyValueLabel: { flexShrink: 1 },
  keyValueValue: { flexShrink: 1, textAlign: 'right' },
  tile: {
    minWidth: 132,
    minHeight: sizes.touchTargetPreferred + spacing.lg,
    gap: spacing.xs,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    justifyContent: 'center',
  },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary500,
    borderWidth: borderWidth.focus,
    backgroundColor: colors.primary50,
  },
  chipPressed: { backgroundColor: colors.primary100 },
  toggleRow: { minHeight: sizes.touchTargetPreferred },
  toggleText: { flex: 1, gap: spacing.xs },
  segmentWrapper: {
    flexDirection: 'row',
    backgroundColor: colors.canvas,
    borderRadius: radii.button,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: sizes.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    borderWidth: borderWidth.hairline,
    borderColor: colors.primary200,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(25, 23, 42, 0.35)' },
  backdropCentered: { justifyContent: 'center', alignItems: 'center' },
  backdropTouchable: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    maxHeight: '85%',
    ...shadows.floating,
  },
  sheetWide: {
    borderRadius: radii.card,
    width: 560,
    maxWidth: '92%',
    marginBottom: 0,
  },
  sheetTitle: { flexShrink: 1 },
  sheetBody: { gap: spacing.base, paddingBottom: spacing.base },
  notice: {
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    padding: spacing.md,
  },
  noticeText: { flex: 1, gap: spacing.xs },
  barTrack: {
    height: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.canvas,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.primary500 },
  barFillOver: { backgroundColor: colors.danger600 },
});
