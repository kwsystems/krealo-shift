import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AnclaDePersona } from '@/components/ui/ancla';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack, useRespuestaAlPuntero } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { feriadoDe } from '@/domain/feriados-peru';
import { dateKeyOf } from '@/features/schedules/week';
import type { WorkSession } from '@/features/timesheets/api';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import {
  CLAVE_DE_ESTADO,
  ICONO_DE_ESTADO,
  estadoDeFila,
  estadoVisible,
  minutosVisibles,
  type EnCurso,
} from '@/features/timesheets/en-curso';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';
import { spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';
import { esCumplidoEspecial, etiquetaDeCumplido } from '@/features/timesheets/textos-de-cumplido';

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
  unpublishedShift: 'alert-circle',
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
    case 'unpublishedShift':
      return 'timesheet.flagUnpublishedShift';
    default:
      return 'states.needsReviewBadge';
  }
}

/**
 * La hora extra del día de una fila: APROBADA por quien gestiona, o POSIBLE —trabajó
 * bastante más que su turno y nadie lo ha mirado todavía—. Ver `horas-extra.ts`.
 */
export type HoraExtraDeLaFila = { tipo: 'aprobada' | 'posible'; minutos: number };

export function SessionRow({
  session,
  employeeName,
  alerts,
  enCurso,
  horaExtra,
  nowISO,
  timezone,
  timeFormat,
  language,
  onPress,
  testID,
}: {
  session: WorkSession;
  employeeName: string;
  alerts: TimesheetAlert[];
  /** Si está dentro ahora mismo: trabajando o en descanso. Sale de la misma consulta que Inicio. */
  enCurso?: EnCurso;
  /** Solo en la última fila del día de esa persona: la aprobación es por día. */
  horaExtra?: HoraExtraDeLaFila;
  /** Para contar en vivo las horas de una jornada abierta. */
  nowISO: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  onPress: (session: WorkSession) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const styles = useEstilos();
  const { colors } = useTheme();
  const respuesta = useRespuestaAlPuntero();

  const estado = estadoDeFila(session, alerts, enCurso);
  const feriado = feriadoDe(dateKeyOf(session.starts_at, timezone), timezone);
  const dentro = estado === 'trabajando' || estado === 'descanso';

  const start = formatClockTime(session.starts_at, timezone, timeFormat, language);
  const end =
    session.ends_at === null
      ? t('timesheet.stillOpen')
      : formatClockTime(session.ends_at, timezone, timeFormat, language);

  /*
   * LAS HORAS DE ALGUIEN QUE SIGUE DENTRO SE CUENTAN EN VIVO. Antes salía «00:00», que es
   * lo que vale `net_minutes` mientras la sesión no se cierra: cierto para la base, falso
   * para quien mira. Y una jornada olvidada no enseña ninguna cifra —una raya—, porque la
   * suya no se puede saber hasta que alguien diga a qué hora salió de verdad.
   */
  const visibles = minutosVisibles(session, alerts, enCurso, nowISO);
  const net = visibles.minutos === null ? '–' : minutesToHHmm(visibles.minutos);

  // «A tiempo» solo tiene sentido si había un turno contra el que medir y no llegó tarde.
  const aTiempo = dentro && session.shift_id !== null && !alerts.includes('lateArrival');

  const descansoDesde =
    estado === 'descanso' && enCurso !== undefined && enCurso.descansoDesde !== null
      ? formatClockTime(enCurso.descansoDesde, timezone, timeFormat, language)
      : null;

  /*
   * «desde» a secas también en el descanso: la insignia de al lado ya dice «En descanso», y
   * repetirlo —«En descanso · descanso desde 10:27»— partía la línea en dos en un teléfono
   * sin decir nada más.
   */
  const segundaLinea =
    estado === 'trabajando'
      ? t('timesheet.sinceTime', { time: start })
      : estado === 'descanso'
        ? t('timesheet.sinceTime', { time: descansoDesde ?? start })
        : esCumplidoEspecial(session)
          ? // Cumplido por un motivo especial (4-oct): el motivo, no «Según horario».
            `${start} – ${end} · ${etiquetaDeCumplido(t, session)}`
          : session.source === 'import'
            ? /*
               * REGISTRADA DESDE EL HORARIO, no fichada: la semana es de antes del reloj y
               * alguien la registró como cumplida. Se dice en la fila porque las horas son
               * las mismas que las de un día fichado, y sin esto no habría forma de saber
               * que nadie marcó esas horas.
               */
              `${start} – ${end} · ${t('timesheet.fromSchedule')}`
            : `${start} – ${end}`;

  // «Almorzando» si su pausa es la comida: ver `estadoVisible`.
  const visible =
    estado === 'trabajando' || estado === 'descanso'
      ? estadoVisible(estado, enCurso?.motivo)
      : null;
  const etiquetaDeEstado = visible === null ? '' : t(CLAVE_DE_ESTADO[visible]);

  const nombreAccesible = dentro
    ? `${employeeName}. ${etiquetaDeEstado}, ${segundaLinea}. ${t('timesheet.netHours')}: ${net}, ${t('timesheet.live')}`
    : `${employeeName}. ${start} – ${end}. ${t('timesheet.netHours')}: ${net}`;

  return (
    <Pressable
      onPress={() => onPress(session)}
      accessibilityRole="button"
      /* El nombre accesible SÍ dice qué es cada número: quien no ve la cabecera lo necesita. */
      accessibilityLabel={nombreAccesible}
      accessibilityHint={t('timesheet.openDetailHint')}
      testID={testID}
      {...respuesta.props}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.fila,
            estado === 'trabajando' ? styles.filaTrabajando : null,
            estado === 'descanso' ? styles.filaDescanso : null,
            ...respuesta.estilo(
              pressed,
              estado === 'trabajando'
                ? colors.success100
                : estado === 'descanso'
                  ? colors.warning100
                  : undefined,
            ),
          ]}
        >
          <Row gap={spacing.md} align="center">
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
              {/*
                EL ESTADO VA CON PALABRA E ICONO, NO SOLO CON COLOR (§21): el verde dice
                «está dentro» de un vistazo, y «Trabajando» lo dice a quien no distingue el
                verde o lee con un lector de pantalla.
              */}
              {dentro ? (
                <Row gap={spacing.xs} wrap align="center">
                  <StatusBadge
                    label={etiquetaDeEstado}
                    tone={estado === 'trabajando' ? 'working' : 'onBreak'}
                    icon={ICONO_DE_ESTADO[visible ?? 'trabajando']}
                    compact
                  />
                  <AppText variant="help" tone="muted" tabular>
                    {aTiempo ? `${segundaLinea} · ${t('timesheet.onTime')}` : segundaLinea}
                  </AppText>
                </Row>
              ) : (
                <AppText variant="help" tone="muted" tabular>
                  {segundaLinea}
                </AppText>
              )}
            </Stack>
            {/*
            DOS COLUMNAS DE ANCHO FIJO, que es lo que hace que las horas se puedan comparar
            sin leerlas: caen en la misma vertical en todas las filas, así que el total de
            una sesión se mide contra el de la de arriba de un vistazo. Con un bloque que
            crece según su contenido, cada fila pone su número en otro sitio.

            La pausa pierde su rótulo repetido: la cabecera lo dice una vez y aquí queda el
            número, que es lo que cambia de fila en fila.
          */}
            {dentro ? (
              <Stack gap={0} style={estilosDeColumna.netas}>
                {/*
                  EL NÚMERO EN TINTA, NO EN VERDE. En verde sobre el verde de la fila quedaba a
                  4,71:1, y al pasar el puntero a 4,26: por debajo de lo que se lee. El verde
                  ya lo dicen el fondo y la insignia; el número es texto y va en color de texto.
                */}
                <AppText
                  variant="bodyStrong"
                  tabular
                  style={estilosDeColumna.derecha}
                  testID={testID === undefined ? undefined : `${testID}-en-curso`}
                >
                  {net}
                </AppText>
                <AppText variant="label" tone="subtle" style={estilosDeColumna.derecha}>
                  {estado === 'trabajando' ? t('timesheet.live') : t('timesheet.paused')}
                </AppText>
              </Stack>
            ) : (
              <AppText variant="bodyStrong" tabular style={estilosDeColumna.netas}>
                {net}
              </AppText>
            )}
            <AppText variant="label" tone="subtle" tabular style={estilosDeColumna.pausas}>
              {session.unpaid_break_minutes > 0 ? minutesToHHmm(session.unpaid_break_minutes) : '–'}
            </AppText>
          </Row>

          {alerts.length > 0 || horaExtra !== undefined || feriado !== null ? (
            <Row gap={spacing.xs} wrap align="flex-start">
              {/*
                LA HORA EXTRA, CON PALABRA Y CIFRA. «Posible» en ámbar pide que alguien lo
                mire; «aprobada» en azul ya está decidida. El color sigue a la palabra, no
                al revés (§21).
              */}
              {/*
                EN FERIADO: se paga con un 100 % más (D.L. 713), y quien revisa las horas
                tiene que verlo en la fila, no tener que cruzarla con un calendario.
              */}
              {feriado !== null ? (
                <StatusBadge
                  label={t('holidays.labelWithName', { name: t(`holidays.pe.${feriado}`) })}
                  tone="info"
                  icon="flag"
                  compact
                />
              ) : null}
              {horaExtra !== undefined ? (
                <StatusBadge
                  label={
                    horaExtra.tipo === 'aprobada'
                      ? t('timesheet.overtimeApprovedBadge', {
                          hours: minutesToHHmm(horaExtra.minutos),
                        })
                      : t('timesheet.overtimePossible', { hours: minutesToHHmm(horaExtra.minutos) })
                  }
                  tone={horaExtra.tipo === 'aprobada' ? 'info' : 'warning'}
                  icon={horaExtra.tipo === 'aprobada' ? 'checkmark-circle' : 'hourglass-outline'}
                  compact
                />
              ) : null}
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
      )}
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
  /*
   * UN TINTE, NO UNA TARJETA. Quien está dentro ahora se encuentra de un vistazo bajando por
   * la lista, sin leer ninguna fila: verde si trabaja, ámbar si está en su descanso. Los
   * mismos dos tonos que Inicio usa para lo mismo, así que no hay que aprender un color
   * nuevo en cada pestaña.
   */
  filaTrabajando: { backgroundColor: colors.success50 },
  filaDescanso: { backgroundColor: colors.warning50 },
}));

/**
 * Las dos columnas de la derecha de una sesión: horas netas y pausas.
 *
 * Anchos FIJOS a propósito, y los mismos que su cabecera: lo que las hace servir es que
 * caigan en la misma vertical en todas las filas. Si creciesen con su contenido, la hoja
 * volvería a ser una lista de fichas donde comparar exige leer.
 */
const estilosDeColumna = StyleSheet.create({
  netas: { width: 80, textAlign: 'right', flexShrink: 0 },
  derecha: { textAlign: 'right' },
  pausas: { width: 72, textAlign: 'right', flexShrink: 0 },
});
