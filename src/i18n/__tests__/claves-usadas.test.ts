import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import esPE from '../locales/es-PE.json';

/**
 * TODA CLAVE QUE EL CÓDIGO PIDE EXISTE (2-oct).
 *
 * La prueba de paridad mira que los dos idiomas tengan las mismas claves, pero no que el
 * código pida claves que existan. Así pasaron tres: `timesheet.needsReviewBadge` en la
 * ficha de Equipo, y `kiosk.enterPin` y `attendance.clockIn` en la vista previa de la
 * marca de Ajustes. Una clave que no existe se pinta tal cual en pantalla —el texto
 * «timesheet.needsReviewBadge» al lado de las horas de una persona—, y ningún arnés la
 * caza porque no es un error: es un texto más.
 *
 * Se miran las llamadas con la clave escrita entera (`t('a.b')`). Las que se arman con
 * una variable (`t(\`absence.reason.${motivo}\`)`) las cubren las pruebas de cada pantalla.
 */

type Json = { [key: string]: Json | string };

function claves(obj: Json, prefijo = ''): string[] {
  return Object.entries(obj).flatMap(([clave, valor]) => {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    return typeof valor === 'string'
      ? [ruta, ruta.replace(/_(zero|one|two|few|many|other)$/, '')]
      : claves(valor, ruta);
  });
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === '__tests__' ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

it('ninguna pantalla pide una clave que no existe', () => {
  const existentes = new Set(claves(esPE as Json));
  const raiz = join(__dirname, '..', '..', '..');
  const faltan: string[] = [];
  for (const archivo of [...archivos(join(raiz, 'src')), ...archivos(join(raiz, 'app'))]) {
    const texto = readFileSync(archivo, 'utf8');
    for (const m of texto.matchAll(/\bt\(\s*'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g)) {
      const clave = m[1] ?? '';
      if (!existentes.has(clave)) faltan.push(`${archivo.slice(raiz.length + 1)}: ${clave}`);
    }
  }
  expect(faltan).toEqual([]);
});
