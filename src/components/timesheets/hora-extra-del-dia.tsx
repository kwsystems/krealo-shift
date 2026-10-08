import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import { duracion } from '@/features/timesheets/duracion';
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
  decidido = aprobados > 0,
  refrigerioSinMarcar = 0,
  refrigerioPendiente = 0,
  decidiendoRefrigerio = false,
  onDecidirRefrigerio,
  saving,
  failed,
  onGuardar,
}: {
  /** Lo trabajado ese día por esa persona, en todas sus jornadas. */
  netosDelDia: number;
  /** Lo planificado en sus turnos publicados, o `undefined` si no tenía turno. */
  planificados: number | undefined;
  aprobados: number;
  /** Si ese día ya está decidido: aprobado, o «no es extra» (0). */
  decidido?: boolean;
  /**
   * El refrigerio de su turno que ese día no marcó (6-oct), o 0. Aprobar más de lo que
   * trabajó de más sin él cuenta esa hora como trabajada: se dice antes de guardar.
   */
  refrigerioSinMarcar?: number;
  /**
   * El refrigerio de ese día que SIGUE sin decidir (8-oct), o 0. Con la extra en 0 —«no es
   * extra»— el caso «sin refrigerio» de Por resolver sigue abierto, porque 0 no dice si comió.
   * La hoja lo pregunta aquí con las mismas dos respuestas que Por resolver.
   */
  refrigerioPendiente?: number;
  decidiendoRefrigerio?: boolean;
  onDecidirRefrigerio?: (tipo: 'descontar_refrigerio' | 'sin_refrigerio_ok') => void;
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
      ) : decidido ? (
        <AppText variant="bodyStrong" testID="overtime-not-extra">
          {t('timesheet.overtimeDecidedNone')}
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
      {/*
        CÓMO LO VA A GUARDAR (8-oct): «1» era un minuto y nadie lo veía. Ahora es una hora, y
        se dice aquí antes de pulsar, sea lo que sea lo que se escribió.
      */}
      {minutos !== null && minutos > 0 && valido ? (
        <AppText variant="label" tone="primary" tabular testID="overtime-read-as">
          {t('common.savedAs', { duration: duracion(t, minutos) })}
        </AppText>
      ) : null}
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
        {/*
          «NO ES EXTRA» (6-oct): la otra respuesta, que antes no existía. Con una extra aprobada
          es quitarla; sin decidir, es decir que no. Las dos quedan guardadas como 0.
        */}
        {aprobados > 0 || !decidido ? (
          <GhostButton
            label={t('timesheet.overtimeNotExtra')}
            onPress={() => onGuardar(0)}
            fullWidth={false}
            testID="overtime-remove"
          />
        ) : null}
      </Row>
      {refrigerioPendiente > 0 &&
      aprobados === 0 &&
      (decidido || deMas <= 0) &&
      onDecidirRefrigerio ? (
        <InlineNotice
          tone="warning"
          icon="help-circle-outline"
          title={t('timesheet.breakPending', { hours: duracion(t, refrigerioPendiente) })}
          body={t('timesheet.breakPendingDetail')}
          testID="overtime-break-pending"
          action={
            <Row gap={spacing.sm} wrap>
              <SecondaryButton
                label={t('timesheet.cases.applyBreak', {
                  hours: duracion(t, refrigerioPendiente),
                })}
                onPress={() => onDecidirRefrigerio('descontar_refrigerio')}
                loading={decidiendoRefrigerio}
                fullWidth={false}
                testID="overtime-break-apply"
              />
              <GhostButton
                label={t('timesheet.cases.workedThrough')}
                onPress={() => onDecidirRefrigerio('sin_refrigerio_ok')}
                disabled={decidiendoRefrigerio}
                fullWidth={false}
                testID="overtime-break-worked"
              />
            </Row>
          }
        />
      ) : null}
      {failed ? (
        <InlineNotice tone="late" icon="alert-circle" title={t('timesheet.overtimeFailed')} />
      ) : null}
    </Stack>
  );
}
