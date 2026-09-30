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
  correosOcupados,
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
  /**
   * Correos que ya tiene OTRA ficha, en minúsculas, con el nombre de quién. Desde el 30-sep
   * el correo de la ficha es con lo que cada vendedor entra a ver su horario, y un correo
   * en dos fichas no dice cuál de las dos es quien entra: el servidor no liga ninguna. Se
   * avisa aquí, al escribirlo, y no el día que la persona no pueda entrar.
   */
  correosOcupados?: ReadonlyMap<string, string>;
  onSubmit: (draft: EmployeeDraft) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<EmployeeFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);

  const nameValid = values.fullName.trim().length > 1;
  const emailValid = values.email.trim() === '' || EMAIL_PATTERN.test(values.email.trim());
  const duenoDelCorreo = correosOcupados?.get(values.email.trim().toLowerCase()) ?? null;
  const locationsValid = values.locationIds.length > 0;
  const canSubmit = nameValid && emailValid && duenoDelCorreo === null && locationsValid;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!canSubmit) return;

    onSubmit({
      fullName: values.fullName.trim(),
      preferredName: values.preferredName.trim() === '' ? null : values.preferredName.trim(),
      employeeNumber: values.employeeNumber.trim() === '' ? null : values.employeeNumber.trim(),
      // En minúsculas: es con lo que la persona entra, y la búsqueda del servidor es exacta.
      email: values.email.trim() === '' ? null : values.email.trim().toLowerCase(),
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

      {/*
        CADA CAMPO DICE PARA QUÉ SIRVE (30-sep). Andree, creando a su primera empleada:
        «¿qué es número de empleado?». Tenía la etiqueta a secas, sin decir que es opcional
        ni para qué: un campo que hay que adivinar es diseño que falta. Los que se explican
        solos —el nombre completo— no llevan línea.
      */}
      <Stack gap={spacing.xs}>
        <FormField
          label={t('team.preferredName')}
          value={values.preferredName}
          onChangeText={(preferredName) => setValues((current) => ({ ...current, preferredName }))}
          testID="employee-preferred-name"
        />
        <AppText variant="help" tone="subtle">
          {t('team.preferredNameHint')}
        </AppText>
      </Stack>

      <Stack gap={spacing.xs}>
        <FormField
          label={t('team.employeeNumber')}
          value={values.employeeNumber}
          onChangeText={(employeeNumber) =>
            setValues((current) => ({ ...current, employeeNumber }))
          }
          testID="employee-number"
        />
        <AppText variant="help" tone="subtle" testID="employee-number-hint">
          {t('team.employeeNumberHint')}
        </AppText>
      </Stack>

      <Stack gap={spacing.xs}>
        <FormField
          label={t('team.emailOptional')}
          value={values.email}
          onChangeText={(email) => setValues((current) => ({ ...current, email }))}
          keyboardType="email-address"
          autoCapitalize="none"
          error={
            submitted && !emailValid
              ? t('auth.emailInvalid')
              : duenoDelCorreo !== null
                ? t('team.emailTaken', { name: duenoDelCorreo })
                : undefined
          }
          testID="employee-email"
        />
        {duenoDelCorreo === null ? null : (
          <AppText variant="help" tone="danger" testID="employee-email-taken">
            {t('team.emailTaken', { name: duenoDelCorreo })}
          </AppText>
        )}
        <AppText variant="help" tone="subtle">
          {t('team.emailOptionalHint')}
        </AppText>
      </Stack>

      <Stack gap={spacing.xs}>
        <MultiSelectField
          label={t('team.locations')}
          values={values.locationIds}
          options={locations}
          onToggle={(value) => toggle('locationIds', value)}
          emptyLabel={t('settings.noLocations')}
          testID="employee-locations"
        />
        <AppText variant="help" tone="subtle">
          {t('team.locationsHint')}
        </AppText>
        {submitted && !locationsValid ? (
          <AppText variant="help" tone="danger" accessibilityRole="alert">
            {t('team.locationRequired')}
          </AppText>
        ) : null}
      </Stack>

      <Stack gap={spacing.xs}>
        <MultiSelectField
          label={t('team.jobRoles')}
          values={values.jobRoleIds}
          options={jobRoles}
          onToggle={(value) => toggle('jobRoleIds', value)}
          emptyLabel={t('schedule.noJobRoles')}
          testID="employee-job-roles"
        />
        <AppText variant="help" tone="subtle">
          {t('team.jobRolesHint')}
        </AppText>
      </Stack>

      <InlineNotice
        tone="info"
        icon="key-outline"
        title={t('team.pinAfterCreateTitle')}
        body={t('team.pinAfterCreateBody')}
      />
    </AdminSheet>
  );
}
