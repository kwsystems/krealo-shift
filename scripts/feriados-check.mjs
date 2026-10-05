#!/usr/bin/env node
/**
 * ¿SE VEN LOS FERIADOS DEL PERÚ DONDE SE MIRA UN DÍA?
 *
 * POR QUÉ EXISTE. Andree, el 30-sep: «reconoce los feriados peruanos, siempre, para los
 * vendedores cuando ven su horario y para nosotros en el panel». Cuáles son lo prueban
 * las pruebas de `src/domain/feriados-peru.ts` contra el calendario oficial; aquí se mira
 * que SALGAN, en un navegador:
 *
 *   1. en la cabecera de la rejilla de Horario, en la columna del día y con su nombre;
 *   2. en el teléfono, en la lista de días de Horario;
 *   3. en la vista del vendedor, si su semana o la siguiente tiene uno;
 *   4. y en Reportes → Mes, lo trabajado en feriados, en el último mes que tuvo alguno;
 *   5. (5-oct) con su regla de pago: «Pago triple si se trabaja» bajo el feriado;
 *   6. (5-oct) el tipo de tienda de Ajustes: elegida «Juguetería», Horario marca sus fechas
 *      con más clientes (Halloween, Black Friday, Navidad…) en la columna de su día.
 *
 * La demostración está en Lima. Se avanza semana a semana hasta el próximo feriado, y no a
 * una fecha fija: el arnés tiene que pasar hoy y dentro de tres meses.
 *
 * USO
 *   npm run demo:export
 *   node scripts/feriados-check.mjs dist-demo
 */

import { mkdirSync } from 'node:fs';

import {
  cargarPlaywright,
  entrarComoDemo,
  esperarPantalla,
  irA,
  MARCADOR_ACCESO,
  servirExport,
  sinGlifos,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2] ?? 'dist-demo';
/** Entre dos feriados del Perú nunca hay más de 16 semanas (de Año Nuevo a Semana Santa). */
const SEMANAS_COMO_MUCHO = 20;

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

const { base, cerrar } = await servirExport(DIR, 8293);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
mkdirSync('capturas', { recursive: true });

/** Avanza en Horario hasta la primera semana con un feriado visible. */
async function hastaElProximoFeriado(pagina) {
  for (let semana = 0; semana <= SEMANAS_COMO_MUCHO; semana += 1) {
    const visibles = await pagina.locator('[data-testid^="feriado-"]:visible').count();
    if (visibles > 0) return semana;
    await pagina.locator('[data-testid="week-next"]').first().click();
    await pagina.waitForTimeout(250);
  }
  return null;
}

try {
  /* ---------------------------------------------------------------- 1 */
  const caso1 = 'la rejilla de Horario marca el feriado en su columna';
  const ancho = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await ancho.newPage();
  await entrarComoDemo(pagina, base);
  await irA(pagina, base, '/schedule', { asentar: 600 });
  const semanas = await hastaElProximoFeriado(pagina);
  if (semanas === null) {
    fallar(caso1, `en ${SEMANAS_COMO_MUCHO} semanas no apareció ningún feriado`);
  } else {
    const chip = pagina.locator('[data-testid^="feriado-"]:visible').first();
    const fecha = (await chip.getAttribute('data-testid')).slice('feriado-'.length);
    const texto = sinGlifos((await chip.textContent()) ?? '');
    const enSuColumna = await pagina
      .locator(`[data-testid="grid-day-${fecha}"] [data-testid="feriado-${fecha}"]`)
      .count();
    await pagina.screenshot({ path: 'capturas/feriados-horario.png' });
    if (!/^Feriado · \S/.test(texto)) fallar(caso1, `el rótulo dice «${texto}»`);
    else if (enSuColumna !== 1)
      fallar(caso1, `el feriado del ${fecha} no está en la cabecera de su día`);
    else pasa(caso1, `${fecha}: «${texto}», ${semanas} semana(s) adelante`);

    const caso5 = 'el feriado dice su regla de pago';
    const pago = pagina.locator(`[data-testid="feriado-pago-${fecha}"]:visible`).first();
    const textoDelPago = (await pago.count()) === 0 ? '' : ((await pago.textContent()) ?? '');
    if (!/Pago triple si se trabaja/.test(textoDelPago))
      fallar(caso5, `bajo el feriado del ${fecha} dice «${textoDelPago}»`);
    else pasa(caso5, `«${textoDelPago}»`);
  }
  await ancho.close();

  /* ---------------------------------------------------------------- 2 */
  const caso2 = 'en el teléfono, la lista de días de Horario también';
  const telefono = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const enTelefono = await telefono.newPage();
  await entrarComoDemo(enTelefono, base);
  await irA(enTelefono, base, '/schedule', { asentar: 600 });
  const semanasTelefono = await hastaElProximoFeriado(enTelefono);
  if (semanasTelefono === null) fallar(caso2, 'no apareció ningún feriado');
  else {
    const arrastre = await enTelefono.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await enTelefono.screenshot({ path: 'capturas/feriados-telefono.png' });
    if (arrastre > 1) fallar(caso2, `la página se arrastra ${arrastre} px de lado`);
    else pasa(caso2);
  }
  await telefono.close();

  /* ---------------------------------------------------------------- 3 */
  const caso3 = 'el vendedor lo ve en su semana';
  const vendedor = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const suPagina = await vendedor.newPage();
  await suPagina.goto(`${base}/`, { waitUntil: 'networkidle' });
  await esperarPantalla(suPagina, MARCADOR_ACCESO, { asentar: 0 });
  await suPagina.locator('[data-testid="sign-in-demo-vendedor"]').click();
  await suPagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
  await suPagina.waitForTimeout(600);
  let vistos = await suPagina.locator('[data-testid^="feriado-"]:visible').count();
  if (vistos === 0) {
    await suPagina.locator('[data-testid="mi-horario-semana-proxima"]').click();
    await suPagina.waitForTimeout(500);
    vistos = await suPagina.locator('[data-testid^="feriado-"]:visible').count();
  }
  if (semanas !== null && semanas <= 1 && vistos === 0) {
    fallar(caso3, 'hay un feriado esta semana o la siguiente y su vista no lo marca');
  } else if (vistos > 0) {
    await suPagina.screenshot({ path: 'capturas/feriados-vendedor.png', fullPage: true });
    pasa(caso3, `${vistos} día(s) marcados`);
  } else {
    pasa(caso3, `no hay feriado en sus dos semanas (el próximo está a ${semanas} semanas)`);
  }
  await vendedor.close();

  /* ---------------------------------------------------------------- 4 */
  const caso4 = 'Reportes → Mes cuenta lo trabajado en feriados';
  const reportes = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const enReportes = await reportes.newPage();
  await entrarComoDemo(enReportes, base);
  await irA(enReportes, base, '/reports', { asentar: 600 });
  await enReportes.locator('[data-testid="report-period-mes"]').click();
  await enReportes.waitForTimeout(800);
  let casilla = 0;
  for (let mes = 0; mes < 5 && casilla === 0; mes += 1) {
    casilla = await enReportes.locator('[data-testid="report-holidays"]').count();
    if (casilla === 0) {
      // Hacia ATRÁS: Reportes no deja ir a meses que aún no llegan, y entre dos meses
      // seguidos del Perú casi siempre hay alguno con feriado (septiembre no tiene).
      await enReportes.locator('[data-testid="month-previous"]').first().click();
      await enReportes.waitForTimeout(800);
    }
  }
  /*
   * LA CASILLA SOLO SALE EN UN MES CON DATOS Y CON FERIADO, y la demostración siembra solo
   * dos semanas: casi nunca coinciden con un feriado. Si no hay ninguno así, se dice y no se
   * da por fallo; la cuenta la prueba `minutosEnFeriados` en `aggregate.test.ts`. Lo que sí
   * se exige: si sale, dice lo que tiene que decir.
   */
  if (casilla === 0) {
    pasa(caso4, 'la demostración no tiene ningún mes con datos y feriado; lo cubre aggregate.test');
  } else {
    const texto = sinGlifos(
      (await enReportes.locator('[data-testid="report-holidays"]').first().textContent()) ?? '',
    );
    if (!/Trabajado en feriados/.test(texto) || !/\d{2}:\d{2}/.test(texto))
      fallar(caso4, `la casilla dice «${texto}»`);
    else pasa(caso4, `«${texto}»`);
  }
  await reportes.close();

  /* ---------------------------------------------------------------- 6 */
  const caso6 = 'con «Juguetería» en Ajustes, Horario marca sus fechas con más clientes';
  const tienda = await navegador.newContext({ viewport: { width: 1440, height: 1600 } });
  const enTienda = await tienda.newPage();
  await entrarComoDemo(enTienda, base);
  await irA(enTienda, base, '/schedule', { asentar: 600 });
  const antes = await enTienda.locator('[data-testid^="fecha-comercial-"]').count();
  await irA(enTienda, base, '/settings');
  // Las tarjetas de Ajustes son plegables y arrancan cerradas: ver `empresas-check`.
  const titulo = enTienda.getByText('Organización', { exact: true }).first();
  if (await titulo.isVisible().catch(() => false)) await titulo.click();
  await enTienda.locator('[data-testid="org-store-type-jugueteria"]').click();
  const avance = sinGlifos(
    (await enTienda.locator('[data-testid="org-store-type-preview"]').textContent()) ?? '',
  );
  await enTienda.locator('[data-testid="org-save"]').click();
  await enTienda.waitForTimeout(800);
  await irA(enTienda, base, '/schedule', { asentar: 600 });
  let marcadas = 0;
  for (let semana = 0; semana <= SEMANAS_COMO_MUCHO && marcadas === 0; semana += 1) {
    marcadas = await enTienda.locator('[data-testid^="fecha-comercial-"]:visible').count();
    if (marcadas === 0) {
      await enTienda.locator('[data-testid="week-next"]').first().click();
      await enTienda.waitForTimeout(250);
    }
  }
  if (antes !== 0) fallar(caso6, `sin tipo de tienda ya salían ${antes} fechas comerciales`);
  else if (!/Día del Niño|Halloween|Navidad|Reyes|Black Friday/.test(avance))
    fallar(caso6, `Ajustes no enseña qué fechas marcará: «${avance}»`);
  else if (marcadas === 0)
    fallar(caso6, `en ${SEMANAS_COMO_MUCHO} semanas Horario no marcó ninguna fecha comercial`);
  else {
    const chip = enTienda.locator('[data-testid^="fecha-comercial-"]:visible').first();
    const dia = (await chip.getAttribute('data-testid')).slice('fecha-comercial-'.length);
    const enSuColumna = await enTienda
      .locator(`[data-testid="grid-day-${dia}"] [data-testid="fecha-comercial-${dia}"]`)
      .count();
    const texto = sinGlifos((await chip.textContent()) ?? '');
    await enTienda.screenshot({ path: 'capturas/fechas-comerciales-horario.png' });
    if (enSuColumna !== 1) fallar(caso6, `la fecha del ${dia} no está en la cabecera de su día`);
    else pasa(caso6, `${dia}: «${texto}»`);
  }
  await tienda.close();
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nFERIADOS — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nFERIADOS — OK: Horario los marca en su día con su pago, en el teléfono también, el vendedor los ve, Reportes los cuenta y el tipo de tienda marca sus fechas.',
);
