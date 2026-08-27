import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { borderWidth, colors, radii, sizes, spacing } from '@/theme/tokens';

/**
 * Foto opcional del fichaje (especificación §9.6).
 *
 * Las reglas que impone este componente, todas explícitas en la especificación:
 *   - está DESACTIVADA por defecto: solo se monta si la ubicación la activó;
 *   - NUNCA bloquea el fichaje. Si el permiso falta, la cámara falla o el
 *     dispositivo no tiene, el flujo sigue y se avisa. Un empleado no puede
 *     quedarse sin registrar su jornada porque una cámara no arrancó;
 *   - encuadre simple, no una galería;
 *   - no hay reconocimiento facial ni comparación de rostros: es evidencia visual
 *     para revisión manual, nada más.
 *
 * La foto se toma SOLO en el paso de confirmación, después de explicar su uso.
 */

export type PhotoResult =
  | { status: 'captured'; uri: string }
  | { status: 'skipped'; reason: 'permission_denied' | 'unavailable' | 'failed' };

export function PhotoCapture({
  onResult,
  autoCapture = true,
}: {
  onResult: (result: PhotoResult) => void;
  autoCapture?: boolean;
}) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [failed, setFailed] = useState(false);
  const captured = useRef(false);

  // Se pide el permiso al montar, que es cuando ya se explicó para qué sirve.
  useEffect(() => {
    if (permission === null) return;
    if (!permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (permission?.granted === false && !permission.canAskAgain) {
      onResult({ status: 'skipped', reason: 'permission_denied' });
    }
  }, [permission, onResult]);

  const capture = async () => {
    if (captured.current || cameraRef.current === null) return;
    captured.current = true;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        // Comprimida de forma razonable: es evidencia de revisión, no una foto de
        // catálogo, y se sube desde la red de una tienda (§9.6, §23).
        quality: 0.5,
        skipProcessing: true,
      });

      if (photo?.uri === undefined) {
        setFailed(true);
        onResult({ status: 'skipped', reason: 'failed' });
        return;
      }
      onResult({ status: 'captured', uri: photo.uri });
    } catch {
      // La cámara falló. El fichaje sigue: se avisa y se deja constancia.
      setFailed(true);
      onResult({ status: 'skipped', reason: 'failed' });
    }
  };

  if (permission === null) {
    return <PhotoFallback message={t('common.loading')} />;
  }

  if (!permission.granted) {
    return <PhotoFallback message={t('states.permissionDeniedBody')} />;
  }

  if (failed) {
    return <PhotoFallback message={t('states.errorBody')} />;
  }

  return (
    <Card>
      <Stack gap={spacing.sm}>
        <View style={styles.frame}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
            // La captura se dispara aquí, cuando la cámara avisa que está lista,
            // y no desde un efecto: un setState dentro de un efecto provoca
            // renders en cascada.
            onCameraReady={() => {
              if (autoCapture) void capture();
            }}
          />
        </View>
        <AppText variant="help" tone="subtle">
          {t('kiosk.photoNotice')}
        </AppText>
        {!autoCapture ? (
          <SecondaryButton label={t('common.ok')} onPress={() => void capture()} />
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * Lo que se ve cuando la cámara no está disponible. Deliberadamente NO es un
 * error bloqueante: el mensaje informa y el fichaje continúa.
 */
function PhotoFallback({ message }: { message: string }) {
  return (
    <Card>
      <Row gap={spacing.sm} align="flex-start">
        <Ionicons name="camera-outline" size={sizes.iconMobile} color={colors.ink500} />
        <AppText variant="help" tone="subtle" style={styles.flexOne}>
          {message}
        </AppText>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 220,
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  camera: { flex: 1 },
  flexOne: { flex: 1 },
});
