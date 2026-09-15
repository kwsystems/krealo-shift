import { CSV_BOM } from './csv';
import { compartirArchivo } from '@/lib/compartir/archivo';

/**
 * Comparte el CSV de la hoja de tiempo (§11.4).
 *
 * La mecánica —hoja del sistema en iPad, descarga en el navegador— vive en
 * `@/lib/compartir/archivo`, porque Reportes comparte igual y dos copias de esa lógica
 * se separan: la web se arreglaría en una y seguiría rota en la otra.
 *
 * Lo único propio del CSV es la marca de orden de bytes: sin ella Excel abre los
 * acentos mal, y un reporte de nómina con «Nuñez» en vez de «Núñez» se devuelve.
 */
export async function shareCsv(params: { fileName: string; content: string }): Promise<void> {
  await compartirArchivo({
    nombre: params.fileName,
    contenido: `${CSV_BOM}${params.content}`,
    tipoMime: 'text/csv',
    uti: 'public.comma-separated-values-text',
    titulo: params.fileName,
  });
}
