import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { AppText } from '@/components/ui/app-text';
import {
  GhostButton,
  PrimaryButton,
  pressHandledByLink,
  SecondaryButton,
} from '@/components/ui/buttons';
import { LanguageSwitch } from '@/components/ui/language-switch';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { sendPasswordReset } from '@/features/auth/password-reset';
import { isDemoMode } from '@/lib/demo/config';
import { DEMO_EMAIL } from '@/lib/demo/seed';
import { kioskModeAvailable } from '@/lib/kiosk/disponibilidad';
import { getSupabase } from '@/lib/supabase/client';
import { useSessionStore } from '@/stores/session-store';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';

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
  const styles = useEstilos();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  /**
   * Por qué está aquí esta persona, si no vino por su propio pie.
   *
   * Una sesión que caduca —o que otro dispositivo revoca con "cerrar sesión en todos
   * los dispositivos"— dejaba a la persona en este formulario vacío SIN UNA PALABRA. Lo
   * que se lee ahí es "hice algo mal" o "la app se rompió", y lo que hay que leer es
   * "vuelve a entrar". Los textos existían traducidos y nadie los mostraba.
   *
   * Se lee una vez al montar: el motivo se limpia al mostrarlo, así que un `useState`
   * inicial evita que desaparezca en el primer repintado.
   */
  const [endReason] = useState(() => useSessionStore.getState().endReason);
  useEffect(() => {
    if (endReason !== null) useSessionStore.getState().clearEndReason();
  }, [endReason]);

  const { control, handleSubmit, formState, getValues, setError, trigger } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  /**
   * Recuperación de contraseña (§8).
   *
   * ERA UN BOTÓN MUERTO: `onPress={() => undefined}`. Se veía, se pulsaba y no
   * pasaba nada.
   *
   * Se reutiliza el correo que ya está escrito arriba en vez de abrir otra pantalla
   * a pedirlo otra vez, y se valida SOLO ese campo: exigir también la contraseña
   * para recuperar la contraseña es absurdo, y es lo que haría `handleSubmit`.
   *
   * El aviso es el mismo exista o no la cuenta. Distinguirlos convertiría esta
   * pantalla en un comprobador de quién trabaja en la empresa, para cualquiera.
   */
  const onForgotPassword = async () => {
    setResetNotice(null);

    const emailValido = await trigger('email');
    if (!emailValido) return;

    setResetting(true);
    const resultado = await sendPasswordReset(getValues('email'));
    setResetting(false);

    if (resultado.ok) {
      setResetNotice(t('auth.resetSent'));
      return;
    }

    if (resultado.kind === 'rateLimited') {
      setError('email', { message: 'auth.resetRateLimited' });
      return;
    }
    setError('email', {
      message: resultado.kind === 'offline' ? 'errors.network' : 'errors.generic',
    });
  };

  /**
   * EL CUERPO VA EN try/finally, igual que la activación del kiosco y por el mismo
   * motivo: `setSubmitting(false)` estaba después del `await`, así que cualquier
   * excepción —red que rechaza raro, almacenamiento que falla— dejaba el botón
   * "Ingresar" girando para siempre, sin mensaje y sin forma de reintentar.
   *
   * No es hipotético: exactamente eso pasó en `app/kiosk/setup.tsx`, donde
   * `expo-application` lanzaba en web. Aquí el riesgo es el mismo y la cura también.
   */
  const entrar = async (email: string, password: string) => {
    const supabase = getSupabase();
    if (supabase === null) {
      setServerError(t('errors.generic'));
      return;
    }

    setSubmitting(true);
    setServerError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error !== null) {
        // Nunca mostramos el mensaje crudo de Supabase (§20): un "Invalid login
        // credentials" en inglés en medio de una app en español es un error técnico
        // filtrado a la cara del usuario.
        setServerError(t('auth.invalidCredentials'));
      }
      // El éxito no navega a mano: `onAuthStateChange` mueve la sesión y la ruta
      // raíz redirige según rol.
    } catch (error) {
      console.warn('[krealo-shift] Falló el inicio de sesión:', error);
      setServerError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (values: SignInValues) => {
    await entrar(values.email, values.password);
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

          {endReason === 'expired' ? (
            <Card testID="sign-in-session-expired">
              <AppText variant="bodyStrong" accessibilityRole="alert">
                {t('states.sessionExpiredTitle')}
              </AppText>
              <AppText variant="help" tone="subtle">
                {t('states.sessionExpiredBody')}
              </AppText>
            </Card>
          ) : null}

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

            {resetNotice !== null ? (
              <Stack gap={spacing.xs}>
                <AppText
                  variant="bodyStrong"
                  accessibilityRole="alert"
                  testID="sign-in-reset-notice"
                >
                  {resetNotice}
                </AppText>
                <AppText variant="help" tone="subtle">
                  {t('auth.resetSentHint')}
                </AppText>
              </Stack>
            ) : null}

            <PrimaryButton
              label={t('auth.signIn')}
              onPress={handleSubmit(onSubmit)}
              loading={submitting}
              disabled={formState.isSubmitting}
              testID="sign-in-submit"
            />

            {/*
              ATAJO DE DEMOSTRACIÓN, y solo ahí: con la demostración apagada esto no
              existe en la pantalla.

              Va DEBAJO del botón de verdad y no encima, a propósito. La pantalla que
              hay que poder mirar y criticar es la real; esto es una puerta de servicio
              para no tener que inventarse un correo cada vez, no la forma principal de
              entrar. Escribir cualquier correo y contraseña también funciona, y el
              aviso lo dice: sin él, quien lo intente no sabe si escribió mal o si está
              roto.
            */}
            {isDemoMode ? (
              <Stack gap={spacing.xs}>
                <SecondaryButton
                  label={t('auth.signInAsAdmin')}
                  onPress={() => {
                    void entrar(DEMO_EMAIL, 'demostracion');
                  }}
                  testID="sign-in-demo"
                />
                <AppText variant="help" tone="subtle" style={styles.centerText}>
                  {t('auth.demoHint')}
                </AppText>
              </Stack>
            ) : null}

            <Row justify="space-between" wrap>
              <GhostButton
                label={t('auth.forgotPassword')}
                onPress={() => void onForgotPassword()}
                loading={resetting}
                fullWidth={false}
                testID="sign-in-forgot-password"
              />
              {/*
                Aqui tambien, y no solo en Ajustes: Ajustes vive DETRAS del acceso,
                asi que alguien que no entiende esta pantalla no puede llegar a el
                para cambiar el idioma. Un selector de idioma inalcanzable sin
                entender el idioma actual no sirve para nada.
              */}
              <LanguageSwitch testID="sign-in-language-toggle" />
            </Row>
          </Card>

          {/*
            La tarjeta entera desaparece donde el modo kiosco no es posible.
            Ofrecer "configurar este dispositivo como reloj" en un navegador era
            mandar a alguien a una pantalla que solo sabe decir que no; y el aviso de
            que los empleados fichan con su PIN tampoco ayuda a quien no puede montar
            el reloj desde aquí. El porqué está en `src/lib/kiosk/disponibilidad.ts`.
          */}
          {kioskModeAvailable ? (
            <Card>
              <AppText variant="help" tone="subtle">
                {t('auth.employeeNoAccountNotice')}
              </AppText>
              <Link href="/kiosk/setup" asChild>
                <SecondaryButton
                  label={t('auth.setupKioskLink')}
                  onPress={pressHandledByLink}
                  testID="setup-kiosk-link"
                />
              </Link>
            </Card>
          ) : null}
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
  const { colors } = useTheme();
  const styles = useEstilos();
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

const useEstilos = estilosDelTema((colors) => ({
  field: { gap: spacing.xs },
  centerText: { textAlign: 'center' },
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
}));
