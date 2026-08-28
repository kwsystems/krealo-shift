/**
 * Comprueba que cada `testID` que usan los flujos de `e2e/` exista en el código.
 *
 * POR QUE HACE FALTA
 * Un flujo de Maestro que apunta a un id inexistente no falla al escribirlo: falla
 * cuando alguien lo ejecuta, que aquí es "nunca", porque no hay simulador de iOS en
 * la máquina de desarrollo remoto. Sin esta comprobación, `e2e/` se convierte en
 * documentación que aparenta ser una prueba.
 *
 * TRAMPA QUE HAY QUE MANEJAR, y por la que la primera version de esto dio un falso
 * positivo escandaloso: muchos `testID` se construyen con plantilla
 * (`testID={`keypad-${digit}`}`), asi que buscar solo `testID="..."` dice que faltan
 * las diez teclas del teclado numerico. No faltaban. Aqui se resuelven las
 * plantillas a expresiones regulares y tambien los comodines `*` de Maestro.
 *
 * USO: node scripts/e2e-ids-check.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

async function archivos(dir, ext) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await archivos(ruta, ext)));
    else if (ext.includes(extname(entrada.name))) salida.push(ruta);
  }
  return salida;
}

// 1. Los ids que los flujos usan, solo de los campos `id:` / `testID:` de Maestro.
const referencias = new Set();
for (const f of await archivos('e2e', ['.yaml', '.yml'])) {
  for (const linea of (await readFile(f, 'utf8')).split('\n')) {
    const m = linea.match(/\b(?:id|testID)\s*:\s*"?([A-Za-z0-9][A-Za-z0-9_.*-]*)"?/);
    if (m) referencias.add(m[1]);
  }
}

// 2. Los ids que el codigo define: literales y plantillas.
const literales = new Set();
const patrones = [];
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const f of [
  ...(await archivos('src', ['.ts', '.tsx'])),
  ...(await archivos('app', ['.ts', '.tsx'])),
]) {
  const texto = await readFile(f, 'utf8');
  for (const m of texto.matchAll(/testID="([^"]*)"/g)) literales.add(m[1]);
  for (const m of texto.matchAll(/testID=\{`([^`]*)`\}/g)) {
    const partes = m[1].split(/\$\{[^}]*\}/).map(escapar);
    patrones.push(new RegExp('^' + partes.join('[A-Za-z0-9_.:-]+') + '$'));
  }
}

const existe = (id) => {
  if (literales.has(id)) return true;
  if (id.includes('*')) {
    const rx = new RegExp('^' + id.split('*').map(escapar).join('.*') + '$');
    if ([...literales].some((l) => rx.test(l))) return true;
  }
  return patrones.some((p) => p.test(id));
};

const faltan = [...referencias].filter((id) => !existe(id)).sort();

console.log(`ids usados por los flujos: ${referencias.size}`);
console.log(`definidos en codigo: ${literales.size} literales, ${patrones.length} plantillas`);

if (faltan.length > 0) {
  console.error(`\n${faltan.length} testID que los flujos usan y el codigo NO define:`);
  for (const id of faltan) console.error('  ' + id);
  console.error('\nO se agrega el testID, o se corrige el flujo. Un flujo que apunta a');
  console.error('un id inexistente no es una prueba, es documentacion equivocada.');
  process.exit(1);
}
console.log('\nTodos los testID que usan los flujos existen en el codigo.');
