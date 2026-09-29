import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import { currentLanguage } from '@/i18n';
import {
  completarConEnlace,
  correoRecordado,
  direccionActual,
  enviarEnlace,
  esEnlaceDeAcceso,
} from '@/lib/firebase/enlace-por-correo';
import { spacing } from '@/theme/tokens';

/**
 * «Entrar con tu correo», debajo de Google en la pantalla de acceso. El porqué y el cómo
 * están en `src/lib/firebase/enlace-por-correo.ts`.
 *
 * VA PLEGADO: un botón y nada más, hasta que se toca. La mayoría entra con Google, y un
 * formulario abierto debajo del botón de Google se leería como «hay que rellenar esto
 * también».
 *
 * Y SE HACE CARGO DE LA VUELTA. Al abrir el enlace se aterriza en esta misma pantalla con
 * el código en la dirección: si el correo está recordado en este navegador se entra solo;
 * si no —se abrió en otro dispositivo— se pide para confirmar.
 */

type Fase = 'cerrado' | 'escribiendo' | 'enviado' | 'completando' | 'confirmar';

/** Un correo con forma de correo. El servidor de Firebase dice el resto. */
const PARECE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function faseInicial(enlace: string | null): Fase {
  if (enlace === null) return 'cerrado';
  return correoRecordado() === null ? 'confirmar' : 'completando';
}

/** El mensaje para cada fallo que se puede dar, en palabras de quien está entrando. */
function claveDelFallo(error: unknown): string {
  const codigo = (error as { code?: string } | null)?.code ?? '';
  if (codigo === 'auth/invalid-action-code' || codigo === 'auth/expired-action-code') {
    return 'auth.emailLinkUsed';
  }
  if (codigo === 'auth/invalid-email' || codigo === 'auth/user-mismatch') {
    return 'auth.emailLinkWrongAddress';
  }
  if (codigo === 'auth/operation-not-allowed') return 'auth.emailNotEnabled';
  if (codigo === 'auth/quota-exceeded' || codigo === 'auth/too-many-requests') {
    return 'auth.emailTooMany';
  }
  return 'auth.emailFailed';
}

export function AccesoPorCorreo() {
  const { t } = useTranslation();
  // La dirección se lee UNA vez, al montar: completar el enlace la limpia.
  const [enlace] = useState(() => {
    const direccion = direccionActual();
    return direccion !== null && esEnlaceDeAcceso(direccion) ? direccion : null;
  });
  const [fase, setFase] = useState<Fase>(() => faseInicial(enlace));
  const [correo, setCorreo] = useState(() => correoRecordado() ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);

  const valido = PARECE_CORREO.test(correo.trim());

  const completar = async (direccion: string) => {
    if (enlace === null) return;
    setOcupado(true);
    setFallo(null);
    try {
      await completarConEnlace(direccion, enlace);
      // No se navega a mano: el cambio de sesión mueve la ruta, igual que con Google.
    } catch (error) {
      setFallo(t(claveDelFallo(error)));
      // Un enlace usado o caducado no se arregla escribiendo: se pide otro.
      setFase(
        (error as { code?: string } | null)?.code === 'auth/invalid-email'
          ? 'confirmar'
          : 'escribiendo',
      );
    } finally {
      setOcupado(false);
    }
  };

  /*
   * CON EL CORREO RECORDADO, LA VUELTA DEL ENLACE ENTRA SOLA. El efecto solo lanza la
   * llamada; el estado cambia cuando vuelve, no antes, que es lo que pide
   * `react-hooks/set-state-in-effect`. La fase ya arranca en «completando» sin efecto.
   */
  useEffect(() => {
    if (enlace === null) return;
    const recordado = correoRecordado();
    if (recordado === null) return;
    let vivo = true;
    completarConEnlace(recordado, enlace).catch((error: unknown) => {
      if (!vivo) return;
      setFallo(t(claveDelFallo(error)));
      setFase('escribiendo');
    });
    return () => {
      vivo = false;
    };
  }, [enlace, t]);

  const enviar = async () => {
    setIntentado(true);
    if (!valido) return;
    setOcupado(true);
    setFallo(null);
    try {
      await enviarEnlace(correo, currentLanguage());
      setFase('enviado');
    } catch (error) {
      setFallo(t(claveDelFallo(error)));
    } finally {
      setOcupado(false);
    }
  };

  const error =
    fallo === null ? null : (
      <AppText variant="help" tone="danger" accessibilityRole="alert" testID="sign-in-email-error">
        {fallo}
      </AppText>
    );

  if (fase === 'cerrado') {
    return (
      <SecondaryButton
        label={t('auth.emailOpen')}
        onPress={() => setFase('escribiendo')}
        testID="sign-in-email-open"
      />
    );
  }

  if (fase === 'completando') {
    return (
      <Stack gap={spacing.xs} testID="sign-in-email-completing">
        <AppText variant="bodyStrong">{t('auth.emailCompleting')}</AppText>
        {error}
      </Stack>
    );
  }

  if (fase === 'enviado') {
    return (
      <Stack gap={spacing.sm} testID="sign-in-email-sent">
        <AppText variant="bodyStrong" accessibilityRole="alert">
          {t('auth.emailSentTitle')}
        </AppText>
        <AppText variant="body" tone="muted">
          {t('auth.emailSentBody', { email: correo.trim().toLowerCase() })}
        </AppText>
        {error}
        <Row gap={spacing.sm} wrap>
          <GhostButton
            label={t('auth.emailResend')}
            onPress={() => void enviar()}
            loading={ocupado}
            fullWidth={false}
            testID="sign-in-email-resend"
          />
          <GhostButton
            label={t('auth.emailOther')}
            onPress={() => {
              setFase('escribiendo');
              setFallo(null);
            }}
            fullWidth={false}
            testID="sign-in-email-other"
          />
        </Row>
      </Stack>
    );
  }

  const confirmando = fase === 'confirmar';
  return (
    <Stack gap={spacing.sm} testID="sign-in-email-form">
      {confirmando ? (
        <Stack gap={spacing.xs}>
          <AppText variant="bodyStrong">{t('auth.emailConfirmTitle')}</AppText>
          <AppText variant="help" tone="subtle">
            {t('auth.emailConfirmBody')}
          </AppText>
        </Stack>
      ) : null}
      <FormField
        label={t('auth.emailLabel')}
        value={correo}
        onChangeText={setCorreo}
        placeholder={t('auth.emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        inputMode="email"
        onSubmitEditing={() => void (confirmando ? completar(correo) : enviar())}
        error={intentado && !valido ? t('auth.emailInvalid') : undefined}
        testID="sign-in-email-field"
      />
      {intentado && !valido ? (
        <AppText variant="help" tone="danger">
          {t('auth.emailInvalid')}
        </AppText>
      ) : null}
      {error}
      <PrimaryButton
        label={confirmando ? t('auth.emailConfirm') : t('auth.emailSend')}
        onPress={() => void (confirmando ? completar(correo) : enviar())}
        loading={ocupado}
        testID={confirmando ? 'sign-in-email-complete' : 'sign-in-email-send'}
      />
      {confirmando ? null : (
        <AppText variant="help" tone="subtle">
          {t('auth.emailHint')}
        </AppText>
      )}
    </Stack>
  );
}
