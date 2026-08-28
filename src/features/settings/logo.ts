import { execute, requireClient, toAdminError } from '@/hooks/use-admin-query';
import { getSupabase } from '@/lib/supabase/client';
import { TABLES } from '@/lib/supabase/types';

/**
 * Logotipo de la organización (§11.6).
 *
 * SUBE DIRECTO A STORAGE, sin Edge Function, y la diferencia con las fotos de
 * fichaje merece explicación porque son el mismo problema resuelto al revés:
 *
 *   * la foto de fichaje la sube el KIOSCO, que no tiene sesión de Supabase y nunca
 *     debe recibir permiso de escritura sobre Storage. Va por `attach-photo`.
 *   * el logotipo lo sube el PANEL, que sí tiene sesión, y las políticas de
 *     `20260827001200_organization_logo.sql` ya limitan la escritura a owner o admin
 *     de la organización del primer segmento de la ruta. Una función intermedia no
 *     añadiría ninguna barrera; solo un salto más donde equivocarse.
 *
 * La barrera real, como siempre en este proyecto, es la política: si alguien llama a
 * esto con otro `organizationId`, Storage lo rechaza.
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
  const db = getSupabase();
  if (db === null) return null;
  const { data } = db.storage.from(LOGO_BUCKET).getPublicUrl(logoPath);
  return data.publicUrl;
}

export type LogoUploadRejection =
  | { reason: 'tooLarge'; bytes: number }
  | { reason: 'unsupportedType'; contentType: string };

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
  /** Ruta anterior, para borrarla si la extensión cambió. */
  previousPath: string | null;
}): Promise<string> {
  const db = requireClient();
  const path = logoStoragePath(params.organizationId, params.contentType);

  const { error } = await db.storage.from(LOGO_BUCKET).upload(path, params.body, {
    contentType: params.contentType,
    // Sustituir, no acumular. Ver la nota de `logoStoragePath`.
    upsert: true,
  });
  if (error !== null) throw toAdminError(error);

  // `logo_path` se escribe DESPUÉS de que el archivo esté arriba, igual que
  // `photo_path` en los fichajes. Al revés, un fallo de subida deja la columna
  // apuntando a un objeto que no existe, y la pantalla muestra una imagen rota sin
  // ninguna forma de saber por qué.
  await execute((client) =>
    client.from(TABLES.organizations).update({ logo_path: path }).eq('id', params.organizationId),
  );

  // Si antes había un PNG y ahora es un JPG, el viejo queda huérfano en un bucket
  // público. Se borra después de actualizar la columna: si el borrado falla, lo que
  // sobra es un archivo, no un logotipo que no se ve.
  if (params.previousPath !== null && params.previousPath !== path) {
    await db.storage.from(LOGO_BUCKET).remove([params.previousPath]);
  }

  return path;
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
