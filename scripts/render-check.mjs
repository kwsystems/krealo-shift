/**
 * Abre la app en un navegador de verdad y comprueba que cada pantalla RENDERIZA.
 *
 * POR QUE EXISTE ESTO
 * `tsc`, `eslint` y las pruebas de Jest daban verde mientras el empaquetado para web
 * fallaba ENTERO —faltaba `metro.config.js` y Metro no resolvia el `.wasm` de
 * expo-sqlite—. Y una vez arreglado, la app pintaba pero escupia tres errores por
 * pantalla del kiosco porque SQLite no podia abrirse en el navegador.
 *
 * Ninguna de esas dos cosas la ve el typecheck ni Jest: el modulo nativo esta
 * simulado en las pruebas. Solo aparecen al empaquetar y al abrir la app.
 *
 * QUE COMPRUEBA
 *   - que cada ruta responde y su cuerpo NO esta vacio (una pantalla en blanco es
 *     el sintoma clasico de un error en el arranque);
 *   - que no hay errores de pagina ni de consola;
 *   - deja una captura por ruta para revisarlas a ojo.
 *
 * USO
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx expo export --platform web --clear --output-dir /tmp/ks-web
 *   node scripts/render-check.mjs /tmp/ks-web
 *
 * OJO CON DOS TRAMPAS que costaron un rato:
 *
 * 1. `--clear` NO es opcional. Metro cachea el empaquetado y NO invalida la cache
 *    cuando cambian las variables EXPO_PUBLIC_*, asi que sin `--clear` se empaqueta
 *    con los valores viejos y la app dice que falta configuracion. Parece un fallo
 *    de la app y es la cache.
 *
 * 2. UN CONTEXTO DE NAVEGADOR NUEVO POR RUTA. Con una sola pagina navegando, los
 *    manejadores de OPFS de la ruta anterior no se liberan y la siguiente falla con
 *    NoModificationAllowedError. Es un fallo del arnes que parece de la app.
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const require = createRequire(import.meta.url);

const RAIZ = process.argv[2];
if (!RAIZ) {
  console.error('Uso: node scripts/render-check.mjs <directorio-del-export>');
  process.exit(2);
}

const PUERTO = 8099;
const CAPTURAS = process.env.RENDER_CHECK_SHOTS ?? '/tmp/ks-render-shots';

const RUTAS = [
  ['inicio', '/'],
  ['acceso', '/sign-in'],
  // Sin `code` en la URL: el caso del enlace roto o pegado a medias, que es el que
  // se puede probar sin un correo de verdad.
  ['restablecer', '/restablecer'],
  ['kiosco-olvide', '/kiosk/forgot'],
  ['kiosco', '/kiosk'],
  ['kiosco-setup', '/kiosk/setup'],
  ['kiosco-ayuda', '/kiosk/help'],
  ['kiosco-salida', '/kiosk/exit'],
  ['kiosco-acciones', '/kiosk/actions'],
  ['panel-equipo', '/team'],
  ['panel-horario', '/schedule'],
  ['panel-horas', '/hours'],
  ['panel-mas', '/more'],
];

const TIPOS = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * Resuelve una URL a un archivo del export.
 *
 * El proyecto usa `web.output: 'single'`, o sea una sola pagina con enrutado en el
 * cliente: solo existe `index.html` y el router decide la pantalla a partir de la
 * ruta. Asi que cualquier ruta que no sea un archivo real cae en `index.html`, que
 * es lo que hace un servidor de SPA.
 *
 * Antes el proyecto usaba `output: 'static'`, que escribia un .html por ruta, y esta
 * funcion buscaba `/team.html`. Se cambio porque el modo estatico ROMPIA el servidor
 * de desarrollo: fallaba con "Worker chunk not found" de expo-sqlite, o sea que
 * `npx expo start --web` no arrancaba. Ver app.config.ts.
 */
function resolver(url) {
  const limpio = decodeURIComponent(url.split('?')[0]);
  const directo = join(RAIZ, limpio);
  if (existsSync(directo) && statSync(directo).isFile()) return directo;
  if (existsSync(directo) && statSync(directo).isDirectory()) {
    const indice = join(directo, 'index.html');
    if (existsSync(indice)) return indice;
  }
  // Respaldo de SPA: la ruta la resuelve el router en el navegador.
  const raizIndice = join(RAIZ, 'index.html');
  return existsSync(raizIndice) ? raizIndice : null;
}

const servidor = createServer(async (req, res) => {
  const archivo = resolver(req.url ?? '/');
  if (archivo === null) {
    res.writeHead(404).end('no encontrado');
    return;
  }
  try {
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(await readFile(archivo));
  } catch {
    res.writeHead(500).end('error');
  }
});

await new Promise((listo) => servidor.listen(PUERTO, '127.0.0.1', listo));
await mkdir(CAPTURAS, { recursive: true });

let pw;
try {
  pw = require('playwright');
} catch {
  try {
    pw = require('/opt/node22/lib/node_modules/playwright/index.js');
  } catch {
    console.error('Falta playwright. Instalalo o define NODE_PATH.');
    process.exit(2);
  }
}

const browser = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
});

let fallos = 0;

for (const [nombre, ruta] of RUTAS) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
  const page = await context.newPage();

  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push('console: ' + m.text().slice(0, 200));
  });

  let estado = 'ok';
  let texto = '';
  try {
    const resp = await page.goto(`http://127.0.0.1:${PUERTO}${ruta}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await page.waitForTimeout(1200);
    texto = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    if (resp && resp.status() >= 400) estado = 'http ' + resp.status();
    else if (texto.length === 0) estado = 'PANTALLA VACIA';
    else if (/unmatched route/i.test(texto)) estado = 'RUTA NO ENCONTRADA';
  } catch (e) {
    estado = 'FALLO: ' + String(e).slice(0, 120);
  }

  await page.screenshot({ path: join(CAPTURAS, nombre + '.png') });

  if (estado !== 'ok' || errores.length > 0) fallos += 1;
  console.log(
    `${estado === 'ok' && errores.length === 0 ? 'ok  ' : 'MAL '} ${nombre.padEnd(18)} ${ruta.padEnd(18)} ${estado}`,
  );
  if (texto) console.log(`     ${texto.slice(0, 120)}`);
  for (const err of errores.slice(0, 3)) console.log(`     ${err}`);

  await context.close();
}

await browser.close();
servidor.close();

console.log(`\nCapturas en ${CAPTURAS}`);
if (fallos > 0) {
  console.error(`${fallos} de ${RUTAS.length} rutas con problemas.`);
  process.exit(1);
}
console.log(`Las ${RUTAS.length} rutas renderizan sin errores.`);
