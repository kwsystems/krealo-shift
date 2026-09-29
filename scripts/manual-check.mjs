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
 * Uso:
 *   npm run demo:export
 *   node scripts/manual-check.mjs dist-demo
 */
import { mkdirSync } from 'node:fs';

import { servirExport, cargarPlaywright, sinGlifos } from './lib/arnes-web.mjs';

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
  'MANUAL — OK: abre sin sesión, sin arrastre horizontal y con su texto, a 390, 768 y 1440.',
);
