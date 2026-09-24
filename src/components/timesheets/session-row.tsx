import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AnclaDePersona } from '@/components/ui/ancla';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { WorkSession } from '@/features/timesheets/api';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/**
 * Fila de sesión de trabajo (§11.4).
 *
 * Muestra la sesión con sus alertas visibles: una hora sin salida marcada no se
 * puede confundir con una jornada normal, y el color nunca es la única señal (§21).
 */

const ALERT_ICONS: Record<TimesheetAlert, 'alert-circle' | 'time-outline' | 'warning-outline'> = {
  missingClockOut: 'alert-circle',
  overlap: 'warning-outline',
  abnormalDuration: 'warning-outline',
  lateArrival: 'time-outline',
  earlyDeparture: 'time-outline',
  clockDrift: 'warning-outline',
  unscheduled: 'alert-circle',
  needsReview: 'alert-circle',
};

export function alertLabelKey(alert: TimesheetAlert): string {
  switch (alert) {
    case 'missingClockOut':
      return 'timesheet.flagMissingClockOut';
    case 'overlap':
      return 'timesheet.flagOverlap';
    case 'abnormalDuration':
      return 'timesheet.flagAbnormalDuration';
    case 'lateArrival':
      return 'timesheet.flagLateArrival';
    case 'earlyDeparture':
      return 'timesheet.flagEarlyDeparture';
    case 'clockDrift':
      return 'timesheet.flagClockDrift';
    case 'unscheduled':
      return 'timesheet.flagUnscheduled';
    default:
      return 'states.needsReviewBadge';
  }
}

export function SessionRow({
  session,
  employeeName,
  alerts,
  timezone,
  timeFormat,
  language,
  onPress,
  testID,
}: {
  session: WorkSession;
  employeeName: string;
  alerts: TimesheetAlert[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  onPress: (session: WorkSession) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const styles = useEstilos();

  const start = formatClockTime(session.starts_at, timezone, timeFormat, language);
  const end =
    session.ends_at === null
      ? t('timesheet.stillOpen')
      : formatClockTime(session.ends_at, timezone, timeFormat, language);
  const net = minutesToHHmm(session.net_minutes ?? 0);

  return (
    <Pressable
      onPress={() => onPress(session)}
      accessibilityRole="button"
      accessibilityLabel={`${employeeName}. ${start} – ${end}. ${net}`}
      accessibilityHint={t('timesheet.openDetailHint')}
      testID={testID}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <View style={styles.fila}>
        <Row justify="space-between" gap={spacing.md} align="flex-start">
          {/*
            EL MISMO ANCLA QUE EN EQUIPO, y del mismo color para la misma persona.

            Una hoja de horas es una lista larga del MISMO puñado de gente repetida: sin
            ancla hay que leer el nombre en cada fila para seguir a alguien por la semana,
            que es justo lo que se viene a hacer aquí. Con el ancla, seguir a una persona
            es seguir un color por la columna.

            La semilla es el identificador del empleado, así que su tono es el mismo aquí
            y en Equipo. Un color que cambia de pantalla sería peor que no tenerlo.
          */}
          <AnclaDePersona semilla={session.employee_id} nombre={employeeName} tamano="sm" />
          <Stack gap={spacing.xs} style={styles.creceYEncoge}>
            <AppText variant="bodyStrong">{employeeName}</AppText>
            <AppText variant="help" tone="muted" tabular>
              {`${start} – ${end}`}
            </AppText>
          </Stack>
          <Stack gap={spacing.xs}>
            <AppText variant="bodyStrong" tabular>
              {net}
            </AppText>
            {session.unpaid_break_minutes > 0 ? (
              <AppText variant="label" tone="subtle" tabular>
                {`${t('timesheet.breaks')}: ${minutesToHHmm(session.unpaid_break_minutes)}`}
              </AppText>
            ) : null}
          </Stack>
        </Row>

        {alerts.length > 0 ? (
          <Row gap={spacing.xs} wrap align="flex-start">
            {alerts.map((alert) => (
              <StatusBadge
                key={alert}
                label={t(alertLabelKey(alert))}
                tone={alert === 'lateArrival' || alert === 'earlyDeparture' ? 'onBreak' : 'late'}
                icon={ALERT_ICONS[alert]}
                compact
              />
            ))}
          </Row>
        ) : null}
      </View>
    </Pressable>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  pressed: { opacity: 0.7 },
  /*
   * LA FILA ES UNA FILA DE TABLA, no una tarjeta. Comparte superficie con sus vecinas y
   * las separa una regla fina (`SeparadorDeRegistro`, en la lista). Antes cada una traía
   * su propia `Card`: quince sesiones eran quince planos flotando, cada uno pagando
   * relleno, sombra y hueco justo en la pantalla donde más falta hace el alto.
   */
  creceYEncoge: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
}));
