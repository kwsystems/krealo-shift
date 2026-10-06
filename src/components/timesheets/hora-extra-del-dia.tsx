import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import { leerHorasYMinutos, minutosDeMas } from '@/features/timesheets/horas-extra';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * «¿Cuenta como hora extra?» para el día de una persona, dentro del detalle de su jornada.
 *
 * La decisión es de quien gestiona (30-sep): aquí se le da lo que necesita para tomarla
 * —cuánto trabajó y cuánto tenía planificado— y el campo viene lleno con lo que trabajó
 * de más, que es lo habitual. Puede aprobar menos (una hora de las dos que se quedó),
 * cambiarlo después o quitarlo. Lo que no apruebe sigue contando como horas trabajadas:
 * solo deja de llamarse «extra».
 */
export function HoraExtraDelDia({
  netosDelDia,
  planificados,
  aprobados,
  refrigerioSinMarcar = 0,
  saving,
  failed,
  onGuardar,
}: {
  /** Lo trabajado ese día por esa persona, en todas sus jornadas. */
  netosDelDia: number;
  /** Lo planificado en sus turnos publicados, o `undefined` si no tenía turno. */
  planificados: number | undefined;
  aprobados: number;
  /**
   * El refrigerio de su turno que ese día no marcó (6-oct), o 0. Aprobar más de lo que
   * trabajó de más sin él cuenta esa hora como trabajada: se dice antes de guardar.
   */
  refrigerioSinMarcar?: number;
  saving: boolean;
  failed: boolean;
  onGuardar: (minutos: number) => void;
}) {
  const { t } = useTranslation();
  const deMas = minutosDeMas(netosDelDia, planificados);
  const [texto, setTexto] = useState(minutesToHHmm(aprobados > 0 ? aprobados : deMas));
  const [intentado, setIntentado] = useState(false);

  const minutos = leerHorasYMinutos(texto);
  const valido = minutos !== null && minutos <= netosDelDia;

  const guardar = () => {
    setIntentado(true);
    if (minutos === null || !valido) return;
    onGuardar(minutos);
  };

  return (
    <Stack gap={spacing.sm} testID="overtime-section">
      <AppText variant="bodyStrong">{t('timesheet.overtimeSection')}</AppText>
      <AppText variant="body" tone="muted" testID="overtime-context">
        {planificados === undefined
          ? t('timesheet.overtimeNoShift', { hours: minutesToHHmm(netosDelDia) })
          : deMas > 0
            ? t('timesheet.overtimeWorkedMore', {
                hours: minutesToHHmm(deMas),
                planned: minutesToHHmm(planificados),
              })
            : t('timesheet.overtimeNotMore')}
      </AppText>
      {refrigerioSinMarcar > 0 && deMas > 0 ? (
        <InlineNotice
          tone="info"
          body={t('timesheet.overtimeNoBreak', {
            breakHours: minutesToHHmm(refrigerioSinMarcar),
            withoutBreak: minutesToHHmm(Math.max(0, deMas - refrigerioSinMarcar)),
          })}
          testID="overtime-no-break"
        />
      ) : null}
      {aprobados > 0 ? (
        <AppText variant="bodyStrong" tabular testID="overtime-approved">
          {t('timesheet.overtimeApprovedNow', { hours: minutesToHHmm(aprobados) })}
        </AppText>
      ) : null}
      <FormField
        label={t('timesheet.overtimeField')}
        value={texto}
        onChangeText={setTexto}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={
          intentado && !valido
            ? t('timesheet.overtimeInvalid', { hours: minutesToHHmm(netosDelDia) })
            : undefined
        }
        testID="overtime-input"
      />
      <AppText variant="help" tone="subtle">
        {t('timesheet.overtimeFieldHint')}
      </AppText>
      <Row gap={spacing.sm} wrap align="center">
        <SecondaryButton
          label={aprobados > 0 ? t('timesheet.overtimeUpdate') : t('timesheet.overtimeApprove')}
          onPress={guardar}
          loading={saving}
          fullWidth={false}
          testID="overtime-save"
        />
        {aprobados > 0 ? (
          <GhostButton
            label={t('timesheet.overtimeRemove')}
            onPress={() => onGuardar(0)}
            fullWidth={false}
            testID="overtime-remove"
          />
        ) : null}
      </Row>
      {failed ? (
        <InlineNotice tone="late" icon="alert-circle" title={t('timesheet.overtimeFailed')} />
      ) : null}
    </Stack>
  );
}
