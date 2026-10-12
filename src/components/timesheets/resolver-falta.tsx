import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf } from '@/features/schedules/week';
import { addManualTimeEvent, registrarQueVino } from '@/features/timesheets/api';
import type { Falta } from '@/features/timesheets/faltas';
import { useMutacionesDeFaltas } from '@/features/timesheets/justificaciones';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';
import { useResponsive } from '@/hooks/use-responsive';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { formatShiftRange, type TimeFormatPreference } from '@/utils/time';

import { JustificarFaltaSheet, RegistrarQueVinoSheet } from './faltas-de-la-semana';

/**
 * RESOLVER UNA FALTA —O UN «NO HA LLEGADO»— EN EL MOMENTO (12-oct).
 *
 * Andree: «cuando una persona no marca al comienzo y ya es falta, yo debería poder
 * reconocerlo rápido y poder marcarlo como falta para que luego no salga todo lo demás… no
 * esperar a todo el día para poder arreglarlo. Hoy una vendedora no ha marcado porque se ha
 * olvidado, ¿dónde lo arreglo? No aparece en ningún lado».
 *
 * Hasta hoy, un turno sin marcas solo se podía tocar cuando TERMINABA: antes era «No ha
 * llegado» en Inicio y en Horario, sin ningún botón. Ahora, en cuanto pasa la tolerancia,
 * hay dos respuestas, las mismas que tiene una falta:
 *
 *   - «VINO Y NO MARCÓ»: se registra su entrada y la jornada queda abierta. Ella sigue en el
 *     reloj como cualquier día —refrigerio, salida—. Con el turno ya terminado se registran
 *     entrada y salida de una vez, como siempre.
 *   - «FALTÓ»: justificada o no, con el motivo. Es falta desde ese momento en todas las
 *     vistas (`faltas.ts`), y como no hay jornada, no sale nada más de ese día: ni tardanza,
 *     ni refrigerio, ni «sin salida». Si después aparece y marca, la falta se va sola.
 *
 * UN SOLO SITIO PARA LAS HOJAS Y LO QUE GUARDAN, y lo usan Horas e Inicio: con una copia en
 * cada pantalla acabarían guardando cosas distintas para el mismo botón.
 */
export function useResolverFalta(params: {
  nombres: ReadonlyMap<string, string>;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  nowISO: string;
  /** Lo que se le dice a quien gestiona al terminar: «Registrado», «Guardado». */
  onHecho?: (mensaje: string) => void;
}): { abrirVino: (falta: Falta) => void; abrirPorQue: (falta: Falta) => void; hojas: ReactNode } {
  const { nombres, timezone, timeFormat, language, nowISO, onHecho } = params;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutacionesDeFaltas = useMutacionesDeFaltas();
  const [vino, setVino] = useState<Falta | null>(null);
  const [porQue, setPorQue] = useState<Falta | null>(null);

  const registrar = useMutation({
    mutationFn: async (variables: {
      falta: Falta;
      entradaISO: string;
      salidaISO: string | null;
      motivo: string;
    }) => {
      const { falta, entradaISO, salidaISO, motivo } = variables;
      if (salidaISO === null) {
        // Turno en curso: la entrada sola, atada a su turno. La salida la marca ella.
        await addManualTimeEvent({
          employeeId: falta.employeeId,
          locationId: falta.turno.location_id,
          eventType: 'clock_in',
          occurredAt: entradaISO,
          reason: motivo,
          shiftId: falta.id,
        });
        return;
      }
      await registrarQueVino({
        shiftId: falta.id,
        startsAt: entradaISO,
        endsAt: salidaISO,
        reason: motivo,
      });
    },
    onSuccess: () => refrescarVistasDeHoras(queryClient),
  });

  const nombreDe = (falta: Falta) => nombres.get(falta.employeeId) ?? t('team.unknownEmployee');
  const enCurso = (falta: Falta) => Date.parse(falta.turno.ends_at) > Date.parse(nowISO);

  const hojas = (
    <>
      {vino === null ? null : (
        <RegistrarQueVinoSheet
          key={vino.id}
          falta={vino}
          nombre={nombreDe(vino)}
          timezone={timezone}
          language={language}
          ahoraISO={nowISO}
          guardando={registrar.isPending}
          onGuardar={async ({ entradaISO, salidaISO, motivo }) => {
            await registrar.mutateAsync({ falta: vino, entradaISO, salidaISO, motivo });
            setVino(null);
            onHecho?.(
              salidaISO === null
                ? t('timesheet.absences.registeredClockIn')
                : t('timesheet.absences.registered'),
            );
          }}
          onClose={() => setVino(null)}
        />
      )}
      {porQue === null ? null : (
        <JustificarFaltaSheet
          key={porQue.id}
          falta={porQue}
          nombre={nombreDe(porQue)}
          timezone={timezone}
          timeFormat={timeFormat}
          language={language}
          enCurso={enCurso(porQue)}
          guardando={
            mutacionesDeFaltas.justificar.isPending || mutacionesDeFaltas.darPorCumplido.isPending
          }
          quitando={mutacionesDeFaltas.quitar.isPending}
          onGuardar={async (respuesta) => {
            if (respuesta.kind === 'credit') {
              await mutacionesDeFaltas.darPorCumplido.mutateAsync({
                shiftId: porQue.id,
                reason: respuesta.reason,
                note: respuesta.note,
              });
              setPorQue(null);
              onHecho?.(t('absence.creditSaved'));
              return;
            }
            await mutacionesDeFaltas.justificar.mutateAsync({
              shiftId: porQue.id,
              kind: respuesta.kind,
              reason: respuesta.reason,
              note: respuesta.note,
            });
            setPorQue(null);
            onHecho?.(t('absence.saved'));
          }}
          onQuitar={async () => {
            await mutacionesDeFaltas.quitar.mutateAsync(porQue.id);
            setPorQue(null);
            onHecho?.(t('absence.saved'));
          }}
          onClose={() => setPorQue(null)}
        />
      )}
    </>
  );

  return { abrirVino: setVino, abrirPorQue: setPorQue, hojas };
}

/**
 * Un turno en curso visto como la falta que todavía no es: las hojas trabajan con faltas, y
 * así un «no ha llegado» y una falta de ayer se resuelven con las mismas.
 */
export function comoFalta(turno: ShiftRow, timezone: string): Falta {
  return {
    id: turno.id,
    turno,
    employeeId: turno.employee_id,
    dia: dateKeyOf(turno.starts_at, timezone),
    resolucion: null,
  };
}

/**
 * «TODAVÍA NO HA MARCADO» (12-oct): los turnos que ya empezaron —pasada la tolerancia— sin
 * ninguna marca, cada uno con sus dos respuestas. La regla es la de Inicio y Horario
 * (`turnoSinLlegar`), así que sale aquí exactamente quien allí dice «No ha llegado».
 */
export function TodaviaNoHaMarcado({
  turnos,
  nombres,
  timezone,
  timeFormat,
  onVino,
  onFalto,
}: {
  turnos: readonly ShiftRow[];
  nombres: ReadonlyMap<string, string>;
  timezone: string;
  timeFormat: TimeFormatPreference;
  onVino: (falta: Falta) => void;
  onFalto: (falta: Falta) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const { density } = useResponsive();
  const ancha = density === 'extraWide';
  if (turnos.length === 0) return null;
  const ordenados = [...turnos].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <View style={estilos.caja} testID="sin-marcar-ahora">
      <Stack gap={spacing.md}>
        <Row gap={spacing.sm} align="center" wrap>
          <Ionicons name="alarm-outline" size={20} color={colors.danger600} />
          <AppText variant="bodyStrong" accessibilityRole="header" style={estilos.crece}>
            {t('timesheet.notClockedIn.title', { count: ordenados.length })}
          </AppText>
        </Row>
        <AppText variant="help" tone="muted">
          {t('timesheet.notClockedIn.body')}
        </AppText>
        <Stack gap={0}>
          {ordenados.map((turno, indice) => {
            const falta = comoFalta(turno, timezone);
            return (
              <View
                key={turno.id}
                style={[
                  estilos.fila,
                  ancha ? estilos.filaAncha : null,
                  indice > 0 ? estilos.conRegla : null,
                ]}
                testID={`sin-marcar-${turno.id}`}
              >
                <Stack gap={spacing.xs} style={ancha ? estilos.textoAncho : undefined}>
                  <Row gap={spacing.sm} align="center" wrap>
                    <AppText variant="bodyStrong">
                      {nombres.get(turno.employee_id) ?? t('team.unknownEmployee')}
                    </AppText>
                    <StatusBadge
                      label={t('schedule.notArrived')}
                      tone="late"
                      icon="alert-circle"
                      compact
                    />
                  </Row>
                  <AppText variant="body">
                    {t('timesheet.notClockedIn.what', {
                      range: formatShiftRange(turno.starts_at, turno.ends_at, timezone, timeFormat),
                    })}
                  </AppText>
                </Stack>
                <Row gap={spacing.sm} wrap align="center">
                  <SecondaryButton
                    label={t('timesheet.notClockedIn.cameAnyway')}
                    onPress={() => onVino(falta)}
                    fullWidth={false}
                    testID={`sin-marcar-${turno.id}-vino`}
                  />
                  <GhostButton
                    label={t('timesheet.notClockedIn.absent')}
                    onPress={() => onFalto(falta)}
                    fullWidth={false}
                    testID={`sin-marcar-${turno.id}-falto`}
                  />
                </Row>
              </View>
            );
          })}
        </Stack>
      </Stack>
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  caja: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.focus,
    borderColor: colors.danger600,
    padding: spacing.base,
  },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: { paddingVertical: spacing.md, gap: spacing.sm },
  // Como la caja de faltas: texto y botones en una fila si caben (ver `faltas-de-la-semana`).
  filaAncha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.base,
    rowGap: spacing.sm,
  },
  textoAncho: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 280 },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
}));
