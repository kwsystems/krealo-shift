import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';

import { pickLogoImage } from './logo-picker';
import {
  LOGO_MAX_BYTES,
  logoPublicUrl,
  removeOrganizationLogo,
  uploadOrganizationLogo,
  validateLogo,
} from './logo';
import { InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { spacing, radii, colors } from '@/theme/tokens';

/**
 * Subir, reemplazar y quitar el logotipo de la organización (§11.6).
 *
 * La vista previa es lo que hace usable esto: sin ella, quien acaba de subir un
 * archivo no sabe si subió el correcto, y el logotipo se ve por primera vez en el
 * iPad de la tienda, que es el peor sitio para descubrir que era el equivocado.
 *
 * Los mensajes de rechazo dicen CUÁL de las dos reglas falló y con qué número: "la
 * imagen pesa 4,2 MB y el máximo es 1 MB" se puede actuar, "no se pudo subir" no.
 */

type Estado =
  | { fase: 'reposo' }
  | { fase: 'trabajando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'listo' };

const PREVIEW = 96;

export function OrganizationLogoField({
  organizationId,
  logoPath,
  canEdit,
  onChanged,
}: {
  organizationId: string;
  logoPath: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [estado, setEstado] = useState<Estado>({ fase: 'reposo' });

  const url = logoPublicUrl(logoPath);

  const elegirYSubir = async () => {
    setEstado({ fase: 'trabajando' });
    try {
      const elegido = await pickLogoImage();

      if (elegido.status === 'cancelled') {
        // Cerrar el selector no es un error y no deja nada en pantalla.
        setEstado({ fase: 'reposo' });
        return;
      }
      if (elegido.status === 'permissionDenied') {
        setEstado({ fase: 'error', mensaje: t('settings.logoPermissionDenied') });
        return;
      }
      if (elegido.status === 'unsupportedType') {
        setEstado({ fase: 'error', mensaje: t('settings.logoUnsupportedType') });
        return;
      }

      const rechazo = validateLogo({
        bytes: elegido.image.bytes,
        contentType: elegido.image.contentType,
      });
      if (rechazo !== null) {
        setEstado({
          fase: 'error',
          mensaje:
            rechazo.reason === 'tooLarge'
              ? t('settings.logoTooLarge', {
                  size: formatMegabytes(rechazo.bytes),
                  max: formatMegabytes(LOGO_MAX_BYTES),
                })
              : t('settings.logoUnsupportedType'),
        });
        return;
      }

      await uploadOrganizationLogo({
        organizationId,
        body: elegido.image.body,
        contentType: elegido.image.contentType,
        previousPath: logoPath,
      });
      setEstado({ fase: 'listo' });
      onChanged();
    } catch {
      // El mensaje del error de Storage no se muestra tal cual: puede traer detalles
      // internos del bucket y no le dice nada a quien está mirando la pantalla.
      setEstado({ fase: 'error', mensaje: t('settings.logoUploadFailed') });
    }
  };

  const quitar = async () => {
    if (logoPath === null) return;
    setEstado({ fase: 'trabajando' });
    try {
      await removeOrganizationLogo({ organizationId, logoPath });
      setEstado({ fase: 'reposo' });
      onChanged();
    } catch {
      setEstado({ fase: 'error', mensaje: t('settings.logoRemoveFailed') });
    }
  };

  return (
    <Stack gap={spacing.sm}>
      <AppText variant="bodyStrong">{t('settings.orgLogo')}</AppText>

      <Row gap={spacing.base} align="center">
        {url === null ? (
          // Hueco con el tamaño final, no ausencia: así la tarjeta no salta de altura
          // al subir la primera imagen.
          <View
            testID="org-logo-empty"
            style={{
              width: PREVIEW,
              height: PREVIEW,
              borderRadius: radii.card,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.canvas,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="help" tone="subtle">
              {t('settings.logoNone')}
            </AppText>
          </View>
        ) : (
          <Image
            testID="org-logo-preview"
            source={{ uri: url }}
            // `contain` y no `cover`: un logotipo recortado es un logotipo estropeado.
            resizeMode="contain"
            accessibilityLabel={t('settings.orgLogo')}
            style={{
              width: PREVIEW,
              height: PREVIEW,
              borderRadius: radii.card,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
          />
        )}

        <Stack gap={spacing.sm} style={{ flex: 1 }}>
          <SecondaryButton
            label={logoPath === null ? t('settings.logoUpload') : t('settings.logoReplace')}
            onPress={() => void elegirYSubir()}
            disabled={!canEdit}
            loading={estado.fase === 'trabajando'}
            testID="org-logo-pick"
          />
          {logoPath !== null ? (
            <DangerButton
              label={t('settings.logoRemove')}
              onPress={() => void quitar()}
              disabled={!canEdit}
              fullWidth={false}
              testID="org-logo-remove"
            />
          ) : null}
        </Stack>
      </Row>

      <AppText variant="help" tone="subtle">
        {t('settings.logoHint')}
      </AppText>

      {estado.fase === 'error' ? (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          body={estado.mensaje}
          testID="org-logo-error"
        />
      ) : null}
      {estado.fase === 'listo' ? (
        <InlineNotice
          tone="working"
          icon="checkmark-circle"
          body={t('settings.logoSaved')}
          testID="org-logo-saved"
        />
      ) : null}
    </Stack>
  );
}

/** "1 MB", "4,2 MB". Con una decimal solo cuando aporta. */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1_048_576;
  const redondeado = Math.round(mb * 10) / 10;
  return `${Number.isInteger(redondeado) ? redondeado : redondeado.toString().replace('.', ',')} MB`;
}
