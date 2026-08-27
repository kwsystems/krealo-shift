import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ShiftInput } from './api';
import { isValidLocalTime, localTimeToMinutes, type DateKey } from './week';
import { formatDateKeyShort } from './week';
import { FormField } from '@app/(auth)/sign-in';
import { AdminSheet, InlineNotice, SelectField, type Option } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';

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
  onSubmit: (input: ShiftInput) => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
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
  onSubmit,
  onDuplicate,
  onRemove,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ShiftFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);

  const startValid = isValidLocalTime(values.startTime);
  const endValid = isValidLocalTime(values.endTime);
  const breakMinutes = Number(values.breakMinutes.replace(/[^0-9]/g, ''));
  const breakValid = Number.isFinite(breakMinutes) && breakMinutes >= 0;
  const employeeValid = values.employeeId !== null;

  const startMinutes = localTimeToMinutes(values.startTime);
  const endMinutes = localTimeToMinutes(values.endTime);
  const crossesMidnight =
    startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;

  const canSubmit = startValid && endValid && breakValid && employeeValid;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!canSubmit || values.employeeId === null) return;

    onSubmit({
      employeeId: values.employeeId,
      jobRoleId: values.jobRoleId,
      dateKey: values.dateKey,
      startTime: values.startTime.trim(),
      endTime: values.endTime.trim(),
      plannedUnpaidBreakMinutes: breakMinutes,
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
          <PrimaryButton
            label={t('schedule.saveDraft')}
            hint={t('schedule.saveDraftHint')}
            onPress={handleSubmit}
            loading={saving}
            disabled={submitted && !canSubmit}
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

      <SelectField
        label={t('schedule.date')}
        value={values.dateKey}
        options={dayOptions}
        onChange={(dateKey) => setValues((current) => ({ ...current, dateKey }))}
        testID="shift-date"
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

      {crossesMidnight ? (
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
        keyboardType="number-pad"
        error={submitted && !breakValid ? t('schedule.invalidBreak') : undefined}
        testID="shift-break"
      />

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
    </AdminSheet>
  );
}

const styles = StyleSheet.create({
  half: { flex: 1 },
});
