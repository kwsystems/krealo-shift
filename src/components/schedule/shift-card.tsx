import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Row } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { ShiftRow } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';
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
  const { colors } = useTheme();
  const styles = useEstilos();
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
      {/*
        DOS LÍNEAS PARA LA HORA, y es lo que deja caber más días de la semana.
        Con una sola línea el texto no puede partirse, así que el ancho mínimo del
        turno es el de «03:00 – 09:00» completo —146 px medidos—, y ese mínimo sube
        hasta la columna del día: 180 px, siete de ellas más los nombres son 1426 px
        de rejilla, que no caben ni en un monitor de 1440. Dejándola partir por el
        guion, el mínimo baja a media hora y la columna vuelve a su ancho de diseño.
        La alternativa era recortar la hora, que es lo que hacía antes y es peor:
        un turno sin hora de salida no dice a qué hora se sale.
      */}
      <AppText variant="bodyStrong" tabular numberOfLines={2}>
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
  const { colors } = useTheme();
  const styles = useEstilos();
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

const useEstilos = estilosDelTema((colors) => ({
  card: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    /*
     * EL RELLENO HORIZONTAL BAJA UN PASO, y son los dos píxeles que le faltaban a la
     * hora de salida. Con `padding: spacing.md` la tarjeta dejaba 102 px de texto en
     * una columna de 144, y «03:00 – 09:00» mide 104: veinticuatro turnos de la semana
     * se leían «03:00 – 09:…». Dos píxeles, en el único dato que hace que un turno sea
     * un turno —cuándo entra y cuándo sale—, y encima en el lado de la salida.
     *
     * Se toca el relleno y no la hora: el formato sale de `formatShiftRange`, que usan
     * también la ficha del empleado y el reloj de fichaje, donde sobra sitio y el guion
     * con espacios se lee mejor. Estrechar el aire de una tarjeta es más barato que
     * cambiar cómo se escribe una hora en toda la app.
     *
     * Vertical se queda en `md`: lo que faltaba era ancho.
     */
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
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
}));
