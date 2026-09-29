/**
 * ¿SE LEE EL MANUAL EN UN TELÉFONO, Y SIN SESIÓN?
 *
 * POR QUÉ EXISTE. El manual tiene dos requisitos que una prueba de componente no puede
 * comprobar, y son justo los dos que se pidieron:
 *
 *   1. QUE SE ABRA SIN SESIÓN. Es un enlace que se manda al grupo de la tienda: si una
 *      guarda lo redirige al acceso, quien lo abre ve un formulario de contraseña en vez
 *      de un manual. Eso no se ve montando el componente —ahí no hay enrutador ni
 *      guardas—, hace falta abrir la dirección de verdad.
 *   2. QUE SE VEA BIEN. Se lee en el celular, de pie, con una clienta esperando. Aquí eso
 *      se mide como que NADA se arrastre en horizontal a 390 px: un manual que hay que
 *      desplazar de lado para leer una línea es un manual que no se lee.
 *
 * Y una tercera que no se pidió pero es la que más duele si falla: que el texto ESTÉ.
 * Con 59 claves de traducción nuevas, una mal escrita no rompe nada —i18next pinta la
 * clave— y el manual sale con «manual.caseForgotBody» en medio de la página.
 *
 * Y UNA CUARTA desde el 29-sep: que en pantalla ancha USE el ancho. «Sin arrastre» se
 * cumplía de sobra con una tira de 520 px en medio de un monitor de 1440, y eso es lo que
 * Andree vio y llamó «se ve mal». Ahora se mide dónde cae cada cosa: en el portátil lo
 * que va junto tiene que estar al lado, y en el teléfono, debajo. Lo mismo dentro del
 * panel (`/ayuda`), donde el menú lateral se come parte de la ventana, y ahí además sin
 * la cabecera propia del enlace abierto, que repetiría la de la app.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/manual-check.mjs dist-demo
 */
import { mkdirSync } from 'node:fs';

import {
  servirExport,
  cargarPlaywright,
  sinGlifos,
  entrarComoDemo,
  irA,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/manual-check.mjs <export-demo>');
  process.exit(2);
}

/** Lo que tiene que estar en cada parte, dicho por su texto y no por su clave. */
const EN_LA_PARTE_DE_QUIEN_FICHA = [
  'Tus cuatro marcas del día',
  'Marcar entrada',
  'Terminar descanso',
  'Olvidé marcar',
  'No hay internet en la tienda',
  'Tu PIN es tuyo',
];
const EN_LA_PARTE_DE_QUIEN_ADMINISTRA = [
  'Publicar es lo que lo hace real',
  'Montar el reloj de la tienda',
  'Bandeja',
];

/**
 * PARES QUE VAN JUNTOS en pantalla ancha: [izquierda, derecha, ¿en la misma fila?]. Las
 * dos secciones de arriba no empiezan a la misma altura —la izquierda lleva antes «Dónde
 * se marca»—, así que de ellas solo se pide que estén lado a lado.
 */
const JUNTOS = [
  ['Tus cuatro marcas del día', 'Cómo se marca, paso a paso', false],
  ['Me equivoqué en el PIN', 'Llegué antes de mi hora', true],
];

/** Dónde cae un texto del manual: la esquina de su caja, en píxeles de la ventana. */
async function dondeCae(pagina, frase) {
  return pagina.evaluate((f) => {
    const nodos = Array.from(document.querySelectorAll('[data-testid="manual-screen"] div'));
    const nodo = nodos.find((n) => n.childElementCount === 0 && (n.textContent ?? '').trim() === f);
    if (nodo === undefined) return null;
    const caja = nodo.getBoundingClientRect();
    return { x: Math.round(caja.left), y: Math.round(caja.top) };
  }, frase);
}

/** Lado a lado en pantalla ancha, uno debajo del otro en el teléfono. */
async function medirColumnas(pagina, nombre, dosColumnas) {
  for (const [izquierda, derecha, mismaFila] of JUNTOS) {
    const a = await dondeCae(pagina, izquierda);
    const b = await dondeCae(pagina, derecha);
    if (a === null || b === null) {
      problemas.push(`${nombre}: no encontré «${a === null ? izquierda : derecha}» para medirlo`);
      continue;
    }
    if (dosColumnas) {
      if (b.x - a.x < 200) {
        problemas.push(
          `${nombre}: «${derecha}» debería ir al lado de «${izquierda}» y va debajo (x ${a.x} y ${b.x})`,
        );
      } else if (mismaFila && Math.abs(a.y - b.y) > 2) {
        problemas.push(`${nombre}: «${izquierda}» y «${derecha}» no quedan en la misma fila`);
      }
    } else if (Math.abs(a.x - b.x) > 2 || b.y <= a.y) {
      problemas.push(
        `${nombre}: en una columna «${derecha}» debería ir debajo de «${izquierda}» (x ${a.x}/${b.x}, y ${a.y}/${b.y})`,
      );
    }
  }
}

const { base, cerrar } = await servirExport(DIR, 8285);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const problemas = [];

try {
  for (const [nombre, ancho, alto] of [
    ['teléfono', 390, 844],
    ['tablet', 768, 1024],
    ['portátil', 1440, 900],
  ]) {
    const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
    const pagina = await ctx.newPage();

    /*
     * DIRECTO A `/manual`, sin pasar por el acceso ni por el reloj: es exactamente lo que
     * hace quien recibe el enlace por mensaje. Si hubiera una guarda, aquí se vería.
     */
    await pagina.goto(`${base}/manual`, { waitUntil: 'networkidle' });
    await pagina.locator('[data-testid="manual-screen"]').waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(400);

    const texto = sinGlifos(await pagina.evaluate(() => document.body?.innerText ?? ''));

    if (/Ingresa tu correo|Iniciar sesión|sign-in/i.test(texto)) {
      problemas.push(`${nombre}: el manual pidió sesión en vez de abrirse`);
    }
    await medirColumnas(pagina, nombre, ancho >= 1024);

    // Una clave sin traducir se pinta tal cual: «manual.algo». Es lo que hay que cazar.
    const claveSuelta = /manual\.[a-zA-Z]+/.exec(texto);
    if (claveSuelta !== null) {
      problemas.push(`${nombre}: falta una traducción y se ve la clave «${claveSuelta[0]}»`);
    }
    for (const frase of EN_LA_PARTE_DE_QUIEN_FICHA) {
      if (!texto.includes(frase)) problemas.push(`${nombre}: no encontré «${frase}»`);
    }

    /*
     * EL ARRASTRE HORIZONTAL, medido en el documento y en cada bloque de texto. Lo
     * segundo no es redundante: un párrafo que se sale de su caja puede no mover el
     * documento —el contenedor recorta— y aun así dejar media línea sin leer.
     */
    const desborde = await pagina.evaluate(() => {
      const raiz = document.documentElement;
      const cuerpo = document.body;
      const anchoVista = raiz.clientWidth;
      const anchos = [raiz.scrollWidth, cuerpo?.scrollWidth ?? 0];
      const culpables = [];
      for (const nodo of Array.from(document.querySelectorAll('div, span, p'))) {
        const caja = nodo.getBoundingClientRect();
        if (caja.width > 0 && caja.right > anchoVista + 1) {
          culpables.push(
            `${nodo.tagName}:${Math.round(caja.right)}px «${(nodo.textContent ?? '').slice(0, 30)}»`,
          );
        }
      }
      return { anchoVista, anchos, culpables: culpables.slice(0, 3) };
    });

    if (Math.max(...desborde.anchos) > desborde.anchoVista + 1) {
      problemas.push(
        `${nombre}: la página se arrastra en horizontal (${Math.max(...desborde.anchos)} px en ${desborde.anchoVista})`,
      );
    }
    if (desborde.culpables.length > 0) {
      problemas.push(`${nombre}: algo se sale del ancho: ${desborde.culpables.join(' | ')}`);
    }

    /* La captura de la parte de quien ficha se toma ANTES de cambiar de parte: es la que
       importa mirar cuando esto falla, porque es la que abre quien recibe el enlace. */
    mkdirSync('capturas', { recursive: true });
    await pagina.screenshot({ path: `capturas/manual-${ancho}.png`, fullPage: ancho === 390 });

    // La otra parte del manual, a un toque, y con su contenido.
    await pagina.locator('[data-testid="manual-parte-administra"]').click();
    await pagina.waitForTimeout(300);
    const textoAdmin = sinGlifos(await pagina.evaluate(() => document.body?.innerText ?? ''));
    for (const frase of EN_LA_PARTE_DE_QUIEN_ADMINISTRA) {
      if (!textoAdmin.includes(frase)) {
        problemas.push(`${nombre}: en la parte de administrar no encontré «${frase}»`);
      }
    }
    if (textoAdmin.includes('Tus cuatro marcas del día')) {
      problemas.push(`${nombre}: al cambiar de parte se quedó el contenido de la anterior`);
    }

    await pagina.screenshot({
      path: `capturas/manual-${ancho}-administra.png`,
      fullPage: ancho === 390,
    });
    await ctx.close();
  }

  /*
   * DENTRO DEL PANEL, `/ayuda`: el mismo manual con el menú lateral al lado. A 1440 quedan
   * unos 1200 px de contenido, sitio de sobra para las dos columnas. Y sin la cabecera del
   * enlace abierto —«Krealo Shift» y el selector de idioma—: la app ya los tiene alrededor.
   */
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await ctx.newPage();
  await entrarComoDemo(pagina, base);
  await irA(pagina, base, '/ayuda');
  await pagina.waitForTimeout(400);
  await medirColumnas(pagina, 'panel', true);
  const cabeceraRepetida = await pagina.evaluate(
    () =>
      document.querySelector('[data-testid="manual-screen"] [data-testid="language-switch"]') !==
      null,
  );
  if (cabeceraRepetida) {
    problemas.push('panel: el manual repite su propia cabecera con selector de idioma');
  }
  await pagina.screenshot({ path: 'capturas/manual-panel-1440.png' });
  await ctx.close();
} catch (error) {
  problemas.push(`el arnés no pudo completar la medida: ${error.message}`);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error('MANUAL — FALLA');
  for (const problema of problemas) console.error(`  · ${problema}`);
  process.exit(1);
}
console.log(
  'MANUAL — OK: abre sin sesión, sin arrastre horizontal y con su texto, a 390, 768 y 1440; a dos columnas en pantalla ancha, también dentro del panel.',
);
