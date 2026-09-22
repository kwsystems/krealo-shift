import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';

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

/**
 * EN WEB, «CÁMARA LISTA» NO SIGNIFICA LISTA.
 *
 * `expo-camera` en el navegador avisa `onCameraReady` en cuanto consigue el stream,
 * antes de que el `<video>` haya recibido un solo fotograma, y `takePictureAsync` en
 * ese instante lanza `ERR_CAMERA_NOT_READY`. Medido con Playwright y una cámara falsa:
 * fallaba SIEMPRE, en menos de 1,5 s. Y en la web la foto es obligatoria (ver
 * `src/lib/kiosk/disponibilidad.ts`), así que nadie podía fichar desde un navegador.
 *
 * Se le vuelve a preguntar cada poco, con un tope. En iOS y Android el aviso sí llega
 * con la cámara lista, así que el primer intento vale y esto no se ejecuta.
 *
 * El tope (40 × 200 ms = 8 s) es más corto que el plazo de `app/kiosk/actions.tsx`
 * (12 s) a propósito: si se agota, el fallo lo declara este componente con su motivo,
 * y no el cronómetro de fuera, que solo sabe que «no llegó nada».
 */
const REINTENTO_MS = 200;
const INTENTOS_MAXIMOS = 40;

function laCamaraNoEstabaLista(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ERR_CAMERA_NOT_READY'
  );
}

const esperar = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms));

export function PhotoCapture({
  onResult,
  autoCapture = true,
}: {
  onResult: (result: PhotoResult) => void;
  autoCapture?: boolean;
}) {
  const styles = useEstilos();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [failed, setFailed] = useState(false);
  const captured = useRef(false);

  // Se pide el permiso al montar, que es cuando ya se explicó para qué sirve.
  useEffect(() => {
    if (permission === null) return;
    if (!permission.granted && permission.canAskAgain) {
      // Pedir el permiso puede rechazar. Sin `catch` era un rechazo sin capturar;
      // con el, `permission` se queda como estaba y la pantalla muestra su estado de
      // "sin permiso", que es lo correcto: no se concedio.
      void requestPermission().catch(() => undefined);
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (permission?.granted === false && !permission.canAskAgain) {
      onResult({ status: 'skipped', reason: 'permission_denied' });
    }
  }, [permission, onResult]);

  // Si la tarjeta se desmonta a media espera —la persona canceló—, el resultado ya
  // no tiene a quién avisar y se calla.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const tomarCuandoEsteLista = async () => {
    for (let intento = 1; ; intento += 1) {
      try {
        return await cameraRef.current?.takePictureAsync({
          // Comprimida de forma razonable: es evidencia de revisión, no una foto de
          // catálogo, y se sube desde la red de una tienda (§9.6, §23).
          quality: 0.5,
          skipProcessing: true,
          // Solo cuenta en web: JPEG en vez del PNG por defecto. Es lo que el servidor
          // guarda (`image/jpeg`) y pesa una fracción. En nativo se ignora.
          imageType: 'jpg',
        });
      } catch (error) {
        if (!laCamaraNoEstabaLista(error) || intento >= INTENTOS_MAXIMOS || !montado.current) {
          throw error;
        }
        await esperar(REINTENTO_MS);
      }
    }
  };

  const capture = async () => {
    if (captured.current || cameraRef.current === null) return;
    captured.current = true;

    try {
      const photo = await tomarCuandoEsteLista();
      if (!montado.current) return;

      if (photo?.uri === undefined) {
        setFailed(true);
        onResult({ status: 'skipped', reason: 'failed' });
        return;
      }
      onResult({ status: 'captured', uri: photo.uri });
    } catch {
      if (!montado.current) return;
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
  const { colors } = useTheme();
  const styles = useEstilos();
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

const useEstilos = estilosDelTema((colors) => ({
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
}));
