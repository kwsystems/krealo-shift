import { execute, requireClient, toAdminError } from '@/hooks/use-admin-query';
import { getDataClient } from '@/lib/firebase/query';
import { RPC, TABLES } from '@/lib/firebase/tables';

/**
 * Logotipo de la organización (§11.6).
 *
 * YA NO SUBE DIRECTO A STORAGE, y el texto que había aquí es la mejor explicación de
 * por qué. Decía:
 *
 *   «el logotipo lo sube el PANEL, que sí tiene sesión, y las políticas de
 *   20260827001200_organization_logo.sql ya limitan la escritura a owner o admin.
 *   Una función intermedia no añadiría ninguna barrera; solo un salto más donde
 *   equivocarse. La barrera real, como siempre en este proyecto, es la política.»
 *
 * ERA VERDAD, EN SUPABASE. Esa política de Postgres funcionaba. Al migrar a Firebase
 * se tradujo a `storage.rules` así:
 *
 *     exists(/databases/(default)/documents/organization_memberships/$(orgId + '_' + uid))
 *
 * y las reglas de Firebase Storage NO TIENEN `get()` ni `exists()`: son funciones de
 * las reglas de Firestore, y Storage no puede consultar Firestore. El despliegue
 * aceptó la regla con dos advertencias «Invalid function name» que nadie leyó, y en
 * ejecución una función inexistente hace reventar la condición. Reventar deniega, así
 * que subir el logo devolvía `storage/unauthorized` y NUNCA funcionó desde la
 * migración. Lo descubrió Andree el 2026-09-28 al intentar poner el logo de su tienda.
 *
 * LA LECCIÓN NO ES «revisa las reglas»: es que un razonamiento correcto puede
 * quedarse falso cuando cambia la plataforma debajo, y nadie vuelve a leerlo porque
 * suena bien. El comentario seguía siendo convincente un mes después de dejar de ser
 * cierto.
 *
 * Ahora la comprobación pasa donde SE PUEDE hacer: `setOrganizationLogo`, una Cloud
 * Function con sesión, Firestore y rol a mano. O sea, el mismo patrón que la foto de
 * fichaje —el que este comentario descartaba— y por el mismo motivo. Y `storage.rules`
 * cierra ese prefijo a escritura: cerrado significa cerrado.
 */

export const LOGO_BUCKET = 'organization-logos';

/** Tipos que acepta el bucket. Fuera de esta lista Storage rechaza la subida. */
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/** 1 MB, el mismo límite que fija el bucket. Se comprueba antes de subir para poder
 *  decirlo con un mensaje entendible en vez de un error de Storage. */
export const LOGO_MAX_BYTES = 1_048_576;

const EXTENSIONS: Record<LogoMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * URL pública del logotipo a partir de la ruta guardada.
 *
 * Se compone al pintar y NO se guarda en la base: una URL guardada queda inservible
 * si el proyecto de Supabase cambia de dominio, que es justo lo que pasa al pasar de
 * un proyecto de pruebas a uno de verdad.
 */
export function logoPublicUrl(logoPath: string | null): string | null {
  if (logoPath === null || logoPath.trim() === '') return null;
  const db = getDataClient();
  if (db === null) return null;
  const { data } = db.storage.from(LOGO_BUCKET).getPublicUrl(logoPath);
  return data.publicUrl;
}

export type LogoUploadRejection =
  { reason: 'tooLarge'; bytes: number } | { reason: 'unsupportedType'; contentType: string };

/**
 * Comprueba tamaño y tipo ANTES de subir.
 *
 * Se hace en el cliente además de en el bucket porque el error de Storage por
 * tamaño o tipo llega como un mensaje genérico que no dice cuál de los dos falló, y
 * la persona que acaba de elegir una foto de 4 MB necesita saber exactamente eso.
 * No sustituye al límite del bucket: ese es el que manda.
 */
export function validateLogo(params: {
  bytes: number;
  contentType: string;
}): LogoUploadRejection | null {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(params.contentType)) {
    return { reason: 'unsupportedType', contentType: params.contentType };
  }
  if (params.bytes > LOGO_MAX_BYTES) return { reason: 'tooLarge', bytes: params.bytes };
  return null;
}

/**
 * Ruta dentro del bucket: `{organization_id}/logo.{ext}`.
 *
 * Sin fecha ni identificador aleatorio, a propósito: hay UN logotipo por
 * organización y sustituirlo debe sustituirlo. Con nombres únicos se acumularían
 * versiones que nadie va a limpiar, en un bucket de lectura pública.
 */
export function logoStoragePath(organizationId: string, contentType: LogoMimeType): string {
  return `${organizationId}/logo.${EXTENSIONS[contentType]}`;
}

export async function uploadOrganizationLogo(params: {
  organizationId: string;
  /** Contenido del archivo. `ArrayBuffer` funciona igual en web y en nativo. */
  body: ArrayBuffer;
  contentType: LogoMimeType;
  /**
   * Ruta anterior. Ya no se usa aquí: borrar la versión con otra extensión lo hace la
   * función, en la misma llamada. Se mantiene en la firma para no tocar a quien llama,
   * y porque el borrado del lado del cliente era otra cosa que podía fallar a medias
   * y dejar un archivo huérfano en un prefijo de lectura pública.
   */
  previousPath: string | null;
}): Promise<string> {
  const db = requireClient();
  const path = logoStoragePath(params.organizationId, params.contentType);

  const { data, error } = await db.rpc(RPC.setOrganizationLogo, {
    p_organization_id: params.organizationId,
    p_content_type: params.contentType,
    p_image_base64: aBase64(params.body),
  });
  if (error !== null) throw toAdminError(error);

  /*
   * La ruta que devuelve el servidor manda sobre la calculada aquí: si algún día las
   * dos dejan de coincidir, la buena es la del sitio que escribió el archivo.
   */
  const devuelta = (data as { path?: unknown } | null)?.path;
  return typeof devuelta === 'string' ? devuelta : path;
}

/**
 * Bytes a base64, a mano y sin `btoa`.
 *
 * `btoa` no existe en React Native, y en web revienta con un array grande si se le
 * pasa por `String.fromCharCode(...bytes)` —desborda la pila de argumentos—. Veinte
 * líneas propias funcionan igual en las dos plataformas y no dependen de qué trae el
 * entorno, que es justo la clase de suposición que rompió la subida del logo.
 */
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function aBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let salida = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    salida += ALFABETO[b0 >> 2];
    salida += ALFABETO[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    salida += b1 === undefined ? '=' : ALFABETO[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    salida += b2 === undefined ? '=' : ALFABETO[b2 & 0x3f];
  }
  return salida;
}

export async function removeOrganizationLogo(params: {
  organizationId: string;
  logoPath: string;
}): Promise<void> {
  const db = requireClient();

  // Primero la columna y después el archivo, por el mismo motivo del comentario de
  // arriba en el otro orden: si se borra el archivo y falla el update, la pantalla
  // queda con un logotipo roto. Así, como mucho, sobra un archivo.
  await execute((client) =>
    client.from(TABLES.organizations).update({ logo_path: null }).eq('id', params.organizationId),
  );

  const { error } = await db.storage.from(LOGO_BUCKET).remove([params.logoPath]);
  if (error !== null) throw toAdminError(error);
}
