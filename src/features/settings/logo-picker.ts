import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { LOGO_MIME_TYPES, type LogoMimeType } from './logo';

/**
 * Elegir un archivo de imagen, en las dos superficies (§11.6).
 *
 * VIVE APARTE DE LA PANTALLA porque son dos caminos distintos y ninguno de los dos
 * es opcional:
 *
 *   * en iPad, `expo-image-picker`, que es lo que usa una persona en la tienda;
 *   * en web, un `<input type="file">`, porque la web es la superficie desde la que
 *     se revisa la app en Windows (§33) y un selector que solo funciona en nativo
 *     hace imposible probar esta pantalla ahí.
 *
 * `expo-image-picker` tiene implementación de navegador, pero devuelve un `blob:`
 * URI y no el archivo, y en el navegador el `fetch` de ese URI vuelve a costar una
 * copia entera de la imagen en memoria. El input nativo del navegador da el `File`
 * directo.
 */

export type PickedImage = {
  body: ArrayBuffer;
  contentType: LogoMimeType;
  bytes: number;
};

/** `cancelled` no es un error: la persona cerró el selector, y no hay nada que decir. */
export type PickResult =
  | { status: 'picked'; image: PickedImage }
  | { status: 'cancelled' }
  | { status: 'permissionDenied' }
  | { status: 'unsupportedType'; contentType: string };

function asLogoMimeType(value: string): LogoMimeType | null {
  const normalizado = value.toLowerCase();
  return (LOGO_MIME_TYPES as readonly string[]).includes(normalizado)
    ? (normalizado as LogoMimeType)
    : null;
}

/** Deriva el tipo MIME de un URI cuando el selector no lo informa. */
function mimeFromUri(uri: string): LogoMimeType | null {
  const limpio = uri.split('?')[0] ?? uri;
  const ext = limpio.slice(limpio.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return null;
}

async function pickWeb(): Promise<PickResult> {
  return new Promise<PickResult>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = LOGO_MIME_TYPES.join(',');

    // `cancel` no está en todos los navegadores; sin este respaldo, cerrar el
    // diálogo dejaría la promesa colgada para siempre y el botón girando.
    let resuelto = false;
    const terminar = (resultado: PickResult) => {
      if (resuelto) return;
      resuelto = true;
      resolve(resultado);
    };

    input.addEventListener('cancel', () => terminar({ status: 'cancelled' }));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) {
        terminar({ status: 'cancelled' });
        return;
      }
      const contentType = asLogoMimeType(file.type);
      if (contentType === null) {
        terminar({ status: 'unsupportedType', contentType: file.type });
        return;
      }
      void file.arrayBuffer().then((body) => {
        terminar({ status: 'picked', image: { body, contentType, bytes: file.size } });
      });
    });

    input.click();
  });
}

async function pickNative(): Promise<PickResult> {
  const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) return { status: 'permissionDenied' };

  const elegido = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Sin recorte forzado: un logotipo puede ser muy ancho o cuadrado, y forzar un
    // recorte cuadrado deformaría la mitad de los logotipos reales.
    allowsEditing: false,
    quality: 1,
    // El selector puede devolver el archivo ya en base64, pero para 1 MB eso son
    // 1,33 MB de cadena en memoria además del binario. Se lee con `fetch` del URI
    // local, que en nativo no sale del dispositivo.
    base64: false,
  });

  if (elegido.canceled) return { status: 'cancelled' };
  const asset = elegido.assets[0];
  if (asset === undefined) return { status: 'cancelled' };

  const contentType = asLogoMimeType(asset.mimeType ?? '') ?? mimeFromUri(asset.uri);
  if (contentType === null) {
    return { status: 'unsupportedType', contentType: asset.mimeType ?? asset.uri };
  }

  const respuesta = await fetch(asset.uri);
  const body = await respuesta.arrayBuffer();
  return { status: 'picked', image: { body, contentType, bytes: body.byteLength } };
}

export async function pickLogoImage(): Promise<PickResult> {
  return Platform.OS === 'web' ? pickWeb() : pickNative();
}
