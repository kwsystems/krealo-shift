import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EmployeeDraft } from './api';
import { FormField } from '@/components/ui/form-field';
import {
  AdminSheet,
  InlineNotice,
  MultiSelectField,
  type Option,
} from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { Stack } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/**
 * Alta y edición de empleado (§11.2).
 *
 * El correo es opcional a propósito y la pantalla lo dice: un empleado de tienda
 * ficha con su PIN en el iPad y no necesita cuenta ni correo. Pedirlo como
 * obligatorio dejaría fuera a la mitad del personal.
 */

export type EmployeeFormValues = {
  fullName: string;
  preferredName: string;
  employeeNumber: string;
  email: string;
  locationIds: string[];
  jobRoleIds: string[];
};

export function emptyEmployeeValues(locationIds: string[]): EmployeeFormValues {
  return {
    fullName: '',
    preferredName: '',
    employeeNumber: '',
    email: '',
    locationIds,
    jobRoleIds: [],
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmployeeFormSheet({
  title,
  initial,
  locations,
  jobRoles,
  saving,
  saveError,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: EmployeeFormValues;
  locations: Option<string>[];
  jobRoles: Option<string>[];
  saving: boolean;
  /**
   * Lo que fallo al guardar, si fallo.
   *
   * NO EXISTIA, Y ESA AUSENCIA ES EL FALLO QUE MAS COSTO ENTENDER. La hoja solo sabia
   * enseñar el giro de «guardando»: cuando el guardado reventaba —y reventaba SIEMPRE,
   * por una consulta que las reglas denegaban— la hoja se quedaba exactamente igual que
   * antes de pulsar. «Le doy guardar y no pasa nada» no era una exageracion: era la
   * descripcion literal, y detras habia un empleado a medias por cada intento.
   *
   * Un guardado que falla en silencio es peor que uno que falla ruidosamente: invita a
   * volver a pulsar, y cada pulsacion deja otro huerfano.
   */
  saveError?: unknown;
  onSubmit: (draft: EmployeeDraft) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<EmployeeFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);

  const nameValid = values.fullName.trim().length > 1;
  const emailValid = values.email.trim() === '' || EMAIL_PATTERN.test(values.email.trim());
  const locationsValid = values.locationIds.length > 0;
  const canSubmit = nameValid && emailValid && locationsValid;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!canSubmit) return;

    onSubmit({
      fullName: values.fullName.trim(),
      preferredName: values.preferredName.trim() === '' ? null : values.preferredName.trim(),
      employeeNumber: values.employeeNumber.trim() === '' ? null : values.employeeNumber.trim(),
      email: values.email.trim() === '' ? null : values.email.trim(),
      locationIds: values.locationIds,
      jobRoleIds: values.jobRoleIds,
    });
  };

  const toggle = (key: 'locationIds' | 'jobRoleIds', value: string) => {
    setValues((current) => {
      const list = current[key];
      return {
        ...current,
        [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  };

  return (
    <AdminSheet
      visible
      title={title}
      onClose={onClose}
      testID="employee-form-sheet"
      footer={
        <Stack gap={spacing.sm}>
          {saveError === null || saveError === undefined ? null : (
            <InlineNotice
              tone="late"
              icon="warning-outline"
              title={t('team.saveFailed')}
              body={saveError instanceof Error ? saveError.message : undefined}
              testID="employee-form-error"
            />
          )}
          <PrimaryButton
            label={t('common.save')}
            onPress={handleSubmit}
            loading={saving}
            disabled={submitted && !canSubmit}
            testID="employee-form-save"
          />
        </Stack>
      }
    >
      <FormField
        label={t('team.fullName')}
        value={values.fullName}
        onChangeText={(fullName) => setValues((current) => ({ ...current, fullName }))}
        error={submitted && !nameValid ? t('team.fullNameRequired') : undefined}
        testID="employee-full-name"
      />

      <FormField
        label={t('team.preferredName')}
        value={values.preferredName}
        onChangeText={(preferredName) => setValues((current) => ({ ...current, preferredName }))}
        testID="employee-preferred-name"
      />

      <FormField
        label={t('team.employeeNumber')}
        value={values.employeeNumber}
        onChangeText={(employeeNumber) => setValues((current) => ({ ...current, employeeNumber }))}
        testID="employee-number"
      />

      <Stack gap={spacing.xs}>
        <FormField
          label={t('team.emailOptional')}
          value={values.email}
          onChangeText={(email) => setValues((current) => ({ ...current, email }))}
          keyboardType="email-address"
          autoCapitalize="none"
          error={submitted && !emailValid ? t('auth.emailInvalid') : undefined}
          testID="employee-email"
        />
        <AppText variant="help" tone="subtle">
          {t('team.emailOptionalHint')}
        </AppText>
      </Stack>

      <MultiSelectField
        label={t('team.locations')}
        values={values.locationIds}
        options={locations}
        onToggle={(value) => toggle('locationIds', value)}
        emptyLabel={t('settings.noLocations')}
        testID="employee-locations"
      />
      {submitted && !locationsValid ? (
        <AppText variant="help" tone="danger" accessibilityRole="alert">
          {t('team.locationRequired')}
        </AppText>
      ) : null}

      <MultiSelectField
        label={t('team.jobRoles')}
        values={values.jobRoleIds}
        options={jobRoles}
        onToggle={(value) => toggle('jobRoleIds', value)}
        emptyLabel={t('schedule.noJobRoles')}
        testID="employee-job-roles"
      />

      <InlineNotice
        tone="info"
        icon="key-outline"
        title={t('team.pinAfterCreateTitle')}
        body={t('team.pinAfterCreateBody')}
      />
    </AdminSheet>
  );
}
