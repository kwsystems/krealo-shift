#!/usr/bin/env node
/**
 * ÓRDENES DE SHOPIFY POR HORA (13-nov): Reportes enseña el mapa de día × hora y su análisis,
 * y Ajustes deja conectar y desconectar la tienda.
 *
 *   1. Reportes → Mes: el mapa tiene casillas, el total dice las órdenes y el análisis dice
 *      la hora punta. Y la hora punta es la casilla con el número más alto del mapa: los dos
 *      salen de `analizarOrdenes`, y si dijeran cosas distintas una de las dos mentiría.
 *   2. «Por persona en turno» cambia el mapa.
 *   3. En el teléfono el mapa se desliza dentro de su tarjeta, no la página.
 *   4. Ajustes → Shopify: conectada; desconectar enseña el formulario; conectar la vuelve a
 *      dejar conectada.
 *   5. «Traer el último año» responde con cuántas órdenes trajo.
 *   6. Un mes con órdenes y sin fichajes enseña el mapa debajo del aviso de vacío, sin el
 *      selector «por persona» ni el plan de personal (no hay turnos con que compararlas).
 *
 * Uso: node scripts/ordenes-check.mjs <export-demo>
 */

import { mkdirSync } from 'node:fs';

import {
  cargarPlaywright,
  entrarComoDemo,
  irA,
  servirExport,
  sinGlifos,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2] ?? 'dist-demo';

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

const { base, cerrar } = await servirExport(DIR, 8297);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
mkdirSync('capturas', { recursive: true });

/** Los números de las casillas del mapa, por su testID `orders-cell-{día}-{hora}`. */
async function casillas(pagina) {
  return pagina.locator('[data-testid^="orders-cell-"]:visible').evaluateAll((nodos) =>
    nodos.map((n) => {
      const [dia, hora] = (n.getAttribute('data-testid') ?? '').split('-').slice(2).map(Number);
      const texto = (n.innerText || '').trim();
      return { dia, hora, texto, valor: Number(texto.replace(',', '.')) || 0 };
    }),
  );
}

async function reportesDelMes(pagina) {
  await irA(pagina, base, '/reports', { asentar: 600 });
  await pagina.locator('[data-testid="report-period-mes"]').click();
  await pagina.waitForTimeout(800);
  await pagina.locator('[data-testid="chart-orders"]').scrollIntoViewIfNeeded();
}

try {
  /* ---------------------------------------------------------------- 1 */
  const caso1 = 'Reportes → Mes: el mapa, el total y la hora punta';
  const ancho = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const pagina = await ancho.newPage();
  await entrarComoDemo(pagina, base);
  await reportesDelMes(pagina);
  const todas = await casillas(pagina);
  const total = sinGlifos(
    (await pagina
      .locator('[data-testid="orders-total"]')
      .textContent()
      .catch(() => '')) ?? '',
  );
  const punta = sinGlifos(
    (await pagina
      .locator('[data-testid="orders-insight-peak"]')
      .textContent()
      .catch(() => '')) ?? '',
  );
  const maxima = todas.reduce((m, c) => (c.valor > m.valor ? c : m), { valor: -1 });
  await pagina
    .locator('[data-testid="chart-orders"]')
    .screenshot({ path: 'capturas/ordenes-reportes.png' });
  if (todas.length < 30) fallar(caso1, `el mapa tiene ${todas.length} casillas`);
  else if (!/\d+ órdenes/.test(total)) fallar(caso1, `el total dice «${total}»`);
  else if (!/La hora punta es el/.test(punta)) fallar(caso1, `el análisis dice «${punta}»`);
  else if (!punta.includes(`${String(maxima.hora).padStart(2, '0')}:00`)) {
    fallar(
      caso1,
      `la hora punta dice «${punta}» y la casilla más alta es la de las ${maxima.hora}`,
    );
  } else pasa(caso1, `${todas.length} casillas; «${punta}»`);

  /* ---------------------------------------------------------------- 2 */
  const caso2 = '«Por persona en turno» cambia el mapa';
  const antes = todas.map((c) => c.texto).join('|');
  await pagina.locator('[data-testid="orders-mode-porPersona"]').click();
  await pagina.waitForTimeout(400);
  const despues = (await casillas(pagina)).map((c) => c.texto).join('|');
  if (despues === antes) fallar(caso2, 'el mapa sigue igual');
  else pasa(caso2);
  await ancho.close();

  /* ---------------------------------------------------------------- 3 */
  const caso3 = 'en el teléfono el mapa se desliza dentro de su tarjeta';
  const telefono = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const enTelefono = await telefono.newPage();
  await entrarComoDemo(enTelefono, base);
  await reportesDelMes(enTelefono);
  const arrastre = await enTelefono.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await enTelefono
    .locator('[data-testid="chart-orders"]')
    .screenshot({ path: 'capturas/ordenes-telefono.png' });
  if (arrastre > 1) fallar(caso3, `la página se arrastra ${arrastre} px de lado`);
  else pasa(caso3);
  await telefono.close();

  /* ---------------------------------------------------------------- 4 */
  const caso4 = 'Ajustes → Shopify: desconectar y volver a conectar';
  const ajustes = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const enAjustes = await ajustes.newPage();
  await entrarComoDemo(enAjustes, base);
  await irA(enAjustes, base, '/settings', { asentar: 600 });
  await enAjustes.locator('[data-testid="shopify-card"]').getByRole('button').first().click();
  await enAjustes.waitForTimeout(400);
  const conectada = await enAjustes.locator('[data-testid="shopify-connected"]').count();
  if (conectada === 0) {
    fallar(caso4, 'la demostración no sale conectada');
  } else {
    await enAjustes.locator('[data-testid="shopify-disconnect"]').click();
    await enAjustes.locator('[data-testid="shopify-shop"]').waitFor({ timeout: 8000 });
    await enAjustes.locator('[data-testid="shopify-shop"]').fill('mitienda.myshopify.com');
    await enAjustes.locator('[data-testid="shopify-client-id"]').fill('id-de-prueba');
    await enAjustes.locator('[data-testid="shopify-client-secret"]').fill('secreto-de-prueba');
    await enAjustes
      .locator('[data-testid="shopify-card"]')
      .screenshot({ path: 'capturas/ordenes-ajustes.png' });
    await enAjustes.locator('[data-testid="shopify-connect"]').click();
    const vuelta = await enAjustes
      .locator('[data-testid="shopify-connected"]')
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!vuelta) fallar(caso4, 'tras conectar no dice que está conectada');
    else pasa(caso4);

    /* ---------------------------------------------------------------- 5 */
    // «Traer el último año» (13-nov): con la tienda conectada, el botón dice cuánto trajo.
    const caso5 = 'Ajustes → Shopify: traer el último año';
    await enAjustes.locator('[data-testid="shopify-history"]').click();
    const listo = await enAjustes
      .locator('[data-testid="shopify-history-done"]')
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!listo) fallar(caso5, 'el botón no dice cuántas órdenes trajo');
    else
      pasa(
        caso5,
        sinGlifos(await enAjustes.locator('[data-testid="shopify-history-done"]').innerText()),
      );
  }
  await ajustes.close();

  /* ---------------------------------------------------------------- 6 */
  const caso6 = 'Un mes sin fichajes enseña las órdenes solas';
  const atras = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const enAtras = await atras.newPage();
  await entrarComoDemo(enAtras, base);
  await reportesDelMes(enAtras);
  let meses = 0;
  // Hacia atrás hasta el primer mes sin fichajes; la demo siembra un año de órdenes.
  while (meses < 12 && (await enAtras.locator('[data-testid="orders-no-shifts"]').count()) === 0) {
    await enAtras.locator('[data-testid="month-previous"]').click();
    await enAtras.waitForTimeout(700);
    meses += 1;
  }
  const aviso = await enAtras.locator('[data-testid="orders-no-shifts"]').count();
  if (aviso === 0) {
    fallar(caso6, 'en 12 meses hacia atrás ninguno enseña las órdenes sin fichajes');
  } else {
    const totalSolo = sinGlifos(
      (await enAtras.locator('[data-testid="orders-total"]').textContent()) ?? '',
    );
    const selector = await enAtras.locator('[data-testid="orders-mode"]').count();
    const plan = await enAtras.locator('[data-testid="orders-staffing"]').count();
    const nadie = await enAtras.locator('[data-testid="orders-insight-nobody"]').count();
    await enAtras
      .locator('[data-testid="chart-orders"]')
      .screenshot({ path: 'capturas/ordenes-sin-fichajes.png' });
    if (!/\d+ órdenes/.test(totalSolo)) fallar(caso6, `el total dice «${totalSolo}»`);
    else if (selector + plan + nadie > 0)
      fallar(caso6, 'sin fichajes sigue hablando de quién estaba en turno');
    else pasa(caso6, `${meses} mes(es) atrás: «${totalSolo}»`);
  }
  await atras.close();
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s).`);
  process.exit(1);
}
console.log('\nÓrdenes por hora: todo en su sitio.');
