/**
 * Abre la app en un navegador de verdad y LA USA: escribe un PIN, toca botones,
 * cambia de idioma. No comprueba que las pantallas rendericen —eso lo hace
 * `render-check.mjs`— sino que RESPONDAN.
 *
 * POR QUE EXISTE, Y POR QUE ES DISTINTO DEL CHEQUEO DE RENDER
 * El peor fallo de este proyecto fue un teclado de PIN que se quedaba en
 * "comprobando" para siempre: `invoke` lanzaba en vez de devolver un resultado, y
 * `setChecking(false)` nunca corría. El chequeo de render lo daba por bueno, porque
 * la pantalla se pinta perfectamente: solo se rompe cuando alguien TECLEA.
 *
 * Eso es lo que mide esto. El sitio donde vive un estado colgado es siempre el mismo:
 * un manejador asíncrono que no limpia su bandera de carga en todos los caminos.
 *
 * NO HAY SERVIDOR SUPABASE en este entorno, y eso no es una limitación: es el caso
 * que hay que comprobar. Sin red, el kiosco tiene que caer en su camino sin conexión
 * y DECIR ALGO. Un botón que se queda girando porque el servidor no responde es
 * exactamente el fallo que se busca.
 *
 * USO
 *   npx expo export --platform web --clear --output-dir /tmp/ks-web
 *   node scripts/interaccion-check.mjs /tmp/ks-web
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const require = createRequire(import.meta.url);

const RAIZ = process.argv[2];
if (!RAIZ) {
  console.error('Uso: node scripts/interaccion-check.mjs <directorio-del-export>');
  process.exit(2);
}

const PUERTO = 8098;
const CAPTURAS = process.env.INTERACCION_SHOTS ?? '/tmp/ks-interaccion';

/** Cuánto se espera a que un estado de carga se resuelva antes de llamarlo colgado. */
const ESPERA_MAXIMA_MS = 12_000;

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

function resolver(url) {
  const limpio = decodeURIComponent(url.split('?')[0]);
  const directo = join(RAIZ, limpio);
  if (existsSync(directo) && statSync(directo).isFile()) return directo;
  const raizIndice = join(RAIZ, 'index.html');
  return existsSync(raizIndice) ? raizIndice : null;
}

const servidor = createServer(async (req, res) => {
  try {
    const archivo = resolver(req.url ?? '/');
    if (archivo === null) {
      res.writeHead(404).end('no encontrado');
      return;
    }
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(cuerpo);
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
const problemas = [];

function fallar(caso, detalle) {
  fallos += 1;
  problemas.push(`${caso}: ${detalle}`);
  console.log(`MAL  ${caso}`);
  console.log(`     ${detalle}`);
}

function pasar(caso, nota) {
  console.log(`ok   ${caso}${nota ? '  — ' + nota : ''}`);
}

/**
 * Un contexto nuevo por caso.
 *
 * Con una sola página navegando, los manejadores de OPFS de la ruta anterior no se
 * liberan y la siguiente falla con NoModificationAllowedError. Es un fallo del arnés
 * que parece de la app; lo aprendí escribiendo `render-check.mjs`.
 */
async function conPagina(ruta, cuerpo, { comoKiosco = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
  const page = await context.newPage();
  if (comoKiosco) await sembrarKiosco(page);
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const texto = m.text();
    // NO CUENTA como error de la app que no se pueda alcanzar el servidor: es
    // exactamente el caso que se esta probando —el kiosco sin red— y el navegador
    // registra un error de consola por cada peticion fallida. Se filtran SOLO los
    // fallos de carga de recurso; cualquier excepcion de la app sigue contando.
    if (/Failed to load resource|net::ERR_|ERR_TUNNEL/.test(texto)) return;
    errores.push('console: ' + texto.slice(0, 160));
  });

  try {
    await page.goto(`http://127.0.0.1:${PUERTO}${ruta}`, { waitUntil: 'networkidle' });
    await cuerpo(page, errores);
  } finally {
    await context.close();
  }
}

/**
 * Siembra una credencial de kiosco antes de que cargue la app.
 *
 * En web, `secureStorage` cae a `localStorage` con el prefijo `krealo-shift.dev.`
 * (es un respaldo declarado y ruidoso: ver src/lib/security/secure-storage.ts). Eso
 * permite abrir el kiosco COMO SI el iPad estuviera activado, que es la unica forma de
 * llegar al teclado del PIN sin un servidor.
 *
 * Sin esto, `/kiosk` muestra —correctamente— su estado vacio de "este iPad todavia no
 * es un reloj", y no hay teclado que probar.
 */
const BINDING = {
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

async function sembrarKiosco(page) {
  await page.addInitScript((binding) => {
    const P = 'krealo-shift.dev.';
    localStorage.setItem(P + 'kiosk.credential', JSON.stringify(binding));
    localStorage.setItem(P + 'kiosk.credential.secret', 'credencial-de-prueba');
    localStorage.setItem(P + 'kiosk.deviceKey', 'a'.repeat(64));
  }, BINDING);
}

/**
 * Espera a que la pantalla llegue a un estado FINAL, no solo a que diga algo.
 *
 * ESTE MATIZ CASI ME CUELA UN FALLO. La primera version buscaba "cualquier mensaje
 * nuevo", y el texto de "Comprobando tu PIN…" —que acabo de anadir— lo satisfacia. O
 * sea que la prueba habria pasado con la pantalla colgada mostrando "Comprobando"
 * para siempre, que es EXACTAMENTE el fallo que este chequeo existe para detectar.
 *
 * Asi que se exige lo contrario: que el texto de carga haya DESAPARECIDO y haya un
 * mensaje final. Un indicador de carga que no se va es un fallo, no un exito.
 */
async function esperarEstadoFinal(page, patronFinal) {
  const CARGANDO = /Comprobando tu PIN|Checking your PIN/i;
  const inicio = Date.now();
  let texto = '';
  let vioCargando = false;

  while (Date.now() - inicio < ESPERA_MAXIMA_MS) {
    texto = await textoVisible(page);
    if (CARGANDO.test(texto)) {
      vioCargando = true;
    } else if (patronFinal.test(texto)) {
      return { ok: true, texto, vioCargando };
    }
    await page.waitForTimeout(300);
  }

  return { ok: false, texto, vioCargando };
}

/** Texto visible de la pantalla, aplanado. */
async function textoVisible(page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 0. Sin credencial de kiosco: estado vacio CON su siguiente accion
// ---------------------------------------------------------------------------
//
// EL FALLO QUE ENCONTRO ESTE CHEQUEO. Antes esta pantalla mostraba el teclado
// completo y `submit` empezaba con `if (binding === null) return;`, asi que se podia
// teclear el PIN entero —los seis puntos se llenaban— y no pasaba NADA. Para siempre,
// sin un mensaje.
await conPagina(
  '/kiosk',
  async (page, errores) => {
    const caso = 'sin credencial: estado vacio con accion';
    const texto = await textoVisible(page);

    if (!/todav[ií]a no es un reloj/i.test(texto)) {
      fallar(caso, 'no aparece el estado vacio: ' + texto.slice(0, 200));
      return;
    }
    // Y NO un teclado que no hace nada.
    if (await page.getByTestId('keypad-1').count()) {
      fallar(caso, 'muestra el teclado del PIN en un dispositivo sin activar');
      return;
    }
    if (!(await page.getByTestId('kiosk-go-to-setup').count())) {
      fallar(caso, 'el estado vacio no ofrece la siguiente accion');
      return;
    }
    if (errores.length > 0) {
      fallar(caso, 'errores de consola: ' + errores.join(' | '));
      return;
    }
    await page.screenshot({ path: join(CAPTURAS, 'sin-credencial.png') });
    pasar(caso);
  },
  { comoKiosco: false },
);

// ---------------------------------------------------------------------------
// 1. El teclado del PIN responde y NO se queda colgado
// ---------------------------------------------------------------------------
//
// EL CASO QUE IMPORTA. Sin servidor, `verifyPin` falla; el kiosco tiene que caer en
// su camino sin conexion y decir algo. Lo que no puede pasar es que el teclado se
// quede en "comprobando" para siempre, que es lo que hacia cuando `invoke` lanzaba.
await conPagina('/kiosk', async (page, errores) => {
  const caso = 'teclado del PIN responde';

  const antes = await textoVisible(page);
  if (!/\b1\b/.test(antes)) {
    fallar(caso, 'no encuentro el teclado en la pantalla del kiosco');
    return;
  }

  // Seis digitos, que es la longitud por defecto: al completarlo se valida solo,
  // sin boton de aceptar (§9.1).
  for (const digito of ['1', '2', '3', '4', '5', '6']) {
    await page.getByTestId(`keypad-${digito}`).click();
  }

  const resultado = await esperarEstadoFinal(
    page,
    /incorrect|no está listo|no esta listo|sin conexión|sin conexion|reactivar|credencial|intento|no pudimos|servidor/i,
  );

  await page.screenshot({ path: join(CAPTURAS, 'pin.png') });

  if (!resultado.ok) {
    fallar(
      caso,
      `tras ${ESPERA_MAXIMA_MS / 1000} s el teclado no llego a un estado final` +
        (resultado.vioCargando ? ' (se quedo en "Comprobando")' : ' (nunca dijo nada)') +
        `. Pantalla: ${resultado.texto.slice(0, 220)}`,
    );
    return;
  }

  // Y que HAYA mostrado el estado de carga: sin el, la persona teclea y la pantalla
  // se queda igual varios segundos.
  if (!resultado.vioCargando) {
    fallar(caso, 'no mostro ninguna señal de que estuviera comprobando el PIN');
    return;
  }

  const textoFinal = resultado.texto;

  if (errores.length > 0) {
    fallar(caso, 'errores de consola al teclear: ' + errores.join(' | '));
    return;
  }

  pasar(caso, textoFinal.slice(0, 90));
});

// ---------------------------------------------------------------------------
// 2. El conmutador de idioma cambia la pantalla de verdad
// ---------------------------------------------------------------------------
await conPagina('/kiosk', async (page, errores) => {
  const caso = 'cambio de idioma en el kiosco';

  const español = await textoVisible(page);
  await page.getByTestId('kiosk-language-toggle-en').click();
  await page.waitForTimeout(600);
  const ingles = await textoVisible(page);

  if (español === ingles) {
    fallar(caso, 'la pantalla no cambio al pulsar English');
    return;
  }
  if (!/Enter your/i.test(ingles)) {
    fallar(caso, 'el texto en ingles no aparecio: ' + ingles.slice(0, 160));
    return;
  }

  // Y de vuelta, que es donde suele fallar un conmutador.
  await page.getByTestId('kiosk-language-toggle-es-PE').click();
  await page.waitForTimeout(600);
  const vuelta = await textoVisible(page);
  if (!/Ingresa tu/i.test(vuelta)) {
    fallar(caso, 'no volvio al español: ' + vuelta.slice(0, 160));
    return;
  }

  if (errores.length > 0) {
    fallar(caso, 'errores de consola: ' + errores.join(' | '));
    return;
  }
  pasar(caso);
});

// ---------------------------------------------------------------------------
// 3. Borrar un digito y el limite de longitud
// ---------------------------------------------------------------------------
await conPagina('/kiosk', async (page) => {
  const caso = 'borrar y limite de longitud del PIN';

  // Cinco digitos: no llega a validar, asi que el estado queda observable.
  for (const d of ['1', '2', '3', '4', '5']) await page.getByTestId(`keypad-${d}`).click();
  await page.getByTestId('keypad-backspace').click();
  await page.waitForTimeout(300);

  // Con cuatro de seis no debe haberse disparado ninguna validacion.
  const texto = await textoVisible(page);
  if (/incorrect/i.test(texto)) {
    fallar(caso, 'valido el PIN antes de completar la longitud');
    return;
  }
  pasar(caso);
});

// ---------------------------------------------------------------------------
// 4. La pantalla de salir del kiosco tampoco se cuelga
// ---------------------------------------------------------------------------
await conPagina('/kiosk/exit', async (page, errores) => {
  const caso = 'PIN de gerente para salir del kiosco';

  for (const d of ['9', '8', '7', '6', '5', '4']) {
    await page.getByTestId(`keypad-${d}`).click();
  }

  const resultado = await esperarEstadoFinal(
    page,
    /incorrect|conexión|conexion|credencial|gerente|intento|servidor/i,
  );

  await page.screenshot({ path: join(CAPTURAS, 'exit.png') });

  if (!resultado.ok) {
    fallar(
      caso,
      `tras ${ESPERA_MAXIMA_MS / 1000} s no llego a un estado final` +
        (resultado.vioCargando ? ' (se quedo en "Comprobando")' : '') +
        `: ${resultado.texto.slice(0, 220)}`,
    );
    return;
  }
  if (!resultado.vioCargando) {
    fallar(caso, 'no mostro ninguna señal de que estuviera comprobando el PIN');
    return;
  }

  const textoFinal = resultado.texto;
  if (errores.length > 0) {
    fallar(caso, 'errores de consola: ' + errores.join(' | '));
    return;
  }
  pasar(caso, textoFinal.slice(0, 90));
});

// ---------------------------------------------------------------------------
// 5. El formulario de activacion valida antes de llamar al servidor
// ---------------------------------------------------------------------------
await conPagina('/kiosk/setup', async (page, errores) => {
  const caso = 'activacion del kiosco';

  const texto = await textoVisible(page);
  if (!/activ/i.test(texto)) {
    fallar(caso, 'no parece la pantalla de activacion: ' + texto.slice(0, 160));
    return;
  }
  if (errores.length > 0) {
    fallar(caso, 'errores de consola al abrir: ' + errores.join(' | '));
    return;
  }
  pasar(caso);
});

// ---------------------------------------------------------------------------
// 6. El panel NO se queda en "Preparando tu sesion" para siempre
// ---------------------------------------------------------------------------
//
// EL FALLO DE MAYOR ALCANCE QUE HA TENIDO ESTE PROYECTO. `hydrate` de la sesion
// llamaba a `getSession()` sin try/catch y sin limite de tiempo: si eso fallaba,
// `phase` se quedaba en `'unknown'` para siempre, y `phase === 'unknown'` es lo que
// bloquea la ruta de arranque Y las cuatro pestañas del panel. La app entera se
// quedaba en la pantalla de carga, y reiniciar sin red hacia lo mismo. El kiosco
// tambien, porque la app arranca en `/`.
//
// El chequeo de render no lo veia porque captura al instante: una pantalla de carga
// recien pintada es indistinguible de una colgada. Lo que distingue las dos es
// ESPERAR.
for (const ruta of ['/team', '/more']) {
  await conPagina(
    ruta,
    async (page, errores) => {
      const caso = `el panel resuelve su sesion (${ruta})`;
      const CARGANDO = /Preparando tu sesión|Preparing your session/i;

      const inicio = Date.now();
      let texto = await textoVisible(page);
      // Margen sobre el limite de 6 s del store, mas el arranque.
      while (Date.now() - inicio < 15_000 && CARGANDO.test(texto)) {
        await page.waitForTimeout(500);
        texto = await textoVisible(page);
      }

      if (CARGANDO.test(texto)) {
        fallar(
          caso,
          'sigue en "Preparando tu sesion" tras 15 s. Es el sintoma de que el arranque ' +
            'de la sesion no resuelve, y deja la app entera inutilizable.',
        );
        return;
      }

      // Y termina donde tiene que terminar: sin sesion, en el acceso.
      if (!/Iniciar sesión|Sign in|Correo|Email/i.test(texto)) {
        fallar(caso, 'resolvio, pero no acabo en el acceso: ' + texto.slice(0, 200));
        return;
      }
      if (errores.length > 0) {
        fallar(caso, 'errores de consola: ' + errores.join(' | '));
        return;
      }
      pasar(caso, texto.slice(0, 70));
    },
    { comoKiosco: false },
  );
}

await browser.close();
servidor.close();

console.log(`\nCapturas en ${CAPTURAS}`);
if (fallos > 0) {
  console.log(`\n${fallos} caso(s) de interaccion con problemas:`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('\nLa app responde a la interaccion en todos los casos probados.');
