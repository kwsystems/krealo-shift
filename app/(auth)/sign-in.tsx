import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { getSupabase } from '@/lib/supabase/client';
import { usePreferencesStore } from '@/stores/preferences-store';
import { borderWidth, colors, radii, sizes, spacing } from '@/theme/tokens';

/**
 * Acceso administrativo (§8). Los empleados no entran por aquí: fichan con su PIN
 * en el iPad, y esta pantalla lo dice explícitamente para que nadie busque una
 * cuenta que no necesita.
 *
 * La opción de configurar el iPad como reloj está separada y visible (§6.1 paso 5).
 */

const MIN_PASSWORD_LENGTH = 8;

const signInSchema = z.object({
  email: z.string().min(1, 'auth.emailRequired').email('auth.emailInvalid'),
  password: z.string().min(1, 'auth.passwordRequired'),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function SignInScreen() {
  const { t } = useTranslation();
  const toggleLanguage = usePreferencesStore((s) => s.toggleLanguage);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: SignInValues) => {
    const supabase = getSupabase();
    if (supabase === null) {
      setServerError(t('errors.generic'));
      return;
    }

    setSubmitting(true);
    setServerError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    });

    setSubmitting(false);

    if (error !== null) {
      // Nunca mostramos el mensaje crudo de Supabase (§20): un "Invalid login
      // credentials" en inglés en medio de una app en español es un error técnico
      // filtrado a la cara del usuario.
      setServerError(t('auth.invalidCredentials'));
    }
    // El éxito no navega a mano: `onAuthStateChange` mueve la sesión y la ruta
    // raíz redirige según rol.
  };

  return (
    <AppScreen tone="kiosk" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.xl}>
          <Stack gap={spacing.xs}>
            <AppText variant="title">{t('auth.signInTitle')}</AppText>
            <AppText variant="help" tone="subtle">
              {t('auth.signInSubtitle')}
            </AppText>
          </Stack>

          <Card>
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <FormField
                  label={t('auth.email')}
                  placeholder={t('auth.emailPlaceholder')}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message ? t(fieldState.error.message) : undefined}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  testID="sign-in-email"
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <FormField
                  label={t('auth.password')}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={
                    fieldState.error?.message
                      ? t(fieldState.error.message, { count: MIN_PASSWORD_LENGTH })
                      : undefined
                  }
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  testID="sign-in-password"
                />
              )}
            />

            {serverError !== null ? (
              <AppText variant="help" tone="danger" accessibilityRole="alert">
                {serverError}
              </AppText>
            ) : null}

            <PrimaryButton
              label={t('auth.signIn')}
              onPress={handleSubmit(onSubmit)}
              loading={submitting}
              disabled={formState.isSubmitting}
              testID="sign-in-submit"
            />

            <Row justify="space-between" wrap>
              <GhostButton
                label={t('auth.forgotPassword')}
                onPress={() => undefined}
                fullWidth={false}
              />
              <GhostButton
                label={t('common.language')}
                onPress={() => void toggleLanguage()}
                fullWidth={false}
                testID="sign-in-language-toggle"
              />
            </Row>
          </Card>

          <Card>
            <AppText variant="help" tone="subtle">
              {t('auth.employeeNoAccountNotice')}
            </AppText>
            <Link href="/kiosk/setup" asChild>
              <SecondaryButton
                label={t('auth.setupKioskLink')}
                onPress={() => undefined}
                testID="setup-kiosk-link"
              />
            </Link>
          </Card>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

/** Campo de formulario accesible: etiqueta visible, error asociado y foco claro (§21). */
export function FormField({
  label,
  error,
  testID,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      <TextInput
        {...inputProps}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={error}
        placeholderTextColor={colors.ink500}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused ? styles.inputFocused : null,
          error !== undefined ? styles.inputError : null,
        ]}
      />
      {error !== undefined ? (
        <AppText variant="help" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    minHeight: sizes.touchTargetPreferred,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.ink900,
  },
  // El foco visible no se quita nunca (§21).
  inputFocused: { borderColor: colors.primary500, borderWidth: borderWidth.focus },
  inputError: { borderColor: colors.danger600 },
});
