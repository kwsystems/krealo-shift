import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ShiftInput } from './api';
import { JORNADA_MAXIMA_MINUTOS } from './conflicts';
import { duracion as textoDeDuracion } from '@/features/timesheets/duracion';
import { minutosDeRefrigerio } from './refrigerio';
import { isValidLocalTime, localTimeToMinutes, type DateKey } from './week';
import { formatDateKeyShort } from './week';
import { FormField } from '@/components/ui/form-field';
import {
  AdminSheet,
  InlineNotice,
  SegmentedControl,
  SelectField,
  type Option,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * Formulario de turno (§11.3).
 *
 * Interacción de toque + formulario, sin arrastrar y soltar. Campos exactos de la
 * especificación: empleado, ubicación (la del editor), puesto, fecha, inicio, fin,
 * cruce de medianoche, descanso planificado, nota para el empleado y nota privada
 * del gerente.
 *
 * Guardar deja el turno en BORRADOR siempre: publicar es una acción aparte y
 * explícita (§11.3 paso 8).
 */

export type ShiftFormValues = {
  employeeId: string | null;
  jobRoleId: string | null;
  dateKey: DateKey;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  employeeNote: string;
  managerNote: string;
};

export function emptyShiftValues(dateKey: DateKey, employeeId: string | null): ShiftFormValues {
  return {
    employeeId,
    jobRoleId: null,
    dateKey,
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: '0',
    employeeNote: '',
    managerNote: '',
  };
}

type Props = {
  title: string;
  initial: ShiftFormValues;
  employees: Option<string>[];
  jobRoles: Option<string>[];
  days: DateKey[];
  language: SupportedLanguage;
  saving: boolean;
  /** Estado del turno existente. Ausente cuando se está creando. */
  existingStatus?: 'draft' | 'published' | 'cancelled';
  /**
   * Con esto, la hoja también sirve para marcar un día libre. Solo al CREAR: sobre un
   * turno que ya existe, «cambiar a descanso» tendría que decidir en silencio si borra el
   * turno, y esa es una pregunta con dos respuestas razonables. Se borra el turno y se
   * marca el descanso, en dos gestos que se ven.
   */
  onSubmitRestDay?: (params: { employeeId: string; dateKey: DateKey }) => void;
  onSubmit: (input: ShiftInput) => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  /**
   * SI NO SE PUDO GUARDAR, SE DICE AQUÍ (auditoría, 4-oct). La hoja se quedaba abierta sin
   * ningún mensaje y parecía que el botón no hacía nada.
   */
  error?: string | null;
  onClose: () => void;
};

export function ShiftFormSheet({
  title,
  initial,
  employees,
  jobRoles,
  days,
  language,
  saving,
  existingStatus,
  onSubmitRestDay,
  onSubmit,
  onDuplicate,
  onRemove,
  error = null,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ShiftFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [modo, setModo] = useState<'turno' | 'descanso'>('turno');
  const esDescanso = onSubmitRestDay !== undefined && modo === 'descanso';

  const startValid = isValidLocalTime(values.startTime);
  const endValid = isValidLocalTime(values.endTime);
  const employeeValid = values.employeeId !== null;

  const startMinutes = localTimeToMinutes(values.startTime);
  const endMinutes = localTimeToMinutes(values.endTime);
  const crossesMidnight =
    startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;
  const duracion =
    startMinutes === null || endMinutes === null
      ? null
      : endMinutes - startMinutes + (crossesMidnight ? 24 * 60 : 0);
  // El mismo tope que al pegar el horario: ninguna jornada de tienda pasa de 16 h.
  const tooLong = duracion !== null && duracion > JORNADA_MAXIMA_MINUTOS;

  // Ver `refrigerio.ts`: «1:00» es una hora, no cien minutos.
  const breakMinutes = minutosDeRefrigerio(values.breakMinutes);
  const breakValid = breakMinutes !== null && (duracion === null || breakMinutes < duracion);

  const canSubmit = startValid && endValid && !tooLong && breakValid && employeeValid;

  const handleSubmit = () => {
    setSubmitted(true);
    if (values.employeeId === null) return;

    if (esDescanso) {
      onSubmitRestDay?.({ employeeId: values.employeeId, dateKey: values.dateKey });
      return;
    }

    if (!canSubmit) return;

    onSubmit({
      employeeId: values.employeeId,
      jobRoleId: values.jobRoleId,
      dateKey: values.dateKey,
      startTime: values.startTime.trim(),
      endTime: values.endTime.trim(),
      plannedUnpaidBreakMinutes: breakMinutes ?? 0,
      employeeNote: values.employeeNote.trim() === '' ? null : values.employeeNote.trim(),
      managerNote: values.managerNote.trim() === '' ? null : values.managerNote.trim(),
    });
  };

  const dayOptions: Option<DateKey>[] = days.map((day) => ({
    value: day,
    label: formatDateKeyShort(day, language),
  }));

  return (
    <AdminSheet
      visible
      title={title}
      onClose={onClose}
      testID="shift-form-sheet"
      footer={
        <Stack gap={spacing.sm}>
          {error !== null ? (
            <AppText variant="help" tone="danger" testID="shift-form-error">
              {error}
            </AppText>
          ) : null}
          <PrimaryButton
            label={esDescanso ? t('schedule.markRestDay') : t('schedule.saveDraft')}
            hint={esDescanso ? t('schedule.markRestDayHint') : t('schedule.saveDraftHint')}
            onPress={handleSubmit}
            loading={saving}
            disabled={submitted && !(esDescanso ? employeeValid : canSubmit)}
            testID="shift-form-save"
          />
          <Row gap={spacing.sm} wrap>
            {onDuplicate !== undefined ? (
              <SecondaryButton
                label={t('schedule.duplicateShift')}
                onPress={onDuplicate}
                fullWidth={false}
                testID="shift-form-duplicate"
              />
            ) : null}
            {onRemove !== undefined ? (
              <DangerButton
                label={
                  existingStatus === 'published'
                    ? t('schedule.cancelShift')
                    : t('schedule.deleteShift')
                }
                hint={existingStatus === 'published' ? t('schedule.cancelShiftHint') : undefined}
                onPress={onRemove}
                fullWidth={false}
                testID="shift-form-remove"
              />
            ) : null}
          </Row>
        </Stack>
      }
    >
      {/*
        TURNO O DESCANSO, ARRIBA Y NO ESCONDIDO. Sin esto, marcar un día libre solo se
        podría hacer pegando una tabla: una función a la que únicamente se llega por un
        camino no existe para quien no conoce ese camino.
      */}
      {onSubmitRestDay === undefined ? null : (
        <SegmentedControl
          label={t('schedule.whatGoesHere')}
          value={modo}
          options={[
            { value: 'turno', label: t('schedule.aShift') },
            { value: 'descanso', label: t('schedule.restDay') },
          ]}
          onChange={setModo}
          testID="shift-form-mode"
        />
      )}

      <SelectField
        label={t('schedule.employee')}
        value={values.employeeId}
        options={employees}
        onChange={(employeeId) => setValues((current) => ({ ...current, employeeId }))}
        emptyLabel={t('team.noEmployeesForLocation')}
        testID="shift-employee"
      />
      {submitted && !employeeValid ? (
        <AppText variant="help" tone="danger" accessibilityRole="alert">
          {t('schedule.employeeRequired')}
        </AppText>
      ) : null}

      <SelectField
        label={t('schedule.date')}
        value={values.dateKey}
        options={dayOptions}
        onChange={(dateKey) => setValues((current) => ({ ...current, dateKey }))}
        testID="shift-date"
      />

      {esDescanso ? (
        <AppText variant="help" tone="subtle">
          {t('schedule.restDayExplainer')}
        </AppText>
      ) : null}

      {esDescanso ? null : (
        <>
          <SelectField
            label={t('schedule.jobRole')}
            value={values.jobRoleId}
            options={jobRoles}
            onChange={(jobRoleId) =>
              setValues((current) => ({
                ...current,
                jobRoleId: current.jobRoleId === jobRoleId ? null : jobRoleId,
              }))
            }
            emptyLabel={t('schedule.noJobRoles')}
            testID="shift-job-role"
          />

          <Row gap={spacing.md} align="flex-start">
            <Stack gap={spacing.xs} style={styles.half}>
              <FormField
                label={t('schedule.startsAt')}
                value={values.startTime}
                onChangeText={(startTime) => setValues((current) => ({ ...current, startTime }))}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                error={submitted && !startValid ? t('schedule.invalidTime') : undefined}
                testID="shift-start"
              />
            </Stack>
            <Stack gap={spacing.xs} style={styles.half}>
              <FormField
                label={t('schedule.endsAt')}
                value={values.endTime}
                onChangeText={(endTime) => setValues((current) => ({ ...current, endTime }))}
                placeholder="17:00"
                keyboardType="numbers-and-punctuation"
                error={submitted && !endValid ? t('schedule.invalidTime') : undefined}
                testID="shift-end"
              />
            </Stack>
          </Row>

          {tooLong ? (
            <InlineNotice
              tone="late"
              icon="alert-circle-outline"
              body={t('schedule.shiftTooLong', {
                hours: minutesToHHmm(duracion ?? 0),
              })}
              testID="shift-too-long"
            />
          ) : crossesMidnight ? (
            <InlineNotice
              tone="info"
              icon="moon-outline"
              title={t('schedule.crossesMidnight')}
              body={t('schedule.crossesMidnightHint')}
            />
          ) : null}

          <FormField
            label={t('schedule.plannedBreak')}
            value={values.breakMinutes}
            onChangeText={(breakValue) =>
              setValues((current) => ({ ...current, breakMinutes: breakValue }))
            }
            placeholder="60"
            keyboardType="numbers-and-punctuation"
            error={submitted && !breakValid ? t('schedule.invalidBreak') : undefined}
            testID="shift-break"
          />
          {/* Cómo lo va a guardar (8-oct): «1» era un minuto y nadie lo veía. Ahora, una hora. */}
          {breakMinutes !== null && breakMinutes > 0 && breakValid ? (
            <AppText variant="label" tone="primary" tabular testID="shift-break-read-as">
              {t('common.savedAs', { duration: textoDeDuracion(t, breakMinutes) })}
            </AppText>
          ) : null}

          <FormField
            label={t('schedule.employeeNote')}
            value={values.employeeNote}
            onChangeText={(employeeNote) => setValues((current) => ({ ...current, employeeNote }))}
            multiline
            testID="shift-employee-note"
          />

          <FormField
            label={t('schedule.managerNote')}
            value={values.managerNote}
            onChangeText={(managerNote) => setValues((current) => ({ ...current, managerNote }))}
            multiline
            testID="shift-manager-note"
          />
          {/*
            QUIÉN VE CADA NOTA, Y QUE NO HACE FALTA PUBLICARLAS (3-oct). Andree escribió un
            comentario en un turno publicado y pensó que tenía que volver a publicar: antes
            sí, porque guardar cualquier cosa lo volvía borrador. Ahora no, y se dice aquí.
          */}
          <AppText variant="help" tone="subtle" testID="shift-notes-help">
            {t('schedule.notesHelp')}
          </AppText>
        </>
      )}
    </AdminSheet>
  );
}

const styles = StyleSheet.create({
  half: { flex: 1 },
});
