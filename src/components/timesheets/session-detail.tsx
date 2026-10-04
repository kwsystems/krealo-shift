import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { alertLabelKey } from './session-row';
import { FormField } from '@/components/ui/form-field';
import {
  AdminSheet,
  InlineNotice,
  KeyValueRow,
  SegmentedControl,
  SelectField,
  type Option,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Mitad, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { BREAK_REASONS, type BreakReason } from '@/domain/break-reason';
import { breakReasonLabels, departureReasonLabelKey } from '@/i18n/break-reason-labels';
import {
  dateKeyOf,
  formatDateKeyShort,
  formatWeekdayShort,
  localTimeOf,
  shiftInstants,
} from '@/features/schedules/week';
import { readAdjustmentSide, type AdjustmentSide } from '@/features/timesheets/adjustment-summary';
import type { TimeAdjustment, TimeEvent, WorkSession } from '@/features/timesheets/api';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import { minutosVisibles, type EnCurso } from '@/features/timesheets/en-curso';
import type { SupportedLanguage } from '@/i18n';
import { esCumplidoEspecial, etiquetaDeCumplido } from '@/features/timesheets/textos-de-cumplido';
import { spacing } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

/**
 * Detalle diario y corrección de una sesión (§11.4).
 *
 * El motivo es obligatorio y el botón no se activa sin él: una corrección sin
 * motivo no se puede auditar, y la especificación exige conservar valor anterior,
 * valor nuevo, autor, fecha de servidor y motivo.
 *
 * Los eventos crudos se listan como historia, nunca como campos editables: son
 * append-only.
 */

const EVENT_LABEL_KEYS: Record<TimeEvent['event_type'], string> = {
  clock_in: 'attendance.eventClockIn',
  break_start: 'attendance.eventBreakStart',
  break_end: 'attendance.eventBreakEnd',
  clock_out: 'attendance.eventClockOut',
};

export function SessionDetailSheet({
  session,
  employeeName,
  events,
  adjustments,
  alerts,
  timezone,
  timeFormat,
  language,
  saving,
  conflict,
  onSubmitCorrection,
  onReclassifyDeparture,
  seccionHoraExtra,
  onUndoCredit,
  undoingCredit = false,
  enCurso,
  nowISO,
  semanaAprobada = false,
  error = null,
  onClose,
}: {
  session: WorkSession;
  employeeName: string;
  events: TimeEvent[];
  adjustments: TimeAdjustment[];
  alerts: TimesheetAlert[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  saving: boolean;
  conflict: boolean;
  onSubmitCorrection: (params: {
    newStartsAt: string | null;
    newEndsAt: string | null;
    reason: string;
  }) => void;
  /**
   * Reclasificar una salida como pausa: «se fue al almacén, no se fue a casa».
   *
   * Opcional a propósito. La hoja de sesión se usa también donde no hay forma de
   * corregir —o donde quien mira no manda en esa sede— y ahí el botón no debe salir.
   */
  onReclassifyDeparture?: (params: { eventId: string; breakReason: BreakReason }) => void;
  /**
   * «¿Cuenta como hora extra?» para el día de esta jornada (30-sep). Llega hecha desde la
   * pantalla, que es la que tiene los turnos y lo aprobado; aquí solo se coloca.
   */
  seccionHoraExtra?: ReactNode;
  /**
   * Deshacer un «cumplido por motivo especial» (4-oct): borra esa jornada y el turno vuelve a
   * ser lo que era —una falta, si nadie marcó—. Solo para las jornadas que lo son.
   */
  onUndoCredit?: () => void;
  undoingCredit?: boolean;
  /** Si la persona sigue dentro: para contar sus horas en vivo, como la fila. */
  enCurso?: EnCurso;
  nowISO: string;
  /**
   * LA SEMANA YA ESTÁ APROBADA (auditoría, 4-oct): se puede corregir igual —bloquearlo es
   * decisión de Andree—, pero se avisa antes, y el servidor lo anota en la semana.
   */
  semanaAprobada?: boolean;
  /**
   * SI CORREGIR, «NO FUE FIN DE JORNADA» O «DESHACER CUMPLIDO» FALLÓ (auditoría, 4-oct). La
   * hoja se quedaba abierta sin decir nada; el choque con otra edición ya tenía su aviso
   * (`conflict`), el resto de fallos no.
   */
  error?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const startDateKey = dateKeyOf(session.starts_at, timezone);
  const entradaComoEstaba = localTimeOf(session.starts_at, timezone);
  const salidaComoEstaba = session.ends_at === null ? '' : localTimeOf(session.ends_at, timezone);
  const [startTime, setStartTime] = useState(entradaComoEstaba);
  const [endTime, setEndTime] = useState(salidaComoEstaba);
  /** Ni la entrada ni la salida cambiaron: no hay nada que corregir. */
  const [sinCambios, setSinCambios] = useState(false);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  /*
   * UNA HORA QUE TODAVÍA NO LLEGÓ (1-oct). Pasada la medianoche, una salida «a las 21:00»
   * puede caer en la noche de mañana: la jornada seguía viva hasta entonces en Inicio y en
   * Horario. Se para aquí, con el porqué, y el servidor la rechaza también.
   */
  const [futura, setFutura] = useState(false);
  /** El fichaje que se está reclasificando, o `null` si la hoja está cerrada. */
  const [reclasificando, setReclasificando] = useState<string | null>(null);

  const reasonValid = reason.trim().length >= 3;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!reasonValid) return;

    /*
     * SOLO SE MANDA LO QUE SE TOCO (auditoría, 4-oct). La hoja enseña las horas sin segundos
     * y mandaba siempre la entrada: poner solo la salida reenviaba 09:58:41 como 09:58:00.
     * Eso pagaba hasta un minuto de más, dejaba en el historial y en Reportes una
     * corrección de entrada que nadie hizo, y «Descontar refrigerio» dejaba de funcionar en
     * esa jornada, porque ya estaba «ajustada». `null` es «como estaba», también para el
     * servidor.
     */
    const tocoLaEntrada = startTime.trim() !== entradaComoEstaba;
    const tocoLaSalida = endTime.trim() !== '' && endTime.trim() !== salidaComoEstaba;
    setSinCambios(!tocoLaEntrada && !tocoLaSalida);
    if (!tocoLaEntrada && !tocoLaSalida) return;

    const instants = shiftInstants({
      dateKey: startDateKey,
      startTime,
      endTime: endTime.trim() === '' ? startTime : endTime,
      timezone,
    });
    if (instants === null) return;
    // El minuto de la pantalla, no `Date.now()`: lo mismo con cinco minutos de margen.
    const limite = Date.parse(nowISO) + MARGEN_FUTURO_MS;
    const inicio = tocoLaEntrada ? instants.startsAt : null;
    const fin = tocoLaSalida ? instants.endsAt : null;
    const esFutura =
      (inicio !== null && Date.parse(inicio) > limite) ||
      (fin !== null && Date.parse(fin) > limite);
    setFutura(esFutura);
    if (esFutura) return;

    onSubmitCorrection({ newStartsAt: inicio, newEndsAt: fin, reason: reason.trim() });
  };

  return (
    <AdminSheet
      visible
      title={t('timesheet.sessionTitle', {
        name: employeeName,
        day: `${formatWeekdayShort(startDateKey, language)} ${formatDateKeyShort(startDateKey, language)}`,
      })}
      onClose={onClose}
      testID="session-detail-sheet"
      footer={
        <Stack gap={spacing.sm}>
          {/* En el pie, junto al botón: ahí mira quien acaba de tocar «Corregir». */}
          {error !== null ? (
            <AppText
              variant="help"
              tone="danger"
              accessibilityRole="alert"
              testID="session-detail-error"
            >
              {error}
            </AppText>
          ) : null}
          <PrimaryButton
            label={t('timesheet.correctEntry')}
            onPress={handleSubmit}
            loading={saving}
            disabled={submitted && !reasonValid}
            testID="session-correct-submit"
          />
        </Stack>
      }
    >
      <AppText variant="bodyStrong">{employeeName}</AppText>
      <KeyValueRow
        label={t('timesheet.period')}
        value={`${formatClockTime(session.starts_at, timezone, timeFormat, language)} – ${
          session.ends_at === null
            ? t('timesheet.stillOpen')
            : formatClockTime(session.ends_at, timezone, timeFormat, language)
        }`}
      />
      <KeyValueRow
        label={t('timesheet.netHours')}
        value={(() => {
          // La misma cifra que su fila: ver `minutosVisibles`.
          const visibles = minutosVisibles(session, alerts, enCurso, nowISO);
          if (visibles.minutos === null) return '–';
          const horas = minutesToHHmm(visibles.minutos);
          return visibles.enVivo ? `${horas} · ${t('timesheet.live')}` : horas;
        })()}
        testID="session-detail-net"
      />
      <KeyValueRow
        label={t('timesheet.breaks')}
        value={minutesToHHmm(session.unpaid_break_minutes + session.paid_break_minutes)}
      />

      {esCumplidoEspecial(session) ? (
        <InlineNotice
          tone="working"
          icon="ribbon-outline"
          title={etiquetaDeCumplido(t, session, true)}
          body={t('credit.detailBody')}
          action={
            onUndoCredit === undefined ? undefined : (
              <GhostButton
                label={t('credit.undo')}
                onPress={onUndoCredit}
                loading={undoingCredit}
                testID="session-undo-credit"
              />
            )
          }
          testID="session-credit"
        />
      ) : null}

      {alerts.length > 0 ? (
        <Row gap={spacing.xs} wrap align="flex-start">
          {alerts.map((alert) => (
            <StatusBadge key={alert} label={t(alertLabelKey(alert))} tone="late" compact />
          ))}
        </Row>
      ) : null}

      {seccionHoraExtra}

      {/*
        LO QUE LA PERSONA YA CONTESTÓ AL IRSE, justo debajo de la marca que lo señala.
        Sin esto el gerente ve «Salida anticipada» y tiene que preguntar mañana por algo
        que el reloj ya preguntó ayer, y entonces la pregunta del reloj era un trámite
        que no le ahorró nada a nadie.
      */}
      {session.departure_reason !== null ? (
        <KeyValueRow
          label={t('timesheet.departureReason')}
          value={
            session.departure_note === null || session.departure_note === ''
              ? t(departureReasonLabelKey(session.departure_reason))
              : `${t(departureReasonLabelKey(session.departure_reason))} · ${session.departure_note}`
          }
        />
      ) : null}

      <AppText variant="bodyStrong">{t('timesheet.rawEvents')}</AppText>
      {events.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('timesheet.noRawEvents')}
        </AppText>
      ) : (
        <Stack gap={spacing.xs}>
          {events.map((event) => (
            <Stack key={event.id} gap={spacing.xs}>
              <KeyValueRow
                label={`${t(EVENT_LABEL_KEYS[event.event_type])}${
                  event.is_offline ? ` · ${t('timesheet.fromOffline')}` : ''
                }`}
                value={formatClockTime(event.occurred_at, timezone, timeFormat, language)}
              />
              {/*
                LO QUE SE MARCÓ ARRIBA, CÓMO SE CUENTA ABAJO. Nunca se sustituye la
                etiqueta: la fila sigue diciendo «Salida» porque eso es lo que la persona
                hizo, y esta línea añade en qué se convirtió. Tapar la primera con la
                segunda sería reescribir el registro en la pantalla, que es lo mismo que
                el proyecto se prohíbe hacer en la base.
              */}
              {event.reclassified_as !== null ? (
                <AppText variant="help" tone="muted">
                  {t('timesheet.countedAsBreak', {
                    reason:
                      event.break_reason === null
                        ? t('kiosk.reasonOther')
                        : breakReasonLabels(t)[event.break_reason as BreakReason],
                  })}
                </AppText>
              ) : onReclassifyDeparture === undefined ||
                event.event_type !== 'clock_out' ? null : reclasificando === event.id ? (
                /*
                  LOS MOTIVOS SALEN AQUÍ, pegados al fichaje que se está cambiando, y no
                  al final de la hoja. La primera versión los ponía abajo del todo: se
                  pulsaba «No fue fin de jornada» y no pasaba nada visible, porque la
                  lista aparecía fuera de la pantalla, debajo del formulario de corregir.
                  Un control que responde donde no estás mirando es un control que no
                  responde.

                  Y son los motivos de PAUSA, no los de salida anticipada: lo que se
                  crea aquí es una pausa, y así la empresa ya sabe si esos minutos
                  cuentan como trabajados sin una segunda tabla de equivalencias.
                */
                <Stack gap={spacing.xs}>
                  <AppText variant="help" tone="muted">
                    {t('timesheet.reclassifyHelp')}
                  </AppText>
                  {BREAK_REASONS.map((motivo) => (
                    <SecondaryButton
                      key={motivo}
                      label={breakReasonLabels(t)[motivo]}
                      onPress={() => {
                        onReclassifyDeparture({ eventId: event.id, breakReason: motivo });
                        setReclasificando(null);
                      }}
                      testID={`reclassify-reason-${motivo}`}
                    />
                  ))}
                  <GhostButton
                    label={t('common.cancel')}
                    onPress={() => setReclasificando(null)}
                    testID="reclassify-cancel"
                  />
                </Stack>
              ) : (
                <GhostButton
                  label={t('timesheet.reclassifyDeparture')}
                  onPress={() => setReclasificando(event.id)}
                  testID={`reclassify-${event.id}`}
                />
              )}
            </Stack>
          ))}
        </Stack>
      )}

      <AppText variant="bodyStrong">{t('timesheet.changeHistory')}</AppText>
      {adjustments.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('timesheet.noChanges')}
        </AppText>
      ) : (
        <Stack gap={spacing.md}>
          {adjustments.map((adjustment) => (
            <Stack key={adjustment.id} gap={spacing.xs}>
              <KeyValueRow
                label={`${formatClockTime(adjustment.created_at, timezone, timeFormat, language)} · ${adjustment.channel}`}
                value={adjustment.reason}
              />
              {/*
                QUÉ cambió, y no solo que algo cambió. Los dos valores ya venían en la
                consulta y no se pintaban: un motivo suelto —"corrección de salida"— no
                dice si fueron cinco minutos o cinco horas, que es lo único que se revisa
                en una auditoría. §11.4 pide ver el historial de cambios.
              */}
              <KeyValueRow
                label={t('timesheet.previousValue')}
                value={describeSide(readAdjustmentSide(adjustment.before_value), {
                  t,
                  timezone,
                  timeFormat,
                  language,
                })}
              />
              {/*
                QUIÉN lo cambió. §11.4 exige conservar el autor y la columna existía en la
                base desde la primera migración; lo que no había era forma de mostrarla,
                porque `created_by` apunta a `auth.users` y el cliente no puede leer esa
                tabla. Lo resuelve la vista `time_adjustments_with_author`.
              */}
              <KeyValueRow label={t('timesheet.changedBy')} value={adjustment.author_name ?? '—'} />
              <KeyValueRow
                label={t('timesheet.newValue')}
                value={describeSide(readAdjustmentSide(adjustment.after_value), {
                  t,
                  timezone,
                  timeFormat,
                  language,
                })}
              />
            </Stack>
          ))}
        </Stack>
      )}

      {conflict ? (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          title={t('states.conflictTitle')}
          body={t('errors.concurrentEdit')}
        />
      ) : null}

      {semanaAprobada ? (
        <InlineNotice
          tone="warning"
          icon="lock-closed-outline"
          title={t('timesheet.approvedWeekTitle')}
          body={t('timesheet.approvedWeekBody')}
          testID="timesheet-detail-approved-week"
        />
      ) : null}

      <AppText variant="bodyStrong">{t('timesheet.correctEntry')}</AppText>
      {/* En mitades: ver `Mitad`. */}
      <Row gap={spacing.md} align="flex-start">
        <Mitad>
          <FormField
            label={t('timesheet.newStart')}
            value={startTime}
            onChangeText={(texto) => {
              setSinCambios(false);
              setStartTime(texto);
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="09:00"
            testID="session-correct-start"
          />
        </Mitad>
        <Mitad>
          <FormField
            label={t('timesheet.newEnd')}
            value={endTime}
            onChangeText={(texto) => {
              setFutura(false);
              setSinCambios(false);
              setEndTime(texto);
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="17:00"
            error={futura ? t('timesheet.futureTimeShort') : undefined}
            testID="session-correct-end"
          />
        </Mitad>
      </Row>
      {/* El porqué, a todo el ancho: bajo un campo de media hoja no cabe. */}
      {futura ? (
        <AppText variant="help" tone="danger" testID="session-correct-future">
          {t('timesheet.futureTime')}
        </AppText>
      ) : null}
      {sinCambios ? (
        <AppText variant="help" tone="danger" testID="session-correct-unchanged">
          {t('timesheet.nothingChanged')}
        </AppText>
      ) : null}
      {session.ends_at === null ? (
        <AppText variant="help" tone="subtle" testID="session-correct-open-hint">
          {t('timesheet.closeOpenHint')}
        </AppText>
      ) : null}
      <FormField
        label={t('timesheet.reasonLabel')}
        value={reason}
        onChangeText={setReason}
        multiline
        error={submitted && !reasonValid ? t('timesheet.reasonRequired') : undefined}
        testID="session-correct-reason"
      />
    </AdminSheet>
  );
}

/**
 * Fichaje manual del gerente (§11.4).
 *
 * Queda como solicitud auditable con motivo obligatorio: la app no puede crear
 * eventos crudos, que son append-only y solo los escribe el servidor.
 */
export function ManualEntrySheet({
  employees,
  days,
  openDayByEmployee,
  isFuture,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  employees: Option<string>[];
  /**
   * LOS DÍAS QUE SE PUEDEN ELEGIR, de hoy hacia atrás (1-oct). Antes la fecha era siempre
   * la de hoy y no se podía cambiar: pasada la medianoche, la salida que faltaba de anoche
   * se registraba en la noche de mañana.
   */
  days: Option<string>[];
  /** El día de la jornada que cada persona tiene abierta: ahí va su salida. */
  openDayByEmployee: ReadonlyMap<string, string>;
  isFuture: (dateKey: string, time: string) => boolean;
  saving: boolean;
  /**
   * POR QUÉ NO SE GUARDÓ, DENTRO DE LA HOJA (4-oct). Antes el fallo no se veía en ningún
   * sitio: la hoja se quedaba abierta, el botón no hacía nada y no había forma de saber si
   * se había guardado. Lo vio Andree poniendo la entrada de una vendedora.
   */
  error: string | null;
  onSubmit: (params: {
    employeeId: string;
    kind: 'forgot_clock_in' | 'forgot_clock_out' | 'correction';
    dateKey: string;
    time: string;
    reason: string;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(employees[0]?.value ?? null);
  const [kind, setKind] = useState<'forgot_clock_in' | 'forgot_clock_out' | 'correction'>(
    'forgot_clock_in',
  );
  const [day, setDay] = useState(days[0]?.value ?? '');
  const [time, setTime] = useState('09:00');
  const [horaTocada, setHoraTocada] = useState(false);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  /** La salida que falta es del día en que entró, no de hoy. */
  const sugerirDia = (
    persona: string | null,
    tipo: 'forgot_clock_in' | 'forgot_clock_out' | 'correction',
  ) => {
    const abierta = persona === null ? undefined : openDayByEmployee.get(persona);
    if (tipo === 'forgot_clock_out' && abierta !== undefined) setDay(abierta);
  };

  const reasonValid = reason.trim().length >= 3;
  const futura = kind !== 'correction' && isFuture(day, time);
  const canSubmit = employeeId !== null && reasonValid && !futura;
  const opcionesDeDia = days.some((d) => d.value === day)
    ? days
    : [...days, { value: day, label: day }];

  return (
    <AdminSheet
      visible
      title={t('timesheet.addManualEntry')}
      onClose={onClose}
      testID="manual-entry-sheet"
      footer={
        <PrimaryButton
          // El botón dice lo que pasa: una entrada o una salida se registran al momento; una
          // corrección va a la Bandeja (4-oct). Decía siempre «Enviar fichaje manual».
          label={
            kind === 'forgot_clock_in'
              ? t('timesheet.registerClockIn')
              : kind === 'forgot_clock_out'
                ? t('timesheet.registerClockOut')
                : t('timesheet.sendToInbox')
          }
          onPress={() => {
            setSubmitted(true);
            if (!canSubmit || employeeId === null) return;
            onSubmit({ employeeId, kind, dateKey: day, time, reason: reason.trim() });
          }}
          loading={saving}
          disabled={submitted && !canSubmit}
          testID="manual-entry-submit"
        />
      }
    >
      {/*
        DOS AVISOS, porque son dos caminos: «Olvidé marcar» se registra al momento y
        «Correcciones de hora» va a Solicitudes. Decía siempre lo segundo, y quien ponía una
        entrada creía que tenía que aprobarla después.
      */}
      <InlineNotice
        tone="info"
        icon="document-text-outline"
        title={
          kind === 'correction'
            ? t('timesheet.manualEntryNoticeTitle')
            : t('timesheet.manualEntryDirectNoticeTitle')
        }
        body={
          kind === 'correction'
            ? t('timesheet.manualEntryNoticeBody')
            : t('timesheet.manualEntryDirectNoticeBody')
        }
        testID="manual-entry-notice"
      />

      <SegmentedControl
        label={t('timesheet.manualEntryKind')}
        value={kind}
        options={[
          { value: 'forgot_clock_in', label: t('kiosk.forgotClockIn') },
          { value: 'forgot_clock_out', label: t('kiosk.forgotClockOut') },
          { value: 'correction', label: t('requests.tabTimeCorrections') },
        ]}
        onChange={(tipo) => {
          setKind(tipo);
          sugerirDia(employeeId, tipo);
        }}
        testID="manual-entry-kind"
      />

      <SelectField
        label={t('schedule.employee')}
        value={employeeId}
        options={employees}
        onChange={(persona) => {
          setEmployeeId(persona);
          sugerirDia(persona, kind);
        }}
        emptyLabel={t('team.noEmployeesForLocation')}
        testID="manual-entry-employee"
      />

      <SegmentedControl
        label={t('schedule.date')}
        value={day}
        options={opcionesDeDia}
        onChange={setDay}
        testID="manual-entry-day"
      />

      <FormField
        label={t('timesheet.manualEntryTime')}
        value={time}
        onChangeText={(texto) => {
          setHoraTocada(true);
          setTime(texto);
        }}
        keyboardType="numbers-and-punctuation"
        placeholder="09:00"
        // Solo después de tocarla o de enviar: las 09:00 que trae de partida no son un error.
        error={futura && (horaTocada || submitted) ? t('timesheet.futureTime') : undefined}
        testID="manual-entry-time"
      />

      <FormField
        label={t('timesheet.reasonLabel')}
        value={reason}
        onChangeText={setReason}
        multiline
        error={submitted && !reasonValid ? t('timesheet.reasonRequired') : undefined}
        testID="manual-entry-reason"
      />

      {error !== null ? (
        <AppText variant="help" tone="danger" accessibilityRole="alert" testID="manual-entry-error">
          {error}
        </AppText>
      ) : null}
    </AdminSheet>
  );
}

/** Lo que se tolera de reloj adelantado: lo mismo que el servidor (`shared/salida-a-mano.ts`). */
const MARGEN_FUTURO_MS = 5 * 60_000;

/**
 * Un lado de la corrección, en una línea legible.
 *
 * La forma la decide `readAdjustmentSide`; aquí solo se traduce. Se separa porque una
 * forma desconocida tiene que decirse —no adivinarse ni romper la pantalla— y eso es
 * una decisión de presentación, no de datos.
 */
function describeSide(
  side: AdjustmentSide,
  ctx: {
    t: TFunction;
    timezone: string;
    timeFormat: TimeFormatPreference;
    language: SupportedLanguage;
  },
): string {
  const hora = (iso: string | null) =>
    iso === null ? '—' : formatClockTime(iso, ctx.timezone, ctx.timeFormat, ctx.language);

  switch (side.kind) {
    case 'absent':
      return ctx.t('timesheet.valueDidNotExist');
    case 'session': {
      const neto = side.netMinutes === null ? '' : ` · ${minutesToHHmm(side.netMinutes)}`;
      return `${hora(side.startsAt)} – ${hora(side.endsAt)}${neto}`;
    }
    case 'event': {
      const etiqueta = EVENT_LABEL_KEYS[side.eventType as TimeEvent['event_type']];
      const nombre = etiqueta === undefined ? side.eventType : ctx.t(etiqueta);
      return `${nombre} · ${hora(side.occurredAt)}`;
    }
    default:
      return ctx.t('timesheet.valueUnknownShape');
  }
}
