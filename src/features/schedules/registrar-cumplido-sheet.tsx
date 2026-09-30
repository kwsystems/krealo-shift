import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useRegistrarCumplido,
  useSimulacionCumplido,
  type ResultadoCumplido,
} from './horario-cumplido';
import { formatDateKeyShort, formatDayColumn, type DateKey } from './week';
import { AdminSheet, Chip, InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * «Registrar como cumplido»: los días de la semana que se van a llenar, con cuántos turnos
 * y cuántas horas, ANTES de escribir nada.
 *
 * LO QUE SE VE ES EL SIMULACRO DEL SERVIDOR, no una cuenta de aquí: es el servidor el que
 * decide qué turnos se tocan —publicados, terminados, sin marcas, antes del reloj—, así
 * que es él quien dice cuántos. Una cuenta propia en el cliente podría prometer 29 turnos
 * y registrar 26.
 *
 * LOS DÍAS SE PUEDEN QUITAR, y hace falta desde el primer uso: la semana del 31 de agosto
 * empieza en agosto y Andree quiere registrar desde el 1 de septiembre.
 */
export function RegistrarCumplidoSheet({
  dias,
  locationId,
  language,
  onClose,
  onDone,
}: {
  dias: DateKey[];
  locationId: string | null;
  language: SupportedLanguage;
  onClose: () => void;
  onDone: (resultado: ResultadoCumplido) => void;
}) {
  const { t } = useTranslation();
  const simulacion = useSimulacionCumplido({ locationId, dias, enabled: true });
  const registrar = useRegistrarCumplido(locationId);
  /** Se guardan los QUITADOS, no los elegidos: así todo empieza marcado sin un efecto. */
  const [quitados, setQuitados] = useState<ReadonlySet<DateKey>>(new Set());

  const datos = simulacion.data;
  const conTurnos = dias.filter((dia) => (datos?.porDia[dia]?.turnos ?? 0) > 0);
  const elegidos = conTurnos.filter((dia) => !quitados.has(dia));
  const turnos = elegidos.reduce((suma, dia) => suma + (datos?.porDia[dia]?.turnos ?? 0), 0);
  const minutos = elegidos.reduce((suma, dia) => suma + (datos?.porDia[dia]?.minutos ?? 0), 0);

  const alternar = (dia: DateKey) =>
    setQuitados((antes) => {
      const despues = new Set(antes);
      if (despues.has(dia)) despues.delete(dia);
      else despues.add(dia);
      return despues;
    });

  const saltados = datos?.saltados;
  const notas = [
    saltados !== undefined && saltados.yaTieneMarcas > 0
      ? t('schedule.worked.skippedMarks', { count: saltados.yaTieneMarcas })
      : null,
    saltados !== undefined && saltados.sinPublicar > 0
      ? t('schedule.worked.skippedDraft', { count: saltados.sinPublicar })
      : null,
    saltados !== undefined &&
    saltados.conReloj > 0 &&
    datos?.relojDesde !== undefined &&
    datos.relojDesde !== null
      ? t('schedule.worked.skippedClock', {
          count: saltados.conReloj,
          day: formatDateKeyShort(datos.relojDesde, language),
        })
      : null,
    saltados !== undefined && saltados.noTermino > 0
      ? t('schedule.worked.skippedFuture', { count: saltados.noTermino })
      : null,
    saltados !== undefined && saltados.jornadaAbierta > 0
      ? t('schedule.worked.skippedOpen', { count: saltados.jornadaAbierta })
      : null,
  ].filter((nota): nota is string => nota !== null);

  return (
    <AdminSheet
      visible
      title={t('schedule.worked.title')}
      onClose={onClose}
      testID="worked-sheet"
      footer={
        <PrimaryButton
          label={t('schedule.worked.confirm', { count: turnos })}
          onPress={() =>
            registrar.mutate(elegidos, {
              onSuccess: (resultado) => onDone(resultado),
            })
          }
          disabled={turnos === 0}
          loading={registrar.isPending}
          testID="worked-confirm"
        />
      }
    >
      <Stack gap={spacing.base}>
        <AppText variant="body" tone="muted">
          {t('schedule.worked.intro')}
        </AppText>

        {simulacion.isPending ? (
          <AppText variant="help" tone="subtle" testID="worked-loading">
            {t('schedule.worked.loading')}
          </AppText>
        ) : simulacion.isError ? (
          <InlineNotice tone="late" icon="alert-circle" title={t('schedule.worked.failed')} />
        ) : conTurnos.length === 0 ? (
          <InlineNotice
            tone="info"
            icon="information-circle-outline"
            title={t('schedule.worked.none')}
            testID="worked-none"
          />
        ) : (
          <Stack gap={spacing.sm}>
            <AppText variant="label" tone="muted">
              {t('schedule.worked.daysLabel')}
            </AppText>
            <Row wrap gap={spacing.sm} align="flex-start">
              {conTurnos.map((dia) => (
                <Chip
                  key={dia}
                  label={t('schedule.worked.dayChip', {
                    day: formatDayColumn(dia, language),
                    count: datos?.porDia[dia]?.turnos ?? 0,
                  })}
                  selected={!quitados.has(dia)}
                  onPress={() => alternar(dia)}
                  testID={`worked-day-${dia}`}
                />
              ))}
            </Row>
            <AppText variant="bodyStrong" tabular testID="worked-total">
              {t('schedule.worked.total', { count: turnos, hours: minutesToHHmm(minutos) })}
            </AppText>
          </Stack>
        )}

        {notas.length > 0 ? (
          <Stack gap={spacing.xs} testID="worked-skipped">
            {notas.map((nota) => (
              <AppText key={nota} variant="help" tone="muted">
                {nota}
              </AppText>
            ))}
          </Stack>
        ) : null}

        {registrar.isError ? (
          <InlineNotice
            tone="late"
            icon="alert-circle"
            title={t('schedule.worked.failed')}
            testID="worked-error"
          />
        ) : null}
      </Stack>
    </AdminSheet>
  );
}
