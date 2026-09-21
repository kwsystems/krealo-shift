#!/usr/bin/env node
/**
 * Comprueba que lo que se compiló es lo que la web publicada sirve DE VERDAD.
 *
 * POR QUE EXISTE: UN ARCHIVO QUE FALTA NO DA 404, DA 200 CON HTML.
 *
 * `firebase.json` reenvía `**` a `/index.html` para que las rutas del router
 * funcionen al recargar. El efecto secundario es que un archivo que no se subió NO
 * devuelve 404: devuelve la página entera con código 200. Nada falla, nada avisa, y
 * el navegador recibe HTML donde esperaba una fuente.
 *
 * Paso de verdad el 21-sep-2026. `ignore: ["**\/node_modules/**"]` parecía higiene y
 * borraba del subido las fuentes de Expo, que viven en
 * `assets/node_modules/@expo-google-fonts/...`. La app publicada salía en serif con
 * los iconos como cuadrados vacíos, y en local se veía perfecta porque el servidor
 * estático no aplica esa lista. Peor: `/assets/**` va con `immutable` un año, así que
 * la respuesta equivocada se quedó cacheada en los navegadores que ya habían entrado.
 *
 * Lo que comprueba: que cada archivo que NO es HTML se sirve con un tipo que no es
 * HTML. Es la única forma de distinguir «está» de «lo tapó la reescritura».
 *
 * Uso:
 *     node scripts/despliegue-check.mjs                       # contra la web publicada
 *     node scripts/despliegue-check.mjs http://localhost:4319 # contra otra
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BASE = (process.argv[2] ?? 'https://krealo-shift.web.app').replace(/\/$/, '');
const DIST = 'dist';

/** Lo que de verdad rompe la app si falta, y no se nota mirando. */
const TIPOS_ESPERADOS = {
  '.ttf': /font/,
  '.otf': /font/,
  '.woff': /font/,
  '.woff2': /font/,
  '.js': /javascript/,
  '.css': /css/,
  '.png': /image/,
  '.ico': /image|icon/,
};

function archivos(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else salida.push(ruta);
  }
  return salida;
}

let todos;
try {
  todos = archivos(DIST);
} catch {
  console.error(`No existe «${DIST}/». Compila antes con: npm run web:build`);
  process.exit(1);
}

const aComprobar = todos.filter((ruta) =>
  Object.keys(TIPOS_ESPERADOS).some((ext) => ruta.endsWith(ext)),
);

if (aComprobar.length === 0) {
  console.error(`«${DIST}/» no tiene ningún archivo comprobable. ¿Compilación vacía?`);
  process.exit(1);
}

console.log(`Comprobando ${aComprobar.length} archivos de ${DIST}/ contra ${BASE}\n`);

const fallos = [];
for (const ruta of aComprobar) {
  const url = `${BASE}/${relative(DIST, ruta).split(sep).join('/')}`;
  const extension = Object.keys(TIPOS_ESPERADOS).find((ext) => ruta.endsWith(ext));
  const esperado = TIPOS_ESPERADOS[extension];

  let respuesta;
  try {
    respuesta = await fetch(url, { method: 'HEAD' });
  } catch (error) {
    fallos.push({ url, motivo: `no se pudo pedir: ${String(error)}` });
    continue;
  }

  const tipo = respuesta.headers.get('content-type') ?? '(sin tipo)';

  if (!respuesta.ok) {
    fallos.push({ url, motivo: `HTTP ${respuesta.status}` });
  } else if (/text\/html/.test(tipo)) {
    // El caso que importa: existe según el código, y lo que llega es la página.
    fallos.push({ url, motivo: `LA REESCRITURA LO TAPÓ: llegó HTML, no ${extension}` });
  } else if (!esperado.test(tipo)) {
    fallos.push({ url, motivo: `tipo inesperado: ${tipo}` });
  }
}

if (fallos.length === 0) {
  console.log(`Todo servido con su tipo correcto: ${aComprobar.length} archivos.`);
  process.exit(0);
}

console.error(`FALLA: ${fallos.length} de ${aComprobar.length} archivos.\n`);
for (const { url, motivo } of fallos.slice(0, 25)) {
  console.error(`  ${motivo}`);
  console.error(`    ${url}`);
}
if (fallos.length > 25) console.error(`  ... y ${fallos.length - 25} más.`);
console.error('\nCausa habitual: `ignore` en firebase.json excluyendo algo del subido.');
process.exit(1);
