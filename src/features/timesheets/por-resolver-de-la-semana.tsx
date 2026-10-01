import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  OtraSalidaSheet,
  PorResolver,
  ResolverFaltaSheet,
  type FilaPorResolver,
} from '@/components/timesheets/por-resolver';
import type { ShiftRow } from '@/features/schedules/api';
import { formatDayColumn, localDateTimeToInstant, localTimeOf } from '@/features/schedules/week';
import { adminErrorKind } from '@/hooks/use-admin-query';
import type { SupportedLanguage } from '@/i18n';
import { departureReasonLabelKey } from '@/i18n/break-reason-labels';
import { formatClockTime, type TimeFormatPreference } from '@/utils/time';

import type { WorkSession } from './api';
import { casosPorResolver, type CasoPorResolver } from './casos';
import { CasoRechazado, useArreglarCaso } from './horas-debidas';

/**
 * Los casos de la semana que mira Horas, escritos y con sus arreglos. La lógica de qué es
 * un caso está en `casos.ts`; lo que se hace con cada uno, en `horas-debidas.ts`. Aquí
 * solo se juntan, con las palabras de cada fila.
 */
export function PorResolverDeLaSemana({
  sesiones,
  turnos,
  nombres,
  personaFiltrada,
  locationId,
  nowISO,
  timezone,
  timeFormat,
  language,
  onVerJornada,
}: {
  sesiones: readonly WorkSession[];
  turnos: readonly ShiftRow[];
  nombres: ReadonlyMap<string, string>;
  personaFiltrada: string | null;
  locationId: string | null;
  nowISO: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  onVerJornada: (sesion: WorkSession) => void;
}) {
  const { t } = useTranslation();
  const arreglar = useArreglarCaso();
  const [falta, setFalta] = useState<{
    caso: Extract<CasoPorResolver, { tipo: 'faltan_horas' }>;
    decision: 'debe' | 'justificado';
  } | null>(null);
  const [salida, setSalida] = useState<Extract<CasoPorResolver, { tipo: 'sin_salida' }> | null>(
    null,
  );
  const [enCurso, setEnCurso] = useState<string | null>(null);

  const casos = casosPorResolver({ sesiones, turnos, ahoraISO: nowISO, timezone }).filter(
    (caso) => personaFiltrada === null || caso.sesion.employee_id === personaFiltrada,
  );
  const hora = (iso: string) => formatClockTime(iso, timezone, timeFormat, language);
  const nombre = (caso: CasoPorResolver) =>
    nombres.get(caso.sesion.employee_id) ?? t('team.unknownEmployee');

  const lanzar = (
    id: string,
    arreglo: Parameters<typeof arreglar.mutate>[0],
    alAcabar?: () => void,
  ) => {
    setEnCurso(id);
    arreglar.mutate(arreglo, {
      onSuccess: () => alAcabar?.(),
      onSettled: () => setEnCurso(null),
    });
  };

  const filas: FilaPorResolver[] = casos.map((caso) => {
    const base = {
      id: caso.id,
      nombre: nombre(caso),
      dia: formatDayColumn(caso.dia, language),
      onVerJornada: () => onVerJornada(caso.sesion),
      ocupada: enCurso === caso.id && arreglar.isPending,
    };
    if (caso.tipo === 'faltan_horas') {
      const que =
        caso.salioAntes >= caso.llegoTarde
          ? t('timesheet.cases.leftEarly', {
              out: hora(caso.sesion.ends_at ?? caso.sesion.starts_at),
              end: hora(caso.turno.ends_at),
            })
          : t('timesheet.cases.cameLate', {
              in: hora(caso.sesion.starts_at),
              start: hora(caso.turno.starts_at),
            });
      const motivo =
        caso.sesion.departure_reason === null
          ? null
          : t('timesheet.cases.reasonGiven', {
              reason: t(departureReasonLabelKey(caso.sesion.departure_reason)),
            });
      return {
        ...base,
        que,
        detalle: [t('timesheet.cases.missing', { hours: duracion(t, caso.faltan) }), motivo]
          .filter((parte): parte is string => parte !== null)
          .join(' · '),
        principal: {
          etiqueta: t('timesheet.cases.owesAmount', { hours: duracion(t, caso.faltan) }),
          onPress: () => setFalta({ caso, decision: 'debe' }),
          testID: `caso-${caso.id}-debe`,
        },
        alternativa: {
          etiqueta: t('timesheet.cases.justified'),
          onPress: () => setFalta({ caso, decision: 'justificado' }),
          testID: `caso-${caso.id}-justificado`,
        },
      };
    }
    if (caso.tipo === 'sin_refrigerio') {
      return {
        ...base,
        que: t('timesheet.cases.noBreak', {
          in: hora(caso.sesion.starts_at),
          out: hora(caso.sesion.ends_at ?? caso.sesion.starts_at),
        }),
        detalle: t('timesheet.cases.noBreakDetail', { hours: duracion(t, caso.refrigerio) }),
        principal: {
          etiqueta: t('timesheet.cases.applyBreak', { hours: duracion(t, caso.refrigerio) }),
          onPress: () =>
            lanzar(caso.id, { tipo: 'descontar_refrigerio', sessionId: caso.sesion.id }),
          testID: `caso-${caso.id}-refrigerio`,
        },
        alternativa: {
          etiqueta: t('timesheet.cases.workedThrough'),
          onPress: () => lanzar(caso.id, { tipo: 'sin_refrigerio_ok', sessionId: caso.sesion.id }),
          testID: `caso-${caso.id}-sin-refrigerio`,
        },
      };
    }
    const propuesta = caso.salidaPropuesta;
    return {
      ...base,
      que:
        caso.turno === null
          ? t('timesheet.cases.stillInNoShift', { in: hora(caso.sesion.starts_at) })
          : t('timesheet.cases.stillIn', { end: hora(caso.turno.ends_at) }),
      detalle: t('timesheet.cases.stillInDetail', { in: hora(caso.sesion.starts_at) }),
      principal:
        propuesta === null || locationId === null
          ? {
              etiqueta: t('timesheet.cases.otherTime'),
              onPress: () => setSalida(caso),
              testID: `caso-${caso.id}-salida`,
            }
          : {
              etiqueta: t('timesheet.cases.clockOutAt', { time: hora(propuesta) }),
              onPress: () =>
                lanzar(caso.id, {
                  tipo: 'marcar_salida',
                  employeeId: caso.sesion.employee_id,
                  locationId,
                  instante: propuesta,
                  motivo: t('timesheet.cases.clockOutReason'),
                }),
              testID: `caso-${caso.id}-salida`,
            },
      alternativa:
        propuesta === null
          ? null
          : {
              etiqueta: t('timesheet.cases.otherTime'),
              onPress: () => setSalida(caso),
              testID: `caso-${caso.id}-otra-hora`,
            },
    };
  });

  const error =
    arreglar.error === null || falta !== null || salida !== null
      ? null
      : mensajeDelError(t, arreglar.error);

  return (
    <>
      <PorResolver filas={filas} error={error} />
      {falta !== null ? (
        <ResolverFaltaSheet
          key={falta.caso.id}
          nombre={nombre(falta.caso)}
          faltan={falta.caso.faltan}
          faltanLegible={duracion(t, falta.caso.faltan)}
          decisionInicial={falta.decision}
          guardando={arreglar.isPending}
          error={arreglar.error === null ? null : mensajeDelError(t, arreglar.error)}
          onGuardar={({ decision, minutos, nota }) =>
            lanzar(
              falta.caso.id,
              decision === 'debe'
                ? { tipo: 'debe', sessionId: falta.caso.sesion.id, minutos, nota: nota || null }
                : { tipo: 'justificado', sessionId: falta.caso.sesion.id, nota: nota || null },
              () => setFalta(null),
            )
          }
          onClose={() => {
            arreglar.reset();
            setFalta(null);
          }}
        />
      ) : null}
      {salida !== null && locationId !== null ? (
        <OtraSalidaSheet
          key={salida.id}
          nombre={nombre(salida)}
          dia={formatDayColumn(salida.dia, language)}
          horaInicial={
            salida.salidaPropuesta === null ? '' : localTimeOf(salida.salidaPropuesta, timezone)
          }
          guardando={arreglar.isPending}
          error={arreglar.error === null ? null : mensajeDelError(t, arreglar.error)}
          onGuardar={(horaElegida) => {
            const instante = localDateTimeToInstant(salida.dia, horaElegida, timezone);
            if (instante === null) return;
            lanzar(
              salida.id,
              {
                tipo: 'marcar_salida',
                employeeId: salida.sesion.employee_id,
                locationId,
                instante,
                motivo: t('timesheet.cases.clockOutReasonOther'),
              },
              () => setSalida(null),
            );
          }}
          onClose={() => {
            arreglar.reset();
            setSalida(null);
          }}
        />
      ) : null}
    </>
  );
}

/** «4 h 49 min», «1 h», «45 min». */
function duracion(t: TFunction, minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return t('schedule.unusual.minutes', { m });
  if (m === 0) return t('schedule.unusual.hours', { h });
  return t('schedule.unusual.hoursMinutes', { h, m });
}

function mensajeDelError(t: TFunction, error: unknown): string {
  const motivo = error instanceof CasoRechazado ? error.motivo : null;
  if (motivo === 'AJUSTADA') return t('timesheet.cases.errorAdjusted');
  if (motivo === 'YA_TIENE_PAUSA') return t('timesheet.cases.errorHasBreak');
  if (adminErrorKind(error) === 'forbidden') return t('states.noAccessBody');
  return t('timesheet.cases.errorGeneric');
}
