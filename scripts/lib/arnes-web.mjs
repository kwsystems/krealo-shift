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

/**
 * El contraste REAL de cada texto de la pantalla contra el fondo REAL que tiene detrás.
 *
 * NO SE MIDEN TOKENS, SE MIDE LO PINTADO. Un par de tokens que en la paleta da 6:1 puede
 * acabar en 2:1 en pantalla porque el texto cayó encima de otra superficie, o porque un
 * ancestro lleva `opacity`. Medir la paleta comprueba la paleta; esto comprueba la app.
 *
 * QUÉ ES «EL FONDO DE DETRÁS». El primer ancestro —empezando por el propio elemento— con
 * un fondo opaco. Es lo que se ve por detrás de las letras. Un fondo translúcido se
 * salta: encima de él sigue viéndose el de más atrás, y mezclarlos sería inventar un
 * color que no existe en la pantalla.
 *
 * VIVE AQUÍ Y NO EN UN ARNÉS porque la usan dos: `kiosco-check` para el reloj de fichaje
 * y `contraste-check` para las pantallas del panel. Con dos copias, el día que se afine
 * el cálculo —qué cuenta como texto grande, qué se exime— una de las dos se queda vieja
 * y empieza a decir OK sobre algo que la otra suspende.
 *
 * Devuelve `{ fallos, medidos, saltados }`. `medidos` importa tanto como `fallos`: cero
 * medidos con cero fallos NO es una pantalla legible, es un arnés que no está viendo
 * nada, y quien llama tiene que tratarlo como error.
 */
export async function medirContraste(pagina, { minimo, minimoGrande, tamanoGrande }) {
  return pagina.evaluate(
    ({ minimo, minimoGrande, tamanoGrande }) => {
      const canal = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const partes = (css) => {
        const n = (css || '').match(/\d+(\.\d+)?/g);
        return n === null || n.length < 3 ? null : n.map(Number.parseFloat);
      };
      const luz = (css) => {
        const n = partes(css);
        if (n === null) return null;
        const [r, g, b] = n.slice(0, 3).map((v) => canal(v / 255));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const opaco = (css) => {
        const n = partes(css);
        return n !== null && (n.length < 4 || n[3] >= 0.99);
      };
      const razon = (a, b) => {
        const [alto, bajo] = [a, b].sort((x, y) => y - x);
        return (alto + 0.05) / (bajo + 0.05);
      };

      const fallos = [];
      let medidos = 0;
      let saltados = 0;

      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const texto = (el.textContent ?? '').trim();
        if (texto === '') continue;
        const caja = el.getBoundingClientRect();
        if (caja.width < 1 || caja.height < 1) continue;

        const estilo = getComputedStyle(el);
        if (estilo.visibility === 'hidden' || estilo.display === 'none') continue;

        /*
         * Un control DESACTIVADO está exento de 1.4.3, y aquí lo hay de verdad: las
         * teclas se apagan con `opacity: 0.4` mientras se valida el PIN. Medirlas daría
         * un fallo por algo que la norma no pide y que además es la señal de "espera".
         */
        let transparente = false;
        for (let n = el; n !== null; n = n.parentElement) {
          if (Number.parseFloat(getComputedStyle(n).opacity) < 0.99) {
            transparente = true;
            break;
          }
        }
        if (transparente) {
          saltados += 1;
          continue;
        }

        const tinta = luz(estilo.color);
        if (tinta === null) continue;

        let fondo = null;
        for (let n = el; n !== null; n = n.parentElement) {
          const css = getComputedStyle(n).backgroundColor;
          if (opaco(css)) {
            fondo = { luz: luz(css), css };
            break;
          }
        }
        if (fondo === null || fondo.luz === null) continue;

        const px = Number.parseFloat(estilo.fontSize);
        const exigido = px >= tamanoGrande ? minimoGrande : minimo;
        const r = razon(tinta, fondo.luz);
        medidos += 1;
        if (r < exigido) {
          fallos.push({
            texto: texto.slice(0, 32),
            px: Math.round(px),
            razon: Number(r.toFixed(2)),
            exigido,
            tinta: estilo.color,
            fondo: fondo.css,
          });
        }
      }
      return { fallos, medidos, saltados };
    },
    { minimo, minimoGrande, tamanoGrande },
  );
}

/**
 * Los marcadores de cada pantalla del panel: un texto que SOLO sale ahí.
 *
 * POR QUÉ ESTÁN AQUÍ Y NO EN CADA ARNÉS
 * Los seis arneses de la demostración hacían lo mismo después de cada `goto`: esperar un
 * número fijo de milisegundos —entre 1.500 y 3.200— afinado en una máquina concreta. Eso
 * tiene dos problemas y los dos han mordido:
 *
 *   - EN UN RUNNER COMPARTIDO, MÁS LENTO, LA ESPERA SE QUEDA CORTA y el arnés mide una
 *     pantalla a medio montar. Da rojo, y el rojo no es de la app: es del reloj. Un
 *     arnés que da rojos que no son culpa de nadie se acaba ignorando, y por eso los
 *     cinco llevaban meses sin entrar en el CI.
 *   - Y CUANDO SE QUEDA CORTA SIN REVENTAR, ES PEOR: `responsive:check` midió el reloj
 *     de fichaje 84 veces creyendo que medía el panel, y dio verde. El engaño solo se
 *     destapó al exigir un marcador por pantalla.
 *
 * Así que la espera es POR EL MARCADOR y el número solo es el techo: en una máquina
 * rápida tarda lo que tarde en aparecer, y en una lenta espera más en vez de fallar.
 */
export const MARCADORES = {
  /*
   * Inicio se identifica por su `testID` y no por un texto, y eso NO es un detalle: lo
   * que pinta Inicio depende del día —«todo en orden», «faltan tres», «seis solicitudes
   * esperando»— así que cualquier texto suyo es marcador de UN escenario y no de la
   * pantalla. `inicio-check` abre los tres a propósito: con un texto, dos de los tres se
   * quedarían esperando un rótulo que ese día no sale.
   */
  '/': { testid: 'manager-home' },
  '/team': 'Agregar empleado',
  /*
   * HORARIO Y HORAS SE IDENTIFICAN POR `testID`, no por el texto de un botón, y la razón
   * la enseñó un fallo real: el marcador de Horas era «Ir a esta semana», y el día que
   * ese botón pasó a salir SOLO cuando no estás en la semana actual —un botón apagado
   * ocupa el mismo sitio que uno que sirve, y enseña una acción imposible— los arneses
   * se quedaron esperando un texto que ya no existía en la pantalla recién abierta.
   *
   * Un marcador tiene que ser lo que SIEMPRE está en esa pantalla. El texto de un control
   * no lo es: cambia con el diseño, con el idioma y con el estado. El identificador de un
   * filtro que la pantalla siempre pinta, sí.
   */
  '/schedule': { testid: 'schedule-view' },
  '/hours': { testid: 'timesheet-status-filter' },
  '/reports': 'Mide presencia, no trabajo hecho',
  '/requests': 'Correcciones de hora',
  '/settings': 'Cambia el idioma de esta app',
  /*
   * El reloj de fichaje se identifica por su teclado, y `visible` NO es adorno: hay DOS
   * teclados en el DOM —el del PIN y el de la autorización del gerente— y el segundo
   * existe desde el primer render sin verse. Esperar a que «esté» daría por montada una
   * pantalla que todavía no ha pintado nada.
   */
  '/kiosk': { testid: 'keypad-1', visible: true },
};

/** El de la pantalla de acceso, que es la única que se ve SIN sesión. */
export const MARCADOR_ACCESO = 'Para administradores y gerentes';

/** Textos que, si aparecen donde no toca, significan que se cargó otra pantalla. */
export const INTRUSOS = [
  ['la pantalla de acceso', 'Ingresa a Krealo Shift'],
  ['el reloj de fichaje', 'Ingresa tu PIN personal'],
];

/** Lo que se cargó en vez de lo que se pedía, dicho con nombre y apellido. */
export function quienSeColo(texto) {
  for (const [quien, huella] of INTRUSOS) {
    if (texto.includes(huella)) return `se cargó ${quien}`;
  }
  return 'no se sabe qué se cargó';
}

/**
 * Espera a que una pantalla esté montada DE VERDAD: hasta ver su marcador en el texto.
 *
 * `obligatorio: false` devuelve `false` en vez de reventar, para los arneses que
 * prefieren anotar «esta pantalla no se cargó» y seguir midiendo las demás: parar en la
 * primera esconde las otras seis, y un informe a medias se lee como si el resto
 * estuviera bien.
 *
 * `asentar` es el único tiempo fijo que queda, y es a propósito: entre que el marcador
 * aparece y que la pantalla termina de colocarse hay una animación de entrada, y medir
 * anchos a mitad de la animación da números que no son los de nadie. Son 300 ms sobre
 * una espera que ya sabe que la pantalla está ahí, no una apuesta sobre cuánto tarda.
 */
export async function esperarPantalla(
  pagina,
  marcador,
  { timeout = 30000, asentar = 300, obligatorio = true } = {},
) {
  try {
    if (typeof marcador === 'object' && marcador !== null) {
      await pagina
        .locator(`[data-testid="${marcador.testid}"]`)
        .first()
        .waitFor({ state: marcador.visible === true ? 'visible' : 'attached', timeout });
    } else {
      await pagina.waitForFunction((m) => (document.body?.innerText ?? '').includes(m), marcador, {
        timeout,
      });
    }
  } catch {
    if (!obligatorio) return false;
    const texto = ((await pagina.evaluate(() => document.body?.innerText ?? '')) || '').replace(
      /\s+/g,
      ' ',
    );
    const comoSeLlama =
      typeof marcador === 'object' && marcador !== null
        ? `el testID «${marcador.testid}»`
        : `el texto «${marcador}»`;
    throw new Error(
      `no se cargó la pantalla que esperaba ${comoSeLlama} en ${timeout} ms: ${quienSeColo(texto)}`,
    );
  }
  if (asentar > 0) await pagina.waitForTimeout(asentar);
  return true;
}

/**
 * Entra en el panel con el botón de la demostración, esperando por lo que hay en la
 * pantalla y no por el reloj.
 *
 * Devuelve la página lista en Inicio. Falla nombrando lo que se cargó en su lugar: un
 * arnés que se queda sin sesión y sigue midiendo la pantalla de acceso da verde sobre
 * nada, y eso ya pasó siete veces en una sola corrida.
 */
export async function entrarComoDemo(pagina, base, { ruta = '/' } = {}) {
  await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/']);
  return pagina;
}

/** `goto` a una ruta del panel esperando su marcador. Falla si carga otra pantalla. */
export async function irA(pagina, base, ruta, opciones = {}) {
  const marcador = MARCADORES[ruta];
  if (marcador === undefined) {
    throw new Error(`no hay marcador declarado para «${ruta}»: añádelo en MARCADORES`);
  }
  await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, marcador, opciones);
}

/**
 * Espera a que la página tenga algo de texto, SIN fallar si no llega.
 *
 * Para los sitios donde lo que se espera es justo lo que se está comprobando: esperar
 * por el marcador convertiría un fallo de la app —«esta pantalla sale en blanco»— en un
 * plantón del arnés, y el mensaje sería peor. Así la espera se adapta a la máquina y la
 * comprobación de después sigue siendo la que habla.
 *
 * Devuelve `true` si llegó a haber texto.
 */
export async function esperarAlgoDeTexto(pagina, minimo, { timeout = 20000 } = {}) {
  try {
    await pagina.waitForFunction(
      (n) => (document.body?.innerText ?? '').trim().length >= n,
      minimo,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}
