import { useState } from 'react';
import { router } from 'expo-router';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { FormField } from '@app/(auth)/sign-in';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { activateKiosk } from '@/features/kiosk/api';
import { refreshOfflinePackage } from '@/lib/offline/sync';
import { SECURE_KEYS, secureStorage } from '@/lib/security/secure-storage';
import { useKioskStore } from '@/stores/kiosk-store';
import { spacing } from '@/theme/tokens';

/**
 * Activación del kiosco con código temporal (§8).
 *
 * Tras activar, el backend entrega una credencial limitada al dispositivo y a UNA
 * ubicación. Nunca se reutiliza una sesión de administrador como credencial
 * permanente del kiosco.
 *
 * El identificador de instalación se genera una vez y se guarda en SecureStore: es
 * lo que permite revocar este iPad concreto sin tocar los demás.
 */
export default function KioskSetupScreen() {
  const { t } = useTranslation();
  const activate = useKioskStore((s) => s.activate);

  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    const installationId = await resolveInstallationId();
    const appVersion = Constants.expoConfig?.version ?? '1.0.0';

    const result = await activateKiosk({
      activationCode: code.trim(),
      installationId,
      displayName: deviceName.trim() === '' ? 'iPad' : deviceName.trim(),
      appVersion,
    });

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error.kind === 'offline' ? t('errors.network') : t('errors.generic'));
      return;
    }

    const { credential, deviceKey, ...binding } = result.data;
    await activate(binding, credential, deviceKey);

    // Se baja el paquete offline ANTES de entrar al reloj: si el iPad se queda sin
    // red justo despues de activarse, sin esto no podria validar ningun PIN (§9.7).
    //
    // SE USA `refreshOfflinePackage` Y NO SE REPITE AQUI EL GUARDADO, que es lo que
    // habia antes. Esa duplicacion es lo que produjo el fallo: la version de aqui
    // guardaba equipo, turnos, politicas y verificadores, y la del refresco
    // periodico solo los verificadores. Con dos copias, arreglar una no arregla la
    // otra y nadie nota la diferencia mientras haya red.
    await refreshOfflinePackage();

    router.replace('/kiosk');
  };

  return (
    <AppScreen tone="kiosk" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <Stack gap={spacing.xs}>
            <AppText variant="title">{t('kiosk.setupTitle')}</AppText>
            <AppText variant="help" tone="subtle">
              {t('kiosk.setupCodeHint')}
            </AppText>
          </Stack>

          <Card>
            <FormField
              label={t('kiosk.setupCodeLabel')}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              testID="kiosk-setup-code"
            />
            <FormField
              label={t('kiosk.setupDeviceName')}
              value={deviceName}
              onChangeText={setDeviceName}
              testID="kiosk-setup-name"
            />

            {error !== null ? (
              <AppText variant="help" tone="danger" accessibilityRole="alert">
                {error}
              </AppText>
            ) : null}

            <PrimaryButton
              label={t('kiosk.setupActivate')}
              onPress={() => void submit()}
              loading={submitting}
              disabled={code.trim().length === 0}
              testID="kiosk-setup-submit"
            />
            <SecondaryButton label={t('common.back')} onPress={() => router.back()} />
          </Card>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

/**
 * Identificador estable de esta instalación. En iOS usamos el id de instalación
 * del sistema; si no está disponible generamos un UUID propio y lo guardamos.
 * Nunca se usa un identificador publicitario ni nada rastreable entre apps (§22).
 */
async function resolveInstallationId(): Promise<string> {
  const stored = await secureStorage.get(SECURE_KEYS.kioskInstallationId);
  if (stored !== null) return stored;

  const native = Application.getAndroidId?.() ?? null;
  const id = native ?? Crypto.randomUUID();
  await secureStorage.set(SECURE_KEYS.kioskInstallationId, id);
  return id;
}
