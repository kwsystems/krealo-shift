/**
 * Lo que comparten los cuatro chequeos de navegador.
 *
 * POR QUE EXISTE
 * `render-check`, `interaccion-check` y `a11y-check` tenian las MISMAS 85 lineas cada
 * uno: el servidor del export, la tabla de tipos MIME, el respaldo de SPA, la
 * resolucion de Playwright y la semilla del kiosco. Al ir a escribir el cuarto —las
 * capturas para la App Store— habrian sido cuatro copias.
 *
 * Y no es duplicacion inofensiva: la semilla del kiosco es el `binding` que el arnes
 * escribe en localStorage, o sea la forma real de un tipo del codigo. Con cuatro copias,
 * cambiar `KioskBinding` deja tres arneses sembrando una forma vieja, y el sintoma es un
 * chequeo que pasa mientras la app esta rota —o al contrario—.
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const require = createRequire(import.meta.url);

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
 * Sirve el export como lo serviria un servidor de SPA.
 *
 * El proyecto usa `web.output: 'single'`: solo existe `index.html` y el router decide la
 * pantalla a partir de la ruta. Asi que cualquier ruta que no sea un archivo real cae en
 * `index.html`. Antes el proyecto usaba `output: 'static'` —un .html por ruta— y se
 * cambio porque rompia el servidor de desarrollo: ver app.config.ts.
 */
export async function servirExport(raiz, puerto) {
  const resolver = (url) => {
    const limpio = decodeURIComponent(String(url).split('?')[0]);
    const directo = join(raiz, limpio);
    if (existsSync(directo) && statSync(directo).isFile()) return directo;
    if (existsSync(directo) && statSync(directo).isDirectory()) {
      const indice = join(directo, 'index.html');
      if (existsSync(indice)) return indice;
    }
    const raizIndice = join(raiz, 'index.html');
    return existsSync(raizIndice) ? raizIndice : null;
  };

  const servidor = createServer(async (req, res) => {
    const archivo = resolver(req.url ?? '/');
    if (archivo === null) {
      res.writeHead(404).end('no encontrado');
      return;
    }
    try {
      res.writeHead(200, {
        'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
      });
      res.end(await readFile(archivo));
    } catch {
      res.writeHead(500).end('error');
    }
  });

  await new Promise((listo) => servidor.listen(puerto, '127.0.0.1', listo));
  return {
    base: `http://127.0.0.1:${puerto}`,
    cerrar: () => servidor.close(),
  };
}

/** Playwright, esté instalado en el proyecto o en el Node global del contenedor. */
export function cargarPlaywright() {
  try {
    return require('playwright');
  } catch {
    try {
      return require('/opt/node22/lib/node_modules/playwright/index.js');
    } catch {
      console.error('Falta playwright. Instalalo o define NODE_PATH.');
      process.exit(2);
    }
  }
}

/**
 * El `binding` de un kiosco activado, con la forma de `KioskBinding`.
 *
 * En web, `secureStorage` cae a `localStorage` con el prefijo `krealo-shift.dev.` (un
 * respaldo declarado y ruidoso: ver src/lib/security/secure-storage.ts). Eso permite
 * abrir el kiosco COMO SI el iPad estuviera activado, que es la unica forma de llegar al
 * teclado del PIN sin un servidor. Sin esto, `/kiosk` muestra —correctamente— su estado
 * vacio de "este iPad todavia no es un reloj".
 */
export const BINDING_KIOSCO = {
  deviceId: '66666666-6666-4666-8666-666666666661',
  devicePublicId: 'demo-kiosk-main',
  displayName: 'iPad de prueba',
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationName: 'Krealo Media Demo',
  organizationLogoPath: null,
  locationId: '22222222-2222-4222-8222-222222222221',
  locationName: 'Sede Principal',
  timezone: 'America/Lima',
  policies: {
    pinLength: 6,
    photoEnabled: false,
    earlyClockInMinutes: 10,
    lateGraceMinutes: 5,
    allowUnscheduledShifts: true,
    timeFormat: '24h',
    requiredBreakMinutes: 0,
  },
  activatedAt: new Date().toISOString(),
};

/** Deja el navegador como un iPad ya activado, antes de que cargue la app. */
export async function sembrarKiosco(page, binding = BINDING_KIOSCO) {
  await page.addInitScript((valor) => {
    const P = 'krealo-shift.dev.';
    localStorage.setItem(P + 'kiosk.credential', JSON.stringify(valor));
    localStorage.setItem(P + 'kiosk.credential.secret', 'credencial-de-prueba');
    localStorage.setItem(P + 'kiosk.deviceKey', 'a'.repeat(64));
  }, binding);
}
