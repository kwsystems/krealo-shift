import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FormField } from '@app/(auth)/sign-in';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import {
  exchangeRecoveryCode,
  MIN_NEW_PASSWORD_LENGTH,
  updatePassword,
  type ResetErrorKind,
} from '@/features/auth/password-reset';
import { colors, spacing } from '@/theme/tokens';

/**
 * Contraseña nueva desde el enlace del correo (§8).
 *
 * VIVE FUERA DEL GRUPO `(auth)` A PROPÓSITO. Un enlace de recuperación crea una
 * sesión de verdad, así que la guarda de `app/(auth)/_layout.tsx` —que saca a quien
 * ya tiene sesión— echaría de aquí a la persona justo antes de dejarla escribir la
 * contraseña. El sitio correcto es fuera: a esta ruta no se llega navegando, se llega
 * desde el correo.
 *
 * El cliente usa `flowType: 'pkce'`, así que lo que trae el enlace es un `code` de un
 * solo uso. En web el cliente ya lo canjea al arrancar; en nativo se canjea aquí. Los
 * dos caminos acaban igual: con sesión de recuperación o con un enlace caducado.
 */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();

  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const code = typeof params.code === 'string' ? params.code : null;

  /**
   * Estado del canje del enlace.
   *
   * "El enlace no trae código" se DERIVA del enlace y no se calcula en un efecto: el
   * código no cambia mientras esta pantalla vive, así que ponerlo con `setState` en
   * un efecto sería una cascada de renders para saber algo que ya se sabía al montar.
   */
  const [exchange, setExchange] = useState<{ done: boolean; error: ResetErrorKind | null }>(
    () => ({ done: code === null, error: null }),
  );

  useEffect(() => {
    if (code === null) return;

    let vivo = true;
    void exchangeRecoveryCode(code).then((resultado) => {
      if (!vivo) return;
      setExchange({ done: true, error: resultado.ok ? null : resultado.kind });
    });

    return () => {
      vivo = false;
    };
  }, [code]);

  const linkError: ResetErrorKind | 'noCode' | null =
    code === null ? 'noCode' : exchange.error;

  const save = useCallback(async () => {
    setFormError(null);

    if (password.length < MIN_NEW_PASSWORD_LENGTH) {
      setFormError(t('auth.passwordTooShort', { count: MIN_NEW_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmation) {
      setFormError(t('auth.newPasswordMismatch'));
      return;
    }

    setSaving(true);
    const resultado = await updatePassword(password);
    setSaving(false);

    if (resultado.ok) {
      setSaved(true);
      return;
    }

    setFormError(
      resultado.kind === 'offline'
        ? t('errors.network')
        : resultado.kind === 'expiredLink'
          ? t('auth.resetLinkExpired')
          : t('errors.generic'),
    );
  }, [password, confirmation, t]);

  if (!exchange.done) {
    return (
      <AppScreen tone="kiosk" testID="reset-checking">
        <LoadingState label={t('auth.resetVerifying')} />
      </AppScreen>
    );
  }

  if (saved) {
    return (
      <AppScreen tone="kiosk" testID="reset-saved">
        <ResponsiveContainer width="form">
          <Stack gap={spacing.lg}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success600} />
            <AppText variant="section">{t('auth.newPasswordSaved')}</AppText>
            {/*
              Se vuelve a la raíz y NO al acceso: la sesión de recuperación ya es una
              sesión válida, así que la resolución de arranque lleva al panel sola. Ir
              al acceso pediría la contraseña que se acaba de escribir, para nada.
            */}
            <PrimaryButton label={t('common.done')} onPress={() => router.replace('/')} />
          </Stack>
        </ResponsiveContainer>
      </AppScreen>
    );
  }

  if (linkError !== null) {
    return (
      <AppScreen tone="kiosk" scroll testID="reset-link-error">
        <ResponsiveContainer width="form">
          <Stack gap={spacing.lg}>
            <AppText variant="title">{t('auth.resetTitle')}</AppText>
            <Card>
              <AppText variant="bodyStrong" tone="danger">
                {linkError === 'noCode' ? t('auth.resetNoCode') : t('auth.resetLinkExpired')}
              </AppText>
            </Card>
            <SecondaryButton
              label={t('common.back')}
              onPress={() => router.replace('/(auth)/sign-in')}
              testID="reset-back-to-sign-in"
            />
          </Stack>
        </ResponsiveContainer>
      </AppScreen>
    );
  }

  return (
    <AppScreen tone="kiosk" scroll testID="reset-form">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <AppText variant="title">{t('auth.newPasswordTitle')}</AppText>
          <Card>
            <Stack gap={spacing.base}>
              <FormField
                label={t('auth.newPassword')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                testID="reset-password"
              />
              <FormField
                label={t('auth.newPasswordConfirm')}
                value={confirmation}
                onChangeText={setConfirmation}
                error={formError ?? undefined}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                testID="reset-password-confirm"
              />
              <PrimaryButton
                label={t('auth.newPasswordSave')}
                onPress={() => void save()}
                loading={saving}
                testID="reset-save"
              />
            </Stack>
          </Card>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
