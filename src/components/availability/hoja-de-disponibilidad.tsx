import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { CalendarioDeDias } from '@/components/schedule/calendario-de-dias';
import {
  AdminSheet,
  Chip,
  InlineNotice,
  SegmentedControl,
  SelectField,
} from '@/components/schedule/fields';
import { MonthNavigator } from '@/components/schedule/week-tools';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, GhostButton, PrimaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import {
  DisponibilidadRechazada,
  useMutacionesDeDisponibilidad,
} from '@/features/availability/api';
import type { Disponibilidad, TipoDeDisponibilidad } from '@/features/availability/disponibilidad';
import type { DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { horaEscrita } from '@/domain/hora-escrita';

/**
 * AGREGAR O CAMBIAR UNA DISPONIBILIDAD (1-oct). La misma hoja en Equipo —quien gestiona,
 * para cualquiera de su sede— y en el celular de la persona, para la suya.
 *
 * Tres preguntas, en el orden en que se piensan: ¿cuándo? (cada semana un día, o un día
 * concreto), ¿qué pasa? (no puede, prefiere unas horas, o solo un comentario) y, si hace
 * falta, ¿a qué horas? Y un comentario, que es lo que de verdad explica.
 */

export type ValoresIniciales = {
  fila: Disponibilidad | null;
  employeeId: string | null;
  kind?: 'weekly' | 'date';
  weekday?: number | null;
  date?: DateKey | null;
};

/** «lunes», «martes»…: el nombre del día ISO, en el idioma de la app. */
export function nombreDelDiaDeSemana(iso: number, language: SupportedLanguage, corto = false) {
  // El 28-sep-2026 es lunes: cualquier semana real sirve de referencia.
  const fecha = new Date(Date.UTC(2026, 8, 27 + iso, 12));
  return new Intl.DateTimeFormat(language === 'es-PE' ? 'es-PE' : 'en-US', {
    weekday: corto ? 'short' : 'long',
    timeZone: 'UTC',
  }).format(fecha);
}

function desplazarMes(primero: DateKey, meses: number): DateKey {
  const indice = Number(primero.slice(0, 4)) * 12 + Number(primero.slice(5, 7)) - 1 + meses;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}-01`;
}

function mensajeDelError(t: TFunction, error: unknown): string {
  if (error instanceof DisponibilidadRechazada && error.motivo === 'HORAS') {
    return t('availability.errorHours');
  }
  if (error instanceof DisponibilidadRechazada && error.motivo === 'NOTA') {
    return t('availability.errorNote');
  }
  return t('availability.errorGeneric');
}

export function HojaDeDisponibilidad({
  inicial,
  organizationId,
  personas,
  primera = false,
  hoy,
  weekStartsOn,
  language,
  onClose,
}: {
  inicial: ValoresIniciales;
  organizationId: string;
  /** Quien gestiona elige a la persona. `null` en el celular: es la suya. */
  personas: { value: string; label: string }[] | null;
  primera?: boolean;
  hoy: DateKey;
  weekStartsOn: number;
  language: SupportedLanguage;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutaciones = useMutacionesDeDisponibilidad();
  const fila = inicial.fila;
  const voz = primera ? 'Mine' : '';

  const [persona, setPersona] = useState<string | null>(
    fila?.employee_id ?? inicial.employeeId ?? personas?.[0]?.value ?? null,
  );
  const [kind, setKind] = useState<'weekly' | 'date'>(fila?.kind ?? inicial.kind ?? 'weekly');
  const [weekday, setWeekday] = useState<number>(fila?.weekday ?? inicial.weekday ?? 1);
  const [date, setDate] = useState<DateKey>(fila?.date ?? inicial.date ?? hoy);
  const [mes, setMes] = useState<DateKey>(`${(fila?.date ?? inicial.date ?? hoy).slice(0, 7)}-01`);
  const [type, setType] = useState<TipoDeDisponibilidad>(fila?.type ?? 'unavailable');
  const [todoElDia, setTodoElDia] = useState(fila === null ? true : fila.from_time === null);
  const [desde, setDesde] = useState(fila?.from_time ?? '08:00');
  const [hasta, setHasta] = useState(fila?.to_time ?? '13:00');
  const [nota, setNota] = useState(fila?.note ?? '');
  const [intentado, setIntentado] = useState(false);

  const conHoras = type === 'preferred' || (type === 'unavailable' && !todoElDia);
  // «9:00», «9», «18.30» o «6pm» valen y se guardan como «HH:MM» (8-oct: «9:00» no valía).
  const desdeLeida = horaEscrita(desde);
  const hastaLeida = horaEscrita(hasta);
  const horasMal =
    conHoras && (desdeLeida === null || hastaLeida === null || hastaLeida <= desdeLeida);
  const notaFalta = type === 'note' && nota.trim() === '';
  const valido = persona !== null && !horasMal && !notaFalta;

  const guardando = mutaciones.guardar.isPending;
  const error =
    mutaciones.guardar.error ?? mutaciones.quitar.error ?? mutaciones.marcarVistas.error;
  const nombreDePersona = personas?.find((p) => p.value === persona)?.label ?? '';

  const titulo = primera
    ? t('availability.sheetTitleMine')
    : fila === null
      ? t('availability.sheetTitleNew')
      : t('availability.sheetTitleEdit', { name: nombreDePersona });

  const guardar = () => {
    setIntentado(true);
    if (!valido) return;
    mutaciones.guardar.mutate(
      {
        id: fila?.id ?? null,
        organizationId,
        employeeId: personas === null ? null : persona,
        kind,
        weekday: kind === 'weekly' ? weekday : null,
        date: kind === 'date' ? date : null,
        type,
        from: conHoras ? desdeLeida : null,
        to: conHoras ? hastaLeida : null,
        note: nota.trim() === '' ? null : nota.trim(),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <AdminSheet
      visible
      title={titulo}
      onClose={onClose}
      testID="disponibilidad-hoja"
      footer={
        <PrimaryButton
          label={t('availability.save')}
          onPress={guardar}
          loading={guardando}
          disabled={intentado && !valido}
          testID="disponibilidad-guardar"
        />
      }
    >
      {/* Quien gestiona la da por vista desde aquí mismo, sin cambiar nada. */}
      {fila !== null && fila.status === 'new' && personas !== null ? (
        <InlineNotice
          tone="info"
          icon="sparkles-outline"
          title={t('availability.newFromEmployee')}
          action={
            <GhostButton
              label={t('availability.markSeen')}
              onPress={() => mutaciones.marcarVistas.mutate([fila.id], { onSuccess: onClose })}
              loading={mutaciones.marcarVistas.isPending}
              fullWidth={false}
              testID="disponibilidad-visto"
            />
          }
        />
      ) : null}
      {mutaciones.marcarVistas.isError ? (
        <AppText variant="help" tone="danger" testID="disponibilidad-visto-error">
          {t('errors.generic')}
        </AppText>
      ) : null}

      {personas === null || fila !== null ? null : (
        <SelectField
          label={t('availability.person')}
          value={persona}
          options={personas}
          onChange={setPersona}
          testID="disponibilidad-persona"
        />
      )}

      <SegmentedControl
        label={t('availability.when')}
        value={kind}
        options={[
          { value: 'weekly', label: t('availability.repeatWeekly') },
          { value: 'date', label: t('availability.repeatDate') },
        ]}
        onChange={setKind}
        testID="disponibilidad-cuando"
      />

      {kind === 'weekly' ? (
        <Stack gap={spacing.xs}>
          <AppText variant="label" tone="muted">
            {t('availability.weekday')}
          </AppText>
          <Row gap={spacing.xs} wrap>
            {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
              <Chip
                key={dia}
                label={nombreDelDiaDeSemana(dia, language)}
                selected={weekday === dia}
                onPress={() => setWeekday(dia)}
                testID={`disponibilidad-dia-${dia}`}
              />
            ))}
          </Row>
        </Stack>
      ) : (
        <Stack gap={spacing.xs}>
          <MonthNavigator
            monthStart={mes}
            language={language}
            isCurrentMonth={mes === `${hoy.slice(0, 7)}-01`}
            onPrevious={() => setMes(desplazarMes(mes, -1))}
            onNext={() => setMes(desplazarMes(mes, 1))}
            onGoToCurrent={() => setMes(`${hoy.slice(0, 7)}-01`)}
            testIDPrefix="disponibilidad-mes"
          />
          <CalendarioDeDias
            mes={mes}
            elegidos={new Set([date])}
            hoy={hoy}
            weekStartsOn={weekStartsOn}
            language={language}
            onDia={setDate}
            testID="disponibilidad-calendario"
          />
        </Stack>
      )}

      <SegmentedControl
        label={t('availability.what')}
        value={type}
        options={[
          { value: 'unavailable', label: t(`availability.typeUnavailable${voz}`) },
          { value: 'preferred', label: t(`availability.typePreferred${voz}`) },
          { value: 'note', label: t('availability.typeNote') },
        ]}
        onChange={setType}
        testID="disponibilidad-tipo"
      />

      {type === 'unavailable' ? (
        <SegmentedControl
          label={t('availability.hours')}
          value={todoElDia ? 'todo' : 'horas'}
          options={[
            { value: 'todo', label: t('availability.allDay') },
            { value: 'horas', label: t('availability.someHours') },
          ]}
          onChange={(valor) => setTodoElDia(valor === 'todo')}
          testID="disponibilidad-horas"
        />
      ) : null}

      {conHoras ? (
        <Row gap={spacing.md} align="flex-start">
          <FormField
            label={t('availability.from')}
            value={desde}
            onChangeText={setDesde}
            keyboardType="numbers-and-punctuation"
            placeholder="08:00"
            testID="disponibilidad-desde"
          />
          <FormField
            label={t('availability.to')}
            value={hasta}
            onChangeText={setHasta}
            keyboardType="numbers-and-punctuation"
            placeholder="13:00"
            testID="disponibilidad-hasta"
          />
        </Row>
      ) : null}
      {intentado && horasMal ? (
        <AppText variant="help" tone="danger">
          {t('availability.errorHours')}
        </AppText>
      ) : null}

      <FormField
        label={type === 'note' ? t('availability.noteRequired') : t('availability.note')}
        value={nota}
        onChangeText={setNota}
        multiline
        maxLength={280}
        placeholder={t('availability.notePlaceholder')}
        error={intentado && notaFalta ? t('availability.errorNote') : undefined}
        testID="disponibilidad-nota"
      />

      {error !== null ? (
        <AppText variant="help" tone="danger" testID="disponibilidad-error">
          {mensajeDelError(t, error)}
        </AppText>
      ) : null}

      {fila === null ? null : (
        <DangerButton
          label={t('availability.remove')}
          onPress={() => mutaciones.quitar.mutate(fila.id, { onSuccess: onClose })}
          loading={mutaciones.quitar.isPending}
          fullWidth={false}
          testID="disponibilidad-quitar"
        />
      )}
    </AdminSheet>
  );
}
