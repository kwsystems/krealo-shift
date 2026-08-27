import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { CSV_BOM } from './csv';
import { AdminError } from '@/hooks/use-admin-query';

/**
 * Escribe el CSV en la caché y abre la hoja de compartir de iOS (§11.4).
 *
 * El archivo va a la caché a propósito: es un documento derivado que el sistema
 * puede borrar sin perder nada, y no queremos horas de empleados acumulándose en
 * el almacenamiento del iPad.
 */
export async function shareCsv(params: { fileName: string; content: string }): Promise<void> {
  try {
    const file = new File(Paths.cache, params.fileName);
    if (file.exists) file.delete();
    file.create({ overwrite: true, intermediates: true });
    file.write(`${CSV_BOM}${params.content}`);

    const available = await Sharing.isAvailableAsync();
    if (!available) throw new AdminError('server', 'SHARING_UNAVAILABLE');

    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: params.fileName,
    });
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError('server', error instanceof Error ? error.message : 'SHARE_FAILED');
  }
}
