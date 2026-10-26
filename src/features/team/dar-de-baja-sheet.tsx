import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { BajaRechazada, dischargeEmployee } from './api';
import type { TeamMember } from './hooks';
import { CalendarioDeDias } from '@/components/schedule/calendario-de-dias';
import { AdminSheet, InlineNotice } from '@/components/schedule/fields';
import { MonthNavigator } from '@/components/schedule/week-tools';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, GhostButton } from '@/components/ui/buttons';
import { adminErrorKind } from '@/hooks/use-admin-query';
import { Stack } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { formatDateKeyShort, formatWeekdayShort, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';

/**
 * «DEJÓ DE TRABAJAR», CON SU ÚLTIMO DÍA (4-oct).
 *
 * Andree: «su último día fue el miércoles 30 de setiembre, ya no está en octubre. Que haya
 * un botón para decir que ya no trabaja. No quiero que se borren sus datos». El botón de
 * antes —«Desactivar»— no preguntaba desde cuándo: los turnos que ya tenía puestos después
 * de irse seguían saliendo como faltas.
 *
 * Se elige el día en un calendario que empieza en el último día que MARCÓ, que casi siempre
 * es la respuesta; antes de confirmar se dice cuántos turnos de después se quitan del
 * horario. Lo que hizo hasta ese día no se toca. Ver `functions/src/baja-de-empleado.ts`.
 */
export function DarDeBajaSheet({
  member,
  weekStartsOn,
  language,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  member: TeamMember;
  weekStartsOn: number;
  language: SupportedLanguage;
  pending: boolean;
  /** El fallo de confirmar, tal como llegó: la hoja dice el motivo. `null` si no hubo. */
  error: unknown;
  onConfirm: (lastDay: DateKey) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inicial = useQuery({
    queryKey: ['team', 'baja', member.id],
    queryFn: () => dischargeEmployee({ employeeId: member.id, dryRun: true }),
  });
  const [dia, setDia] = useState<DateKey | null>(null);
  const [mes, setMes] = useState<DateKey | null>(null);

  const hoy = inicial.data?.hoy ?? null;
  const elegido = dia ?? inicial.data?.ultimoDiaMarcado ?? hoy;
  const conteo = useQuery({
    queryKey: ['team', 'baja', member.id, elegido],
    queryFn: () =>
      dischargeEmployee({ employeeId: member.id, lastDay: elegido ?? '', dryRun: true }),
    enabled: elegido !== null,
  });

  const diaLegible = (clave: DateKey) =>
    `${formatWeekdayShort(clave, language)} ${formatDateKeyShort(clave, language)}`;
  /*
   * EL MOTIVO, Y YA AL ELEGIR EL DÍA (26-oct): el recuento de `dryRun` comprueba lo mismo que
   * la baja, así que un día anterior a su última marca se dice antes de pulsar «Confirmar».
   */
  const fallo = error ?? conteo.error ?? null;
  const textoDelFallo = (causa: unknown): string => {
    if (causa instanceof BajaRechazada) {
      if (causa.motivo === 'futuro') return t('team.dischargeFuture');
      return causa.ultimoDiaMarcado === null
        ? causa.message
        : t('team.dischargeBeforeLastMark', { day: diaLegible(causa.ultimoDiaMarcado) });
    }
    return adminErrorKind(causa) === 'forbidden'
      ? t('states.noAccessBody')
      : t('team.dischargeFailed');
  };
  const primero = `${(mes ?? elegido ?? hoy ?? '').slice(0, 7)}-01`;

  return (
    <AdminSheet
      visible
      title={t('team.dischargeTitle', { name: member.displayName })}
      onClose={onClose}
      testID="dar-de-baja-sheet"
      footer={
        <Stack gap={spacing.sm}>
          {/* El fallo junto al botón (8-oct): debajo del calendario no se veía. */}
          {fallo !== null ? (
            <AppText
              variant="help"
              tone="danger"
              accessibilityRole="alert"
              testID="dar-de-baja-error"
            >
              {textoDelFallo(fallo)}
            </AppText>
          ) : null}
          <DangerButton
            label={
              elegido === null
                ? t('team.discharge')
                : t('team.dischargeConfirm', { day: diaLegible(elegido) })
            }
            onPress={() => {
              if (elegido !== null) onConfirm(elegido);
            }}
            loading={pending}
            disabled={elegido === null || conteo.isPending || conteo.isError}
            testID="dar-de-baja-confirmar"
          />
          <GhostButton label={t('common.cancel')} onPress={onClose} testID="dar-de-baja-cancelar" />
        </Stack>
      }
    >
      <AppText variant="body">{t('team.dischargeBody')}</AppText>

      {inicial.data === undefined || hoy === null ? (
        inicial.error === null ? (
          <LoadingState />
        ) : (
          <AppText variant="help" tone="danger" accessibilityRole="alert">
            {textoDelFallo(inicial.error)}
          </AppText>
        )
      ) : (
        <Stack gap={spacing.sm}>
          <AppText variant="bodyStrong">{t('team.dischargeLastDay')}</AppText>
          <AppText variant="help" tone="subtle" testID="dar-de-baja-ultima-marca">
            {inicial.data.ultimoDiaMarcado === null
              ? t('team.dischargeNoMarks')
              : t('team.dischargeLastMark', { day: diaLegible(inicial.data.ultimoDiaMarcado) })}
          </AppText>
          <MonthNavigator
            monthStart={primero}
            language={language}
            isCurrentMonth={primero === `${hoy.slice(0, 7)}-01`}
            onPrevious={() => setMes(desplazarMes(primero, -1))}
            onNext={() => setMes(desplazarMes(primero, 1))}
            onGoToCurrent={() => setMes(`${hoy.slice(0, 7)}-01`)}
            testIDPrefix="dar-de-baja-mes"
          />
          <CalendarioDeDias
            mes={primero}
            elegidos={new Set(elegido === null ? [] : [elegido])}
            hoy={hoy}
            weekStartsOn={weekStartsOn}
            language={language}
            onDia={setDia}
            testID="dar-de-baja-calendario"
          />
        </Stack>
      )}

      {elegido !== null && conteo.data !== undefined ? (
        <InlineNotice
          tone={conteo.data.turnos > 0 ? 'warning' : 'info'}
          icon="calendar-outline"
          title={t('team.dischargeSummary', { day: diaLegible(elegido) })}
          body={
            conteo.data.turnos > 0
              ? t('team.dischargeShifts', { count: conteo.data.turnos })
              : t('team.dischargeNoShifts')
          }
          testID="dar-de-baja-resumen"
        />
      ) : null}

      {/* Último día hoy: sigue activa hasta mañana (26-oct). Ver `baja-de-empleado.ts`. */}
      {elegido !== null && conteo.data?.sigueHoy === true ? (
        <InlineNotice
          tone="info"
          icon="time-outline"
          body={t('team.dischargeToday')}
          testID="dar-de-baja-hoy"
        />
      ) : null}
    </AdminSheet>
  );
}

function desplazarMes(primero: DateKey, meses: number): DateKey {
  const indice = Number(primero.slice(0, 4)) * 12 + Number(primero.slice(5, 7)) - 1 + meses;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}-01`;
}
