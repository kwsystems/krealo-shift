import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  OtraSalidaSheet,
  PorResolver,
  ResolverFaltaSheet,
  type FilaPorResolver,
} from '@/components/timesheets/por-resolver';
import type { ShiftRow } from '@/features/schedules/api';
import {
  addDaysToKey,
  dateKeyOf,
  formatDayColumn,
  localDateTimeToInstant,
  localTimeOf,
} from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { departureReasonLabelKey } from '@/i18n/break-reason-labels';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';
import { formatClockTime, formatShiftRange, type TimeFormatPreference } from '@/utils/time';

import { acknowledgeUnusualClock, type WorkSession } from './api';
import { casosPorResolver, type CasoPorResolver } from './casos';
import { duracion } from './duracion';
import {
  porQueNoSeArreglo,
  useArreglarCaso,
  useHorasDebidasDeLaSede,
  useSaldarHorasDebidas,
} from './horas-debidas';
import { useGuardarHoraExtra } from './horas-extra';

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
  organizationId,
  locationId,
  umbralExtra,
  nowISO,
  timezone,
  timeFormat,
  language,
  aprobadas,
  onVerJornada,
}: {
  sesiones: readonly WorkSession[];
  turnos: readonly ShiftRow[];
  nombres: ReadonlyMap<string, string>;
  personaFiltrada: string | null;
  organizationId: string | null;
  locationId: string | null;
  /** Desde cuántos minutos de más un día es «posible hora extra» (Ajustes). */
  umbralExtra: number;
  nowISO: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  /** Las horas extra aprobadas: una que cuenta el refrigerio como trabajado decide su caso. */
  aprobadas: ReadonlyMap<string, number>;
  onVerJornada: (sesion: WorkSession) => void;
}) {
  const { t } = useTranslation();
  const arreglar = useArreglarCaso();
  // Las deudas pendientes: una que ya no cuadra con la jornada corregida es un caso (8-oct).
  const debidas = useHorasDebidasDeLaSede({ organizationId, locationId });
  const saldar = useSaldarHorasDebidas();
  /*
   * LA HORA EXTRA Y LAS MARCAS FUERA DE TURNO SE DECIDEN AQUÍ (6-oct), no en Horario. Las dos
   * escriben lo mismo que su sitio de antes —la aprobación del día y `avisos_vistos`—, así que
   * Horario, Reportes e Inicio se enteran igual.
   */
  const queryClient = useQueryClient();
  const guardarExtra = useGuardarHoraExtra({ organizationId, locationId });
  const darPorVisto = useMutation({
    mutationFn: async (sesiones: readonly WorkSession[]) => {
      for (const sesion of sesiones) await acknowledgeUnusualClock(sesion.id);
    },
    onSuccess: () => refrescarVistasDeHoras(queryClient),
  });
  const [falta, setFalta] = useState<{
    caso: Extract<CasoPorResolver, { tipo: 'faltan_horas' }>;
    decision: 'debe' | 'justificado';
  } | null>(null);
  const [salida, setSalida] = useState<Extract<
    CasoPorResolver,
    { tipo: 'sin_salida' | 'salida_dudosa' }
  > | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);

  const casos = casosPorResolver({
    sesiones,
    turnos,
    ahoraISO: nowISO,
    timezone,
    aprobadas,
    umbralExtra,
    debidas: debidas.data ?? [],
  }).filter((caso) => personaFiltrada === null || caso.sesion.employee_id === personaFiltrada);
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
    if (caso.tipo === 'salida_dudosa') {
      const fin = caso.sesion.ends_at ?? caso.sesion.starts_at;
      const propuesta = caso.salidaPropuesta;
      const diaDeLaSalida = formatDayColumn(dateKeyOf(fin, timezone), language);
      return {
        ...base,
        que: caso.futura
          ? t('timesheet.cases.oddExitFuture', { day: diaDeLaSalida, time: hora(fin) })
          : t('timesheet.cases.oddExitLong', {
              day: diaDeLaSalida,
              time: hora(fin),
              hours: duracion(
                t,
                Math.round((Date.parse(fin) - Date.parse(caso.sesion.starts_at)) / 60_000),
              ),
            }),
        detalle: t('timesheet.cases.oddExitDetail', { in: hora(caso.sesion.starts_at) }),
        principal:
          propuesta === null
            ? {
                etiqueta: t('timesheet.cases.otherTime'),
                onPress: () => setSalida(caso),
                testID: `caso-${caso.id}-salida`,
              }
            : {
                etiqueta: t('timesheet.cases.fixExitAt', {
                  day: formatDayColumn(dateKeyOf(propuesta, timezone), language),
                  time: hora(propuesta),
                }),
                onPress: () =>
                  lanzar(caso.id, {
                    tipo: 'corregir_salida',
                    sessionId: caso.sesion.id,
                    expectedUpdatedAt: caso.sesion.updated_at,
                    instante: propuesta,
                    motivo: t('timesheet.cases.fixExitReason'),
                  }),
                testID: `caso-${caso.id}-salida`,
              },
        /*
         * «LA SALIDA ESTÁ BIEN» (8-oct): una jornada larga de verdad —inventario, cierre de
         * noche— no tenía cómo darse por buena; solo se iba poniendo una salida falsa. Para
         * otra hora queda «Ver jornada».
         */
        alternativa: !caso.futura
          ? {
              etiqueta: t('timesheet.cases.autoExitOk'),
              onPress: () =>
                lanzar(caso.id, { tipo: 'salida_dudosa_ok', sessionId: caso.sesion.id }),
              testID: `caso-${caso.id}-ok`,
            }
          : propuesta === null
            ? null
            : {
                etiqueta: t('timesheet.cases.otherTime'),
                onPress: () => setSalida(caso),
                testID: `caso-${caso.id}-otra-hora`,
              },
      };
    }
    /*
     * SALIDA PUESTA SOLA (5-oct): la jornada que nadie cerró se cerró a la hora de fin de su
     * turno. Darla por buena, o corregirla en la jornada: corregirla también lo resuelve.
     */
    if (caso.tipo === 'salida_automatica') {
      const fin = caso.sesion.ends_at ?? caso.sesion.starts_at;
      return {
        ...base,
        que: t('timesheet.cases.autoExit', { time: hora(fin) }),
        detalle:
          caso.turno === null
            ? t('timesheet.cases.autoExitNoShift')
            : t('timesheet.cases.autoExitDetail'),
        principal: {
          etiqueta: t('timesheet.cases.autoExitOk'),
          onPress: () =>
            lanzar(caso.id, { tipo: 'salida_automatica_ok', sessionId: caso.sesion.id }),
          testID: `caso-${caso.id}-ok`,
        },
        alternativa: {
          etiqueta: t('timesheet.cases.autoExitFix'),
          onPress: () => onVerJornada(caso.sesion),
          testID: `caso-${caso.id}-corregir`,
        },
      };
    }
    /*
     * FUERA DE TURNO (6-oct): trabajó de más, o entró o salió lejos de su turno. Con horas de
     * más que llegan al aviso de la sede, la pregunta es la extra; sin ellas, solo si está bien.
     */
    if (caso.tipo === 'fuera_de_turno') {
      const fin = caso.sesion.ends_at ?? caso.sesion.starts_at;
      const marcas = `${hora(caso.entrada)}\u00a0–\u2060\u00a0${hora(fin)}`;
      const que = caso.posibleExtra
        ? caso.turno === null
          ? t('timesheet.cases.workedNoShift', { hours: duracion(t, caso.deMas) })
          : t('timesheet.cases.workedMore', { hours: duracion(t, caso.deMas) })
        : caso.entroAntes >= caso.salioDespues
          ? t('timesheet.cases.cameEarly', { hours: duracion(t, caso.entroAntes) })
          : t('timesheet.cases.leftLate', { hours: duracion(t, caso.salioDespues) });
      const ocupado = (guardarExtra.isPending || darPorVisto.isPending) && enCurso === caso.id;
      const decidirExtra = (minutos: number) => {
        setEnCurso(caso.id);
        guardarExtra.mutate(
          { employeeId: caso.sesion.employee_id, workDate: caso.dia, minutes: minutos },
          { onSettled: () => setEnCurso(null) },
        );
      };
      return {
        ...base,
        ocupada: ocupado,
        que,
        detalle:
          caso.turno === null
            ? t('timesheet.cases.outsideDetailNoShift', { marks: marcas })
            : t('timesheet.cases.outsideDetail', {
                shift: formatShiftRange(
                  caso.turno.starts_at,
                  caso.turno.ends_at,
                  timezone,
                  timeFormat,
                  language,
                ),
                marks: marcas,
              }),
        principal: caso.posibleExtra
          ? {
              etiqueta: t('timesheet.cases.approveExtra', { hours: duracion(t, caso.deMas) }),
              onPress: () => decidirExtra(caso.deMas),
              testID: `caso-${caso.id}-extra`,
            }
          : {
              etiqueta: t('timesheet.cases.fineAsIs'),
              onPress: () => {
                setEnCurso(caso.id);
                darPorVisto.mutate(caso.conMarcas, { onSettled: () => setEnCurso(null) });
              },
              testID: `caso-${caso.id}-visto`,
            },
        alternativa: caso.posibleExtra
          ? {
              etiqueta: t('timesheet.cases.notExtra'),
              onPress: () => decidirExtra(0),
              testID: `caso-${caso.id}-no-extra`,
            }
          : null,
      };
    }
    if (caso.tipo === 'deuda_que_no_cuadra') {
      const debe = duracion(t, caso.deuda.minutos);
      const ahora = duracion(t, caso.faltaAhora);
      return {
        ...base,
        ocupada: (saldar.isPending || arreglar.isPending) && enCurso === caso.id,
        que:
          caso.faltaAhora === 0
            ? t('timesheet.cases.debtStale', { owed: debe })
            : t('timesheet.cases.debtChanged', { owed: debe, now: ahora }),
        detalle: t('timesheet.cases.debtDetail', { owed: debe }),
        principal:
          caso.faltaAhora === 0
            ? {
                etiqueta: t('timesheet.cases.debtRemove'),
                onPress: () => {
                  setEnCurso(caso.id);
                  saldar.mutate(
                    { id: caso.deuda.id, estado: 'forgiven' },
                    { onSettled: () => setEnCurso(null) },
                  );
                },
                testID: `caso-${caso.id}-quitar`,
              }
            : {
                etiqueta: t('timesheet.cases.debtUpdate', { now: ahora }),
                onPress: () =>
                  lanzar(caso.id, {
                    tipo: 'debe',
                    sessionId: caso.deuda.id,
                    minutos: caso.faltaAhora,
                    nota: caso.deuda.nota,
                  }),
                testID: `caso-${caso.id}-poner`,
              },
        alternativa:
          caso.faltaAhora === 0
            ? null
            : {
                etiqueta: t('timesheet.cases.debtRemove'),
                onPress: () => {
                  setEnCurso(caso.id);
                  saldar.mutate(
                    { id: caso.deuda.id, estado: 'forgiven' },
                    { onSettled: () => setEnCurso(null) },
                  );
                },
                testID: `caso-${caso.id}-quitar`,
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
    guardarExtra.error !== null || darPorVisto.error !== null
      ? t('timesheet.cases.decisionFailed')
      : arreglar.error === null || falta !== null || salida !== null
        ? null
        : porQueNoSeArreglo(t, arreglar.error);

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
          error={arreglar.error === null ? null : porQueNoSeArreglo(t, arreglar.error)}
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
          error={arreglar.error === null ? null : porQueNoSeArreglo(t, arreglar.error)}
          onGuardar={(horaElegida) => {
            const elDia = localDateTimeToInstant(salida.dia, horaElegida, timezone);
            if (elDia === null) return;
            // Una hora antes de la entrada es de la madrugada siguiente: turno de noche.
            const instante =
              Date.parse(elDia) > Date.parse(salida.sesion.starts_at)
                ? elDia
                : localDateTimeToInstant(addDaysToKey(salida.dia, 1), horaElegida, timezone);
            if (instante === null) return;
            lanzar(
              salida.id,
              salida.tipo === 'salida_dudosa'
                ? {
                    tipo: 'corregir_salida',
                    sessionId: salida.sesion.id,
                    expectedUpdatedAt: salida.sesion.updated_at,
                    instante,
                    motivo: t('timesheet.cases.fixExitReason'),
                  }
                : {
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
