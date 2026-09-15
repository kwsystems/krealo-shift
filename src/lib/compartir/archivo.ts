import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { AdminError } from '@/hooks/use-admin-query';

/**
 * Compartir un archivo de texto, en las tres plataformas.
 *
 * ESTO EXISTE PORQUE EN LA WEB NO FUNCIONABA
 * `share-csv.ts` escribía el archivo con `expo-file-system` y abría la hoja de
 * compartir. En un navegador, `Sharing.isAvailableAsync()` devuelve `false`, así que
 * «Exportar CSV» en Horas no descargaba nada: mostraba «no se pudo exportar». Nadie lo
 * había visto porque hasta ahora la app se probaba en iPad, y justo ahora la web pasó a
 * ser la forma principal de usarla.
 *
 * En un navegador un archivo se entrega descargándolo, que es lo que la persona espera
 * y lo que la web sabe hacer. En un teléfono o un iPad, la hoja del sistema, que es lo
 * que da correo, WhatsApp y Drive sin que la app tenga que integrarse con ninguno.
 */

export type ArchivoCompartible = {
  nombre: string;
  contenido: string;
  /** `text/csv`, `text/plain`… Decide con qué lo abre el sistema operativo. */
  tipoMime: string;
  /** Identificador de tipo de Apple. Solo lo usa iOS. */
  uti?: string;
  /** Título del diálogo del sistema. */
  titulo?: string;
};

export async function compartirArchivo(archivo: ArchivoCompartible): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      await descargarEnNavegador(archivo);
      return;
    }
    await compartirNativo(archivo);
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError('server', error instanceof Error ? error.message : 'SHARE_FAILED');
  }
}

/**
 * Descarga en el navegador con un enlace temporal.
 *
 * El `revokeObjectURL` no es opcional: sin él, cada exportación deja en memoria una
 * copia del archivo —con los nombres y las jornadas dentro— hasta que se recargue la
 * pestaña. Un gerente que exporta doce veces en una tarde acumula doce.
 */
async function descargarEnNavegador(archivo: ArchivoCompartible): Promise<void> {
  if (typeof document === 'undefined') throw new AdminError('server', 'SHARING_UNAVAILABLE');

  const blob = new Blob([archivo.contenido], { type: `${archivo.tipoMime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = archivo.nombre;
    enlace.style.display = 'none';
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Escribe en la CACHÉ y abre la hoja del sistema.
 *
 * En la caché a propósito: es un documento derivado que el sistema puede borrar cuando
 * necesite sitio, y no queremos que las horas de doce personas se vayan acumulando en
 * el almacenamiento de un iPad compartido.
 */
async function compartirNativo(archivo: ArchivoCompartible): Promise<void> {
  const file = new File(Paths.cache, archivo.nombre);
  if (file.exists) file.delete();
  file.create({ overwrite: true, intermediates: true });
  file.write(archivo.contenido);

  const disponible = await Sharing.isAvailableAsync();
  if (!disponible) throw new AdminError('server', 'SHARING_UNAVAILABLE');

  await Sharing.shareAsync(file.uri, {
    mimeType: archivo.tipoMime,
    UTI: archivo.uti,
    dialogTitle: archivo.titulo ?? archivo.nombre,
  });
}
