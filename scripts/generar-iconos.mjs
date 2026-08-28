#!/usr/bin/env node
/**
 * Genera el icono, el splash y el favicon de Krealo Shift.
 *
 * POR QUE UN SCRIPT Y NO CINCO PNG SUELTOS
 * Los cinco archivos son la MISMA marca en cinco contextos con reglas distintas
 * (iOS quiere opaco y sin esquinas, Android quiere transparencia y zona segura, el
 * splash va sobre fondo claro y no sobre morado). Cinco PNG dibujados a mano se
 * desincronizan en el primer retoque; aqui hay una sola definicion geometrica.
 *
 * LOS COLORES SALEN DE src/theme/tokens.ts, no de una paleta inventada: el icono en
 * el escritorio y la pantalla de arranque tienen que ser el mismo morado que la app.
 * Se leen del archivo, asi que si cambia el token cambia el icono al regenerar.
 *
 * LA MARCA. No es un reloj generico. Es un ARCO sobre un dial —el turno, que es un
 * tramo de tiempo y no un instante— con una aguja en su final y el eje en el centro.
 * A 60x60 puntos, que es el tamano real en un iPad, sobrevive porque son tres formas
 * gruesas y nada mas: un arco, una linea y un punto.
 *
 *   node scripts/generar-iconos.mjs
 *   node scripts/generar-iconos.mjs --verificar    (no escribe; falla si hay que regenerar)
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'assets', 'images');

/** Lee un color de src/theme/tokens.ts para no duplicar la paleta. */
function token(nombre) {
  const fuente = readFileSync(join(RAIZ, 'src', 'theme', 'tokens.ts'), 'utf8');
  const m = new RegExp(`${nombre}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(fuente);
  if (m === null) throw new Error(`No encuentro el token de color ${nombre} en tokens.ts`);
  return m[1];
}

const MORADO = token('primary500');
const MORADO_OSCURO = token('primary700');
const CLARO = token('primary50');

/**
 * La geometria de la marca, en un lienzo de 1024.
 *
 * ES UN RELOJ, y la decision merece explicacion porque "reloj" suena a lo obvio.
 *
 * El primer intento fue mas ambicioso: un arco sobre un dial, el turno como tramo de
 * tiempo y no como instante, con una aguja al final. Renderizado, leia como un
 * VELOCIMETRO. Para una app de fichaje eso no es un matiz: el icono en el escritorio
 * de un iPad de tienda tiene que decir "el reloj" en un vistazo, y un velocimetro
 * dice otra cosa. Se descarto mirando la imagen, no razonando sobre ella.
 *
 * Asi que un reloj, con la distincion en la ejecucion y no en el motivo:
 *
 *   * las agujas marcan LAS NUEVE, no las 10:10 de todos los relojes de catalogo.
 *     A las nueve forman un angulo recto abierto hacia arriba y a la izquierda, una
 *     silueta asimetrica que se distingue de un reloj genterico de un vistazo, y es
 *     la hora a la que abre una tienda.
 *   * dos grosores de aguja, no uno: la de la hora mas corta y algo mas gruesa. Con
 *     el mismo grosor el angulo se lee como una flecha, no como un reloj.
 *   * sin marcas horarias. A 60x60 puntos, que es el tamano real en un iPad, doce
 *     ticks son doce manchas.
 *
 * Tres formas gruesas y nada mas: un aro y dos lineas.
 *
 * `escala` encoge la marca dentro del lienzo. Android necesita que todo lo que
 * importe quepa en el 66% central, porque el sistema recorta el resto con la forma
 * que elija el lanzador.
 */
function marca({ color, escala = 1, opacidadAro = 1 }) {
  const c = 512;
  const r = 292 * escala;
  const grosorAro = 68 * escala;

  // Coordenadas de pantalla: y crece hacia abajo, asi que "arriba" es -1 en y.
  const aguja = (grados, largo, grosor) => {
    const rad = (grados * Math.PI) / 180;
    const x = c + largo * escala * Math.cos(rad);
    const y = c + largo * escala * Math.sin(rad);
    return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
          stroke="${color}" stroke-width="${(grosor * escala).toFixed(1)}" stroke-linecap="round" />`;
  };

  return `
    <circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="none" stroke="${color}"
            stroke-opacity="${opacidadAro}" stroke-width="${grosorAro.toFixed(1)}" />
    ${aguja(180, 132, 82)}
    ${aguja(-90, 196, 68)}`;
}

function svg({ fondo, contenido }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${MORADO}" />
      <stop offset="1" stop-color="${MORADO_OSCURO}" />
    </linearGradient>
  </defs>
  ${fondo}
  ${contenido}
</svg>`;
}

/**
 * Las cinco variantes, cada una con la regla de su plataforma escrita.
 *
 * `fondoPagina` es lo que ve el navegador detras del SVG al capturar: 'transparent'
 * para los que necesitan canal alfa. iOS NO admite transparencia en el icono de la
 * app —la rellena de negro— asi que ese lleva su propio fondo dibujado.
 */
const VARIANTES = [
  {
    archivo: 'icon.png',
    tamano: 1024,
    fondoPagina: MORADO,
    // iOS: opaco, sin esquinas redondeadas propias (las pone el sistema) y la marca
    // ocupando casi todo el lienzo.
    svg: svg({
      fondo: `<rect width="1024" height="1024" fill="url(#g)" />`,
      contenido: marca({ color: CLARO }),
    }),
  },
  {
    archivo: 'splash-icon.png',
    tamano: 512,
    fondoPagina: 'transparent',
    // El splash va sobre `backgroundColor: '#F5F2FF'` (app.config.ts), o sea un fondo
    // CLARO: la marca tiene que ser morada, no blanca. Una marca blanca sobre ese
    // fondo es una pantalla de arranque en blanco, que parece que la app no arranca.
    svg: svg({
      fondo: '',
      contenido: marca({ color: MORADO }),
    }),
  },
  {
    archivo: 'android-icon-foreground.png',
    tamano: 1024,
    fondoPagina: 'transparent',
    // MORADO Y NO CLARO, y el motivo esta en app.config.ts: el `adaptiveIcon` usa
    // `backgroundColor: '#F5F2FF'`, que es casi blanco. Una marca clara sobre ese
    // fondo es un icono en blanco. Se vio comparando el PNG con la configuracion,
    // no mirando el PNG solo: aislado se veia bien.
    //
    // Y la escala: Android recorta el icono con la forma que elija el lanzador, que
    // puede ser un circulo inscrito, asi que todo lo que importe tiene que caber en
    // el 66% central.
    svg: svg({ fondo: '', contenido: marca({ color: MORADO, escala: 0.66 }) }),
  },
  {
    archivo: 'android-icon-monochrome.png',
    tamano: 1024,
    fondoPagina: 'transparent',
    // Iconos temáticos de Android 13+: el sistema recolorea, asi que aqui el color
    // solo tiene que ser opaco y uniforme. El dial va al 100% porque una opacidad
    // parcial en un icono monocromo se pierde al recolorear.
    svg: svg({
      fondo: '',
      contenido: marca({ color: '#000000', escala: 0.66 }),
    }),
  },
  {
    archivo: 'favicon.png',
    tamano: 96,
    fondoPagina: MORADO,
    // 96 y no 32: la pestaña lo reduce sola y una fuente mas grande se ve mejor en
    // pantallas de mucha densidad. La marca se agranda un poco porque a 32 px
    // efectivos el dial fino desaparece y queda solo el arco.
    svg: svg({
      fondo: `<rect width="1024" height="1024" fill="url(#g)" />`,
      contenido: marca({ color: CLARO, escala: 1.05 }),
    }),
  },
];

/** Huella de lo que produce este script, para poder verificar sin rasterizar. */
function huella() {
  const material = VARIANTES.map((v) => `${v.archivo}:${v.tamano}:${v.svg}`).join('\n');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

const SELLO = join(DESTINO, '.iconos-huella');

/**
 * Playwright puede estar en el proyecto o instalado global.
 *
 * El mismo apano que `scripts/render-check.mjs`: en esta maquina vive en
 * /opt/node22, que no esta en la ruta de resolucion del proyecto.
 */
async function cargarPlaywright() {
  // `import()` de un modulo CommonJS devuelve { default: modulo }, asi que
  // `mod.chromium` es undefined y el fallo aparece mas tarde, al llamar a
  // `.launch` de undefined. De ahi el `?? mod`.
  const abrir = async (especificador) => {
    const mod = await import(especificador);
    return mod.default ?? mod;
  };
  try {
    return await abrir('playwright');
  } catch {
    try {
      return await abrir('/opt/node22/lib/node_modules/playwright/index.js');
    } catch {
      console.error('Falta playwright. Instalalo o define NODE_PATH.');
      process.exit(2);
    }
  }
}

async function generar() {
  const pw = await cargarPlaywright();
  const browser = await pw.chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  });

  for (const variante of VARIANTES) {
    const context = await browser.newContext({
      viewport: { width: variante.tamano, height: variante.tamano },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    // `omitBackground` no basta: el propio SVG y el body pintan. Se fija el fondo de
    // la pagina a la vez, y para los transparentes se deja sin pintar nada.
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${variante.fondoPagina}">
       <div style="width:${variante.tamano}px;height:${variante.tamano}px">
         ${variante.svg.replace('width="1024" height="1024"', `width="${variante.tamano}" height="${variante.tamano}"`)}
       </div></body></html>`,
    );
    const destino = join(DESTINO, variante.archivo);
    await page.screenshot({
      path: destino,
      omitBackground: variante.fondoPagina === 'transparent',
    });
    await context.close();
    console.log(`  ${variante.archivo}  ${variante.tamano}x${variante.tamano}`);
  }

  await browser.close();
  writeFileSync(SELLO, huella() + '\n', 'utf8');
  console.log(`\n${VARIANTES.length} archivos escritos en assets/images/`);
}

function verificar() {
  const esperada = huella();
  const actual = existsSync(SELLO) ? readFileSync(SELLO, 'utf8').trim() : null;
  const faltan = VARIANTES.filter((v) => !existsSync(join(DESTINO, v.archivo))).map(
    (v) => v.archivo,
  );

  if (faltan.length > 0) {
    console.error(`Faltan iconos: ${faltan.join(', ')}\n    node scripts/generar-iconos.mjs`);
    process.exit(1);
  }
  if (actual !== esperada) {
    console.error(
      'Los iconos NO corresponden a la definicion actual del script\n' +
        `  huella esperada: ${esperada}\n  huella en disco: ${actual ?? '(ninguna)'}\n` +
        'Alguien cambio la marca o un token de color sin regenerar. Corre:\n' +
        '    node scripts/generar-iconos.mjs',
    );
    process.exit(1);
  }
  console.log(`Iconos al dia (huella ${esperada}).`);
}

if (process.argv.includes('--verificar')) verificar();
else await generar();
