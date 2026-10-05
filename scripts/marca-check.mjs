/**
 * EL LOGO DE KREALO SHIFT EN TODA LA WEB (5-oct). Andree mandó el kit de marca: «¿podrías
 * agregarlo a toda la página web?». Lo que se comprueba, en la demostración:
 *
 *   1. LA PESTAÑA: el HTML declara el ICO, el SVG, los PNG, el icono de iPhone y el
 *      manifiesto, una sola vez, y cada archivo existe y no es la página (la reescritura
 *      de Firebase devolvería `index.html` con un 200).
 *   2. CADA PANTALLA ENSEÑA SU LOGO, y la imagen se CARGÓ de verdad —un SVG que no está
 *      deja un hueco del tamaño correcto y ningún error—: acceso, cabecera del panel, manual,
 *      reloj sin activar y el celular de la vendedora.
 *   3. CLARO U OSCURO SEGÚN EL TEMA: con el tema oscuro, el logo blanco y rojo.
 *   4. EN EL TELÉFONO SOLO EL ICONO, y por debajo de 360 px ni eso: la empresa y la sede no
 *      se cortan por la marca. Y a 320, 375, 768 y 1440 px nada se sale de la pantalla.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/marca-check.mjs dist-demo
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
  servirExport,
} from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8233;

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

const { base, cerrar } = await servirExport(RAIZ, PUERTO);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

/* --------------------------------------------------------------- 1. la pestaña */
{
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
  const enlaces = [...html.matchAll(/<link[^>]+rel="(icon|apple-touch-icon|manifest)"[^>]*>/g)];
  const rutas = enlaces.map((m) => /href="([^"]+)"/.exec(m[0])?.[1]).filter(Boolean);
  const esperadas = [
    '/favicon.ico',
    '/favicon.svg',
    '/icons/favicon-32x32.png',
    '/icons/favicon-16x16.png',
    '/apple-touch-icon.png',
    '/site.webmanifest',
  ];
  const faltan = esperadas.filter((r) => !rutas.includes(r));
  const repetidas = rutas.filter((r, i) => rutas.indexOf(r) !== i);
  if (faltan.length > 0) fallar('pestaña', `el HTML no declara ${faltan.join(', ')}`);
  else if (repetidas.length > 0) fallar('pestaña', `declarados dos veces: ${repetidas.join(', ')}`);
  else pasa('pestaña', `${rutas.length} iconos y el manifiesto, una vez cada uno`);

  const manifiesto = JSON.parse(readFileSync(join(RAIZ, 'site.webmanifest'), 'utf8'));
  const iconos = (manifiesto.icons ?? []).map((i) => i.src);
  const servidos = [...esperadas, ...iconos, '/brand/svg/krealo-shift-horizontal-light.svg'];
  for (const ruta of servidos) {
    const respuesta = await fetch(base + ruta);
    const cuerpo = Buffer.from(await respuesta.arrayBuffer());
    const esHtml = cuerpo
      .subarray(0, 200)
      .toString('utf8')
      .toLowerCase()
      .includes('<!doctype html');
    if (!respuesta.ok || esHtml || cuerpo.length === 0) {
      fallar(
        'archivos',
        `${ruta} no se sirve como archivo (${respuesta.status}${esHtml ? ', llegó la página' : ''})`,
      );
    }
  }
  const mascara = (manifiesto.icons ?? []).filter((i) => i.purpose === 'maskable').length;
  if (mascara !== 2) fallar('manifiesto', `se esperaban 2 iconos maskable y hay ${mascara}`);
  else pasa('archivos', `${servidos.length} servidos como archivo; manifiesto con 2 maskable`);
}

/** ¿Hay un logo con ese testid y su imagen se cargó? */
async function logoCargado(pagina, testid) {
  const caja = pagina.locator(`[data-testid="${testid}"]`).first();
  if ((await caja.count()) === 0) return { esta: false };
  await pagina.waitForTimeout(400);
  return caja.evaluate((nodo) => {
    const img = nodo.tagName === 'IMG' ? nodo : nodo.querySelector('img');
    const r = nodo.getBoundingClientRect();
    return {
      esta: true,
      cargada: img !== null && img.complete && img.naturalWidth > 0,
      ancho: Math.round(r.width),
      alto: Math.round(r.height),
      nombre: nodo.getAttribute('aria-label'),
    };
  });
}

const desborde = (pagina) =>
  pagina.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

async function contexto(ancho, esquema) {
  const ctx = await navegador.newContext({
    viewport: { width: ancho, height: 900 },
    colorScheme: esquema,
  });
  return { ctx, pagina: await ctx.newPage() };
}

async function revisar(caso, pagina, testid) {
  const logo = await logoCargado(pagina, testid);
  if (!logo.esta) fallar(caso, `no está el logo «${testid}»`);
  else if (!logo.cargada)
    fallar(caso, `el logo «${testid}» no se cargó (hueco de ${logo.ancho}×${logo.alto})`);
  else if (logo.nombre !== 'Krealo Shift')
    fallar(caso, `el logo no se llama «Krealo Shift»: «${logo.nombre}»`);
  else pasa(caso, `${testid} ${logo.ancho}×${logo.alto}`);
  const arrastre = await desborde(pagina);
  if (arrastre > 1) fallar(caso, `la página se sale ${arrastre} px`);
}

try {
  for (const esquema of ['light', 'dark']) {
    for (const ancho of [1440, 768, 375, 320]) {
      const { ctx, pagina } = await contexto(ancho, esquema);
      const etiqueta = `${ancho}px ${esquema}`;

      // Acceso
      await pagina.goto(base + '/', { waitUntil: 'networkidle' });
      await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 300 });
      await revisar(`${etiqueta} acceso`, pagina, `sign-in-marca-horizontal-${esquema}`);

      // Panel
      await pagina.locator('[data-testid="sign-in-demo"]').click();
      await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });
      if (ancho >= 768) {
        await revisar(`${etiqueta} cabecera`, pagina, `marca-krealo-horizontal-${esquema}`);
      } else if (ancho >= 360) {
        await revisar(`${etiqueta} cabecera`, pagina, `marca-krealo-icono-${esquema}`);
      } else {
        const hay = await pagina.locator('[data-testid^="marca-krealo-"]').count();
        if (hay > 0) fallar(`${etiqueta} cabecera`, 'a menos de 360 px el icono sigue ahí');
        else pasa(`${etiqueta} cabecera`, 'sin icono: empresa y sede enteras');
      }
      if (ancho === 375 || ancho === 320) {
        const corte = await pagina
          .locator('[data-testid="scope-open"]')
          .evaluate((nodo) =>
            [...nodo.querySelectorAll('div[dir="auto"]')].some(
              (t) => t.scrollWidth > t.clientWidth + 1,
            ),
          );
        if (corte) fallar(`${etiqueta} cabecera`, 'la empresa o la sede se cortan');
      }
      await ctx.close();

      // Manual, reloj sin activar y el celular, en su propia ventana: recargar pierde la demo.
      const otra = await contexto(ancho, esquema);
      await otra.pagina.goto(base + '/manual', { waitUntil: 'networkidle' });
      await otra.pagina
        .locator('[data-testid^="marca-krealo-"]')
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => undefined);
      await revisar(`${etiqueta} manual`, otra.pagina, `marca-krealo-horizontal-${esquema}`);

      await otra.pagina.goto(base + '/kiosk', { waitUntil: 'networkidle' });
      await otra.pagina
        .locator('[data-testid="kiosk-not-set-up"]')
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => undefined);
      await revisar(`${etiqueta} reloj`, otra.pagina, `kiosk-marca-cuadrado-${esquema}`);

      await otra.pagina.goto(base + '/', { waitUntil: 'networkidle' });
      await esperarPantalla(otra.pagina, MARCADOR_ACCESO, { asentar: 300 });
      await otra.pagina.locator('[data-testid="sign-in-demo-vendedor"]').click();
      await otra.pagina.locator('[data-testid="mi-horario"]').first().waitFor({ timeout: 20000 });
      await revisar(`${etiqueta} celular`, otra.pagina, `mi-horario-marca-horizontal-${esquema}`);
      await otra.ctx.close();
    }
  }
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.log(`\n${problemas.length} problema(s):`);
  for (const problema of problemas) console.log(`  - ${problema}`);
  process.exit(1);
}
console.log(
  '\nOK: el logo está en todas las pantallas, claro u oscuro según el tema, y la pestaña lleva sus iconos.',
);
