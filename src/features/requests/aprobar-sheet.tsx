import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { propuestaDe, type FichajeDeLaAprobacion, type TimeEditRequest } from './api';
import {
  AdminSheet,
  InlineNotice,
  KeyValueRow,
  SegmentedControl,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import {
  addDaysToKey,
  dateKeyOf,
  localDateTimeToInstant,
  localTimeToMinutes,
  minutesToLocalTime,
} from '@/features/schedules/week';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { formatLongDate } from '@/utils/time';

/**
 * APROBAR UN «OLVIDÉ MARCAR» ES REGISTRAR EL FICHAJE QUE FALTA (30-sep).
 *
 * Por eso se pregunta antes de aprobar, y no se aprueba de un toque como una corrección:
 * lo que se va a escribir son horas que se pagan, y la solicitud del reloj trae solo la
 * hora que tecleó la persona —«14:30»—, sin día. Aquí se ve y se confirma el día —el de
 * la solicitud, que casi siempre es el bueno— y la hora, y se puede corregir antes de que
 * cuente.
 *
 * Tres casos, y cada uno pide lo suyo:
 *  - la ENTRADA que faltó, y opcionalmente la salida: quien no marcó al llegar tampoco pudo
 *    marcar al irse, porque el reloj no deja salir a quien no entró. Sin salida la jornada
 *    quedaría abierta, y el servidor solo lo acepta si es de hoy;
 *  - la SALIDA que faltó;
 *  - el DESCANSO: entero, o solo el final de uno que sí empezó a marcar. Es lo que dice el
 *    botón del reloj, «olvidé iniciar o terminar descanso».
 */

type ModoDescanso = 'entero' | 'final';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Lo que se tolera por delante del reloj: dos relojes nunca coinciden del todo. */
const MARGEN_FUTURO_MS = 2 * 60 * 1000;

export function AprobarSolicitudSheet({
  request,
  employeeName,
  timezone,
  requiredBreakMinutes,
  saving,
  error,
  onConfirm,
  onClose,
}: {
  request: TimeEditRequest;
  employeeName: string;
  timezone: string;
  requiredBreakMinutes: number;
  saving: boolean;
  /** El motivo del servidor ya traducido, si no pudo aprobarse. */
  error: string | null;
  onConfirm: (fichajes: FichajeDeLaAprobacion[], comment: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const propuesta = propuestaDe(request, timezone);
  const duracion = requiredBreakMinutes > 0 ? requiredBreakMinutes : 60;
  const masDuracion = (hora: string | null) => {
    const minutos = hora === null ? null : localTimeToMinutes(hora);
    return minutos === null ? '' : minutesToLocalTime(minutos + duracion);
  };

  const [fecha, setFecha] = useState(propuesta.fecha ?? dateKeyOf(new Date(), timezone));
  const [hora, setHora] = useState(propuesta.hora ?? '');
  const [salida, setSalida] = useState('');
  const [modo, setModo] = useState<ModoDescanso>('entero');
  const [finDescanso, setFinDescanso] = useState(masDuracion(propuesta.hora));
  const [comentario, setComentario] = useState('');
  const [invalido, setInvalido] = useState<string | null>(null);

  const kind = request.kind;

  /** El día de un campo: si la hora es menor que la de antes, cruzó la medianoche. */
  const instante = (horaDelCampo: string, despuesDe?: string): string | null => {
    const minutos = localTimeToMinutes(horaDelCampo);
    const antes = despuesDe === undefined ? null : localTimeToMinutes(despuesDe);
    const dia =
      antes !== null && minutos !== null && minutos < antes ? addDaysToKey(fecha, 1) : fecha;
    return localDateTimeToInstant(dia, horaDelCampo, timezone);
  };

  const construir = (): FichajeDeLaAprobacion[] | string => {
    if (!DIA.test(fecha)) return t('requests.approveInvalidDay');
    const fichajes: FichajeDeLaAprobacion[] = [];
    const agregar = (
      type: FichajeDeLaAprobacion['type'],
      horaDelCampo: string,
      despuesDe?: string,
    ) => {
      const occurred = instante(horaDelCampo, despuesDe);
      if (occurred === null) return false;
      fichajes.push({ type, occurred_at: occurred });
      return true;
    };

    if (kind === 'forgot_clock_in') {
      if (!agregar('clock_in', hora)) return t('schedule.invalidTime');
      if (salida.trim() !== '' && !agregar('clock_out', salida, hora)) {
        return t('schedule.invalidTime');
      }
    } else if (kind === 'forgot_clock_out') {
      if (!agregar('clock_out', hora)) return t('schedule.invalidTime');
    } else if (modo === 'entero') {
      if (!agregar('break_start', hora) || !agregar('break_end', finDescanso, hora)) {
        return t('schedule.invalidTime');
      }
    } else if (!agregar('break_end', finDescanso)) {
      return t('schedule.invalidTime');
    }

    const limite = Date.now() + MARGEN_FUTURO_MS;
    if (fichajes.some((fichaje) => Date.parse(fichaje.occurred_at) > limite)) {
      return t('requests.approveErrorFuture');
    }
    return fichajes;
  };

  const confirmar = () => {
    const resultado = construir();
    if (typeof resultado === 'string') {
      setInvalido(resultado);
      return;
    }
    setInvalido(null);
    onConfirm(resultado, comentario.trim() === '' ? null : comentario.trim());
  };

  const mediodia = localDateTimeToInstant(fecha, '12:00', timezone);
  const diaLegible = mediodia === null ? fecha : formatLongDate(mediodia, timezone, language);
  const aviso = invalido ?? error;

  return (
    <AdminSheet
      visible
      title={t('requests.approveSheetTitle')}
      onClose={onClose}
      testID="approve-sheet"
      footer={
        <PrimaryButton
          label={t('requests.approveConfirm')}
          onPress={confirmar}
          loading={saving}
          testID="approve-confirm"
        />
      }
    >
      <Stack gap={spacing.base}>
        <Stack gap={spacing.xs}>
          <AppText variant="bodyStrong">{employeeName}</AppText>
          <AppText variant="help" tone="muted">
            {request.reason}
          </AppText>
        </Stack>

        <InlineNotice tone="info" icon="create-outline" body={t('requests.approveSheetBody')} />

        <Stack gap={spacing.xs}>
          <AppText variant="label" tone="muted">
            {t('requests.approveDay')}
          </AppText>
          <AppText variant="bodyStrong" testID="approve-day">
            {diaLegible}
          </AppText>
          {/*
            El día va en su línea y los dos botones debajo, juntos: en el teléfono, con el
            día en medio, «Día siguiente» caía solo en la línea de abajo y parecía otra cosa.
          */}
          <Row gap={spacing.sm} align="center">
            <GhostButton
              label={`‹ ${t('requests.previousDay')}`}
              onPress={() => setFecha((actual) => addDaysToKey(actual, -1))}
              fullWidth={false}
              testID="approve-day-previous"
            />
            <GhostButton
              label={`${t('requests.nextDay')} ›`}
              onPress={() => setFecha((actual) => addDaysToKey(actual, 1))}
              fullWidth={false}
              testID="approve-day-next"
            />
          </Row>
        </Stack>

        {kind === 'forgot_break' ? (
          <SegmentedControl
            label={t('requests.breakWhatMissing')}
            value={modo}
            options={[
              { value: 'entero', label: t('requests.breakWhole') },
              { value: 'final', label: t('requests.breakEndOnly') },
            ]}
            onChange={(nuevo) => {
              setModo(nuevo);
              // «Solo el final»: la hora que propuso es, casi seguro, la de su vuelta.
              if (nuevo === 'final' && propuesta.hora !== null) setFinDescanso(propuesta.hora);
              if (nuevo === 'entero') setFinDescanso(masDuracion(hora === '' ? null : hora));
            }}
            testID="approve-break-mode"
          />
        ) : null}

        {kind !== 'forgot_break' || modo === 'entero' ? (
          <FormField
            label={
              kind === 'forgot_clock_in'
                ? t('requests.clockInTime')
                : kind === 'forgot_clock_out'
                  ? t('requests.clockOutTime')
                  : t('requests.breakStart')
            }
            value={hora}
            onChangeText={setHora}
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
            testID="approve-time"
          />
        ) : null}

        {kind === 'forgot_clock_in' ? (
          <Stack gap={spacing.xs}>
            <FormField
              label={t('requests.clockOutOptional')}
              value={salida}
              onChangeText={setSalida}
              placeholder="17:00"
              keyboardType="numbers-and-punctuation"
              testID="approve-clock-out"
            />
            <AppText variant="help" tone="muted">
              {t('requests.clockOutOptionalHint')}
            </AppText>
          </Stack>
        ) : null}

        {kind === 'forgot_break' ? (
          <FormField
            label={modo === 'entero' ? t('requests.breakEnd') : t('requests.breakReturn')}
            value={finDescanso}
            onChangeText={setFinDescanso}
            placeholder="14:00"
            keyboardType="numbers-and-punctuation"
            testID="approve-break-end"
          />
        ) : null}

        {propuesta.hora !== null ? (
          <KeyValueRow label={t('requests.proposedTime')} value={propuesta.hora} />
        ) : null}

        <FormField
          label={t('requests.commentOptional')}
          value={comentario}
          onChangeText={setComentario}
          multiline
          testID="approve-comment"
        />

        {aviso !== null ? (
          <InlineNotice
            tone="late"
            icon="alert-circle-outline"
            body={aviso}
            testID="approve-error"
          />
        ) : null}
      </Stack>
    </AdminSheet>
  );
}
