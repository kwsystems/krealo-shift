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

import { faltaEnElPaquete, sobraEnElPaquete } from './lib/configuracion-horneada.mjs';

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

/**
 * UN ARCHIVO, UNA PREGUNTA: ¿se sirve con su tipo? Devuelve el motivo del fallo, o `null`.
 */
async function comprobar(ruta) {
  const url = `${BASE}/${relative(DIST, ruta).split(sep).join('/')}`;
  const extension = Object.keys(TIPOS_ESPERADOS).find((ext) => ruta.endsWith(ext));
  const esperado = TIPOS_ESPERADOS[extension];

  let respuesta;
  try {
    respuesta = await fetch(url, { method: 'HEAD' });
  } catch (error) {
    return { url, motivo: `no se pudo pedir: ${String(error)}` };
  }

  const tipo = respuesta.headers.get('content-type') ?? '(sin tipo)';
  if (!respuesta.ok) return { url, motivo: `HTTP ${respuesta.status}` };
  // El caso que importa: existe según el código, y lo que llega es la página.
  if (/text\/html/.test(tipo)) {
    return { url, motivo: `LA REESCRITURA LO TAPÓ: llegó HTML, no ${extension}` };
  }
  if (!esperado.test(tipo)) return { url, motivo: `tipo inesperado: ${tipo}` };
  return null;
}

/**
 * LOS REINTENTOS, y por qué no son «esperar un rato antes de empezar» (30-sep).
 *
 * Justo después de `firebase deploy --only hosting`, la CDN tarda unos segundos en tener
 * todos los archivos en todos los bordes. Tres veces el 28 y el 29-sep esta comprobación
 * falló en el acto —un 503 en una fuente, un archivo «que no se servía», el paquete
 * llegando como HTML— y la segunda pasada, sin tocar nada, salió verde. Una comprobación
 * que da falsos positivos se deja de leer, y esta es la que dice si producción quedó bien.
 *
 * Una espera fija antes de empezar lo escondería —y alargaría todos los despliegues por el
 * caso raro—. Así que se DISTINGUE: se mira todo una vez, y solo lo que falló se vuelve a
 * pedir, a los 3, 6 y 12 segundos. Lo que se arregla solo era propagación, y se DICE
 * cuántos hicieron falta: una propagación lenta se ve como lo que es y no desaparece. Lo
 * que sigue mal a los 21 segundos no es propagación, y ahí sí falla.
 */
const ESPERAS_MS = [3000, 6000, 12000];
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

let fallos = [];
for (const ruta of aComprobar) {
  const fallo = await comprobar(ruta);
  if (fallo !== null) fallos.push({ ...fallo, ruta });
}

const reintentados = fallos.length;
for (const espera of ESPERAS_MS) {
  if (fallos.length === 0) break;
  await esperar(espera);
  const siguen = [];
  for (const fallo of fallos) {
    const otraVez = await comprobar(fallo.ruta);
    if (otraVez !== null) siguen.push({ ...otraVez, ruta: fallo.ruta });
  }
  fallos = siguen;
}
if (reintentados > 0 && fallos.length < reintentados) {
  console.log(
    `${reintentados - fallos.length} archivo(s) no estaban aún en la CDN y aparecieron al ` +
      'reintentar: era la propagación del despliegue, no un archivo que falte.',
  );
}

/**
 * Y QUE EL PAQUETE LLEVE LA CONFIGURACIÓN DENTRO.
 *
 * ESTA COMPROBACIÓN NACE DE HABER ROTO LA WEB EN PRODUCCIÓN (2026-09-21). Se desplegó
 * un paquete construido SIN `.env` —el archivo no existía en la copia de trabajo—, así
 * que `expo export` horneó las variables de Firebase vacías y el sitio publicado no
 * enseñaba la aplicación sino «Falta configuración del entorno». Lo peor: esta misma
 * comprobación pasó EN VERDE sobre esa web rota, porque hasta aquí solo miraba que los
 * 59 archivos se sirvieran con su tipo correcto. Y lo hacían: un JavaScript perfecto
 * que arrancaba una pantalla de error.
 *
 * Así que ahora se mira DENTRO del paquete que acaba de publicarse. Si lleva una clave
 * de API de Google y el identificador del proyecto, se construyó con configuración; si
 * no, se construyó sin ella y da igual lo bien servido que esté.
 *
 * No hace falta navegador: las variables `EXPO_PUBLIC_*` se hornean en el paquete —son
 * públicas por diseño, van en el cliente— así que leerlo basta y cuesta una descarga.
 */
if (fallos.length === 0) {
  const entrada = aComprobar.find((ruta) => /entry-[a-f0-9]+\.js$/.test(ruta));
  if (entrada === undefined) {
    console.error('FALLA: no encontré el paquete de entrada; algo cambió en el empaquetado.');
    process.exit(1);
  }

  // La misma construcción que el bucle de arriba: `aComprobar` guarda rutas DEL DISCO,
  // no URLs. Usarlas tal cual pedía una dirección inexistente y la comprobación acusaba
  // de «sin configuración» a un despliegue correcto.
  const urlEntrada = `${BASE}/${relative(DIST, entrada).split(sep).join('/')}`;
  /*
   * CON LOS MISMOS REINTENTOS: en plena propagación el paquete también puede llegar como
   * la página HTML, y entonces «no lleva la configuración» sería otro falso positivo.
   */
  let paquete = '';
  for (const espera of [0, ...ESPERAS_MS]) {
    if (espera > 0) await esperar(espera);
    const respuesta = await fetch(urlEntrada);
    paquete = await respuesta.text();
    const esJs = /javascript/.test(respuesta.headers.get('content-type') ?? '');
    if (respuesta.ok && esJs && faltaEnElPaquete(paquete).length === 0) break;
  }
  /*
   * LA MISMA FUNCIÓN QUE USA `paquete-check.mjs`, y compartida a propósito: la pregunta
   * «¿lleva este paquete su configuración?» se hace antes de desplegar y después, y si
   * cada arnés tuviera su copia acabarían discrepando sobre el mismo paquete.
   */
  const faltan = faltaEnElPaquete(paquete);

  if (faltan.length > 0) {
    console.error(`\nFALLA: el paquete publicado no lleva ${faltan.join(' ni ')}.`);
    console.error('  Se construyó sin `.env`, así que el sitio enseña «Falta configuración');
    console.error('  del entorno» en vez de la aplicación. Copia `.env.example` a `.env`,');
    console.error('  reconstruye y vuelve a desplegar.');
    process.exit(1);
  }
  const sobran = sobraEnElPaquete(paquete);
  if (sobran.length > 0) {
    console.error(`\nFALLA: el paquete publicado lleva ${sobran.join(' y ')}.`);
    console.error('  Nadie puede entrar al panel: quita `EXPO_PUBLIC_AUTH_EMULATOR_URL`,');
    console.error('  reconstruye y vuelve a desplegar.');
    process.exit(1);
  }
  console.log('El paquete publicado lleva su configuración de Firebase dentro.');
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
console.error(
  `\nSe reintentó durante ${ESPERAS_MS.reduce((a, b) => a + b, 0) / 1000} s, así que no es la ` +
    'propagación de la CDN.',
);
console.error('Causa habitual: `ignore` en firebase.json excluyendo algo del subido.');
process.exit(1);
