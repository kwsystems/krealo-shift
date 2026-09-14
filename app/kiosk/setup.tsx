import { useState } from 'react';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { FormField } from '@app/(auth)/sign-in';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { activateKiosk } from '@/features/kiosk/api';
import { track } from '@/lib/analytics';
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

  /**
   * TODO EL CUERPO VA EN try/finally, y no es celo defensivo.
   *
   * La versión anterior ponía `setSubmitting(false)` a mitad del camino, así que
   * cualquier excepción antes de esa línea dejaba el botón girando PARA SIEMPRE: sin
   * mensaje, sin error visible y sin forma de salir salvo recargar la página. Pasó de
   * verdad —`expo-application` lanzando en web, ver `resolveInstallationId`— y la
   * pantalla no daba ninguna pista de qué había fallado.
   *
   * La causa concreta ya está arreglada, pero esto es lo que impide que la PRÓXIMA
   * excepción vuelva a colgar la pantalla: el `finally` devuelve el botón a su sitio
   * pase lo que pase, y el `catch` dice que algo falló en vez de callarse. Un botón
   * que se queda cargando es la peor forma de fallar: parece que sigue trabajando.
   */
  const submit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const installationId = await resolveInstallationId();
      const appVersion = Constants.expoConfig?.version ?? '1.0.0';

      const result = await activateKiosk({
        activationCode: code.trim(),
        installationId,
        displayName: deviceName.trim() === '' ? 'iPad' : deviceName.trim(),
        appVersion,
      });

      if (!result.ok) {
        setError(result.error.kind === 'offline' ? t('errors.network') : t('errors.generic'));
        return;
      }

      const { credential, deviceKey, ...binding } = result.data;
      await activate(binding, credential, deviceKey);
      // §31. Sin propiedades a propósito: cuántos iPads se activan y cuándo es la
      // pregunta; QUÉ iPad es de cada tienda ya está en la base, y no en analítica.
      track({ name: 'kiosk_activated' });

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
    } catch (error) {
      console.warn('[krealo-shift] Falló la activación del reloj:', error);
      setError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
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
 * Identificador estable de esta instalación: un UUID propio, generado la primera vez
 * y guardado. Nunca un identificador publicitario ni nada rastreable entre apps (§22).
 *
 * AQUÍ HABÍA UN FALLO QUE DEJABA LA ACTIVACIÓN COLGADA PARA SIEMPRE.
 *
 * Esto llamaba antes a `Application.getAndroidId?.()`, y el `?.()` daba una sensación
 * falsa de seguridad: solo protege si la propiedad NO EXISTE. En web sí existe, y al
 * llamarla LANZA —«expo-application.androidId is not available on web»—. La excepción
 * subía sin que nadie la capturara, `setSubmitting(false)` no llegaba a ejecutarse y
 * el botón «Activar reloj» se quedaba girando indefinidamente. Sin mensaje, sin error
 * en pantalla, sin forma de salir salvo recargar.
 *
 * Y el comentario anterior decía dos cosas falsas: que en iOS se usaba «el id de
 * instalación del sistema» —`getAndroidId` es de Android, no de iOS— y que si no
 * estaba disponible se generaba un UUID, que es justo lo que no pasaba.
 *
 * La llamada nativa se quita entera en vez de envolverla en un try/catch: no aportaba
 * nada. En iOS no aplica, Android no es objetivo, y el UUID guardado ya es estable
 * para lo único que hace falta —que el servidor reconozca este dispositivo entre
 * activaciones—. Menos código y funciona en las tres plataformas.
 *
 * Se encontró abriendo la pantalla y PULSANDO EL BOTÓN. El chequeo de render la daba
 * por buena, porque la pantalla se pinta perfecta.
 */
async function resolveInstallationId(): Promise<string> {
  const stored = await secureStorage.get(SECURE_KEYS.kioskInstallationId);
  if (stored !== null) return stored;

  const id = Crypto.randomUUID();
  await secureStorage.set(SECURE_KEYS.kioskInstallationId, id);
  return id;
}
