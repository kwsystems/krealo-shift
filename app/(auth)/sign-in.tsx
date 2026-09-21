import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { pressHandledByLink, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { LanguageSwitch } from '@/components/ui/language-switch';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { isDemoMode } from '@/lib/demo/config';
import { useGoogleSignIn } from '@/lib/firebase/auth';
import { authSource } from '@/lib/firebase/session';
import { kioskModeAvailable } from '@/lib/kiosk/disponibilidad';
import { useSessionStore } from '@/stores/session-store';
import { spacing } from '@/theme/tokens';

/**
 * Acceso administrativo (§8). Los empleados no entran por aquí: fichan con su PIN
 * en el iPad, y esta pantalla lo dice explícitamente para que nadie busque una
 * cuenta que no necesita.
 *
 * SE ENTRA CON GOOGLE Y YA NO HAY FORMULARIO, y con él se fueron tres cosas que
 * conviene no echar de menos por error: el campo de contraseña, la validación de su
 * longitud y el enlace de «olvidé mi contraseña». No hay contraseña nuestra que
 * olvidar —la cuenta es de Google y su recuperación también—, así que dejar el
 * enlace habría sido dejar un botón que no lleva a ningún sitio.
 *
 * Lo que SÍ se conservó, porque costó encontrarlo: el aviso de sesión caducada. Una
 * sesión que expira o que otro dispositivo revoca dejaba a la persona aquí sin una
 * palabra, y lo que se lee en una pantalla de acceso vacía es "hice algo mal".
 *
 * La opción de configurar el iPad como reloj está separada y visible (§6.1 paso 5).
 */

export default function SignInScreen() {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  /**
   * Por qué está aquí esta persona, si no vino por su propio pie.
   *
   * Se lee una vez al montar: el motivo se limpia al mostrarlo, así que un `useState`
   * inicial evita que desaparezca en el primer repintado.
   */
  const [endReason] = useState(() => useSessionStore.getState().endReason);
  useEffect(() => {
    if (endReason !== null) useSessionStore.getState().clearEndReason();
  }, [endReason]);

  const google = useGoogleSignIn();

  /**
   * El mensaje se DERIVA del estado, no se copia a otro estado desde un efecto.
   *
   * Copiarlo con `useEffect(() => setServerError(...))` funciona y es exactamente lo
   * que la regla `react-hooks/set-state-in-effect` prohíbe: provoca un render extra
   * por cada fallo y deja dos fuentes de verdad para una misma frase. Derivarlo no
   * necesita efecto ni sincronización.
   */
  const mensajeError = serverError ?? (google.error !== null ? t('auth.googleFailed') : null);

  /**
   * EL CUERPO VA EN try/finally, igual que la activación del kiosco y por el mismo
   * motivo: `setSubmitting(false)` estaba después del `await`, así que cualquier
   * excepción —red que rechaza raro, ventana que se cierra sola— dejaba el botón
   * girando para siempre, sin mensaje y sin forma de reintentar.
   *
   * No es hipotético: exactamente eso pasó en `app/kiosk/setup.tsx`, donde
   * `expo-application` lanzaba en web. Aquí el riesgo es el mismo y la cura también.
   */
  const entrar = async (accion: () => Promise<void>) => {
    setSubmitting(true);
    setServerError(null);
    try {
      await accion();
      // El éxito no navega a mano: el cambio de sesión mueve la fase y la ruta raíz
      // redirige según rol.
    } catch (error) {
      /**
       * Cerrar la ventana de Google NO es un error que haya que gritar. Es lo que
       * hace cualquiera que se arrepiente, y pintar «no se pudo iniciar sesión» en
       * rojo por eso convierte una decisión normal en un susto.
       */
      const codigo = (error as { code?: string } | null)?.code ?? '';
      if (codigo === 'auth/popup-closed-by-user' || codigo === 'auth/cancelled-popup-request') {
        return;
      }
      console.warn('[krealo-shift] Falló el inicio de sesión:', error);
      setServerError(t('auth.googleFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const signInDemo = authSource()?.signInDemo ?? null;

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
            {/*
              El botón se desactiva mientras la petición nativa se prepara. En web
              está listo desde el primer render; en iPad hay un instante en el que
              `expo-auth-session` todavía no tiene el descubrimiento de Google, y
              pulsar ahí no hacía nada, que se lee como una app rota.
            */}
            <PrimaryButton
              label={t('auth.signInWithGoogle')}
              onPress={() => void entrar(google.signIn)}
              loading={submitting}
              disabled={!google.ready}
              testID="sign-in-google"
            />

            {/*
              Falta el identificador de cliente OAuth de iOS: sin él, pulsar abriría
              un navegador que acaba en una página de error de Google que nadie sabe
              interpretar. Se dice aquí, en la pantalla, y no en la consola.
            */}
            {google.unavailableReason === 'missingIosClientId' ? (
              <AppText variant="help" tone="danger" testID="sign-in-google-unavailable">
                {t('auth.googleUnavailableNative')}
              </AppText>
            ) : null}

            {mensajeError !== null ? (
              <AppText variant="help" tone="danger" accessibilityRole="alert">
                {mensajeError}
              </AppText>
            ) : null}

            {/*
              ATAJO DE DEMOSTRACIÓN, y solo ahí: con la demostración apagada esto no
              existe en la pantalla.

              Va DEBAJO del botón de verdad y no encima, a propósito. La pantalla que
              hay que poder mirar y criticar es la real; esto es una puerta de servicio
              para no tener que pasar por Google cada vez, no la forma principal de
              entrar.
            */}
            {isDemoMode && signInDemo !== null ? (
              <Stack gap={spacing.xs}>
                <SecondaryButton
                  label={t('auth.signInAsAdmin')}
                  onPress={() => void entrar(signInDemo)}
                  testID="sign-in-demo"
                />
                <AppText variant="help" tone="subtle">
                  {t('auth.demoHint')}
                </AppText>
              </Stack>
            ) : null}

            <Row justify="flex-end" wrap>
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
