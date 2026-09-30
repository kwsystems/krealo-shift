#!/usr/bin/env node
/**
 * ¿SE PUEDE REGISTRAR COMO CUMPLIDA UNA SEMANA DE ANTES DEL RELOJ, Y SOLO ESAS?
 *
 * POR QUÉ EXISTE. Andree, el 30-sep: subir semana por semana los horarios de septiembre
 * y dejar registrado que todos los cumplieron, porque la app todavía no existía. Esto
 * escribe horas que se pagan sin que nadie haya fichado, así que se mide el recorrido
 * entero tal como lo va a hacer él —pegar, publicar, registrar— y los límites:
 *
 *   1. en una semana en que ya se fichaba con el reloj, el aviso NO sale: ahí un turno sin
 *      marcas es una falta, y ofrecer «registrar como cumplido» sería invitar a taparla;
 *   2. con los turnos en borrador tampoco: un borrador no existe para el reloj;
 *   3. publicados, sale con la cuenta de turnos, y la hoja dice cuántos y cuántas horas;
 *   4. un día se puede quitar —la semana del 31 de agosto empieza en agosto— y lo que
 *      se registra es exactamente lo que queda marcado;
 *   5. Horas enseña esas jornadas con sus horas y con «Según horario», no como fichadas;
 *   6. y el día que se quitó sigue pendiente: el aviso lo sigue contando.
 *
 * USO
 *   npm run demo:export
 *   node scripts/cumplido-check.mjs dist-demo
 */

import { mkdirSync } from 'node:fs';

import {
  cargarPlaywright,
  esperarPantalla,
  irA,
  MARCADORES,
  servirExport,
  sinGlifos,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2] ?? 'dist-demo';
const SEMANAS_ATRAS = 3; // la demostración siembra la semana actual y la anterior

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

const { base, cerrar } = await servirExport(DIR, 8287);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const pagina = await ctx.newPage();

const texto = async (selector) =>
  sinGlifos((await pagina.locator(selector).first().textContent()) ?? '');
const hayAviso = async () =>
  (await pagina.locator('[data-testid="schedule-worked-notice"]').count()) > 0;

try {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, { testid: 'manager-home' });
  await irA(pagina, base, '/schedule', { asentar: 600 });

  /* ---------------------------------------------------------------- 1 */
  const caso1 = 'en una semana con reloj no se ofrece';
  await pagina.waitForTimeout(800);
  if (await hayAviso()) fallar(caso1, 'la semana actual ya ficha con el reloj y el aviso salió');
  else pasa(caso1);

  for (let salto = 0; salto < SEMANAS_ATRAS; salto += 1) {
    await pagina.locator('[data-testid="week-previous"]').first().click();
    await pagina.waitForTimeout(250);
  }
  const dias = await pagina
    .locator('[data-testid^="grid-day-"]')
    .evaluateAll((nodos) =>
      nodos.map((n) => n.getAttribute('data-testid').slice('grid-day-'.length)),
    );
  const nombres = await pagina
    .locator('[data-testid^="grid-name-"]')
    .evaluateAll((nodos) =>
      nodos
        .filter((n) => n.getAttribute('data-testid') !== 'grid-name-header')
        .map((n) => n.textContent ?? ''),
    );
  const [uno, dos] = nombres.map((n) =>
    sinGlifos(n)
      .replace(/(\d{1,3}:\d{2})\s*(esta semana|this week)/, '')
      .trim(),
  );
  if (dias.length !== 7 || dos === undefined) {
    throw new Error(`la rejilla no tiene 7 días y 2 personas (${dias.length}, ${nombres.length})`);
  }

  /*
   * 11 turnos: 6 de la primera persona (descansa el lunes) y 5 de la segunda (el martes
   * una raya, el miércoles descanso). 48 h + 20 h = 68 h. El lunes solo trabaja la
   * segunda, de 17:00 a 21:00: quitar el lunes deja 10 turnos y 64 h.
   */
  const tabla = [
    `${uno}\tDESCANSO\t10:00-19:00\t11:00-20:00\t10:00-19:00\t10:00-19:00\t12:00-21:00\t13:00-22:00\t48h`,
    `${dos}\t17:00-21:00\t-\tDESCANSO\t18:30-22:00\t17:30-21:30\t18:00-22:00\t17:30-22:00\t20h`,
  ].join('\n');
  await pagina.locator('[data-testid="schedule-paste-week"]').first().click();
  await pagina.locator('[data-testid="paste-week-input"]').fill(tabla);
  await pagina.waitForTimeout(400);
  await pagina.locator('[data-testid="paste-week-confirm"]').first().click();
  await pagina.locator('[data-testid="schedule-publish-all"]').first().waitFor({ timeout: 15000 });

  /* ---------------------------------------------------------------- 2 */
  const caso2 = 'con los turnos en borrador no se ofrece';
  await pagina.waitForTimeout(600);
  if (await hayAviso()) fallar(caso2, 'salió el aviso con los 11 turnos todavía en borrador');
  else pasa(caso2);

  await pagina.locator('[data-testid="schedule-publish-all"]').first().click();
  // Se espera a que la hoja termine de abrir: un clic durante la animación se pierde.
  const publicar = pagina.locator('[data-testid="confirm-sheet-confirm"]:visible');
  await publicar.waitFor({ timeout: 10000 });
  await pagina.waitForTimeout(400);
  await publicar.click();

  /* ---------------------------------------------------------------- 3 */
  const caso3 = 'publicados, se ofrece y la hoja cuenta turnos y horas';
  try {
    await pagina.locator('[data-testid="schedule-worked-notice"]').waitFor({ timeout: 15000 });
    const aviso = await texto('[data-testid="schedule-worked-notice"]');
    await pagina.locator('[data-testid="schedule-worked-open"]').click();
    await pagina.locator('[data-testid="worked-total"]').waitFor({ timeout: 15000 });
    const total = await texto('[data-testid="worked-total"]');
    const chips = await pagina.locator('[data-testid^="worked-day-"]').count();
    if (!aviso.includes('11 turnos')) fallar(caso3, `el aviso dice «${aviso}»`);
    else if (!total.startsWith('11 turnos') || !total.includes('68:00'))
      fallar(caso3, `la hoja dice «${total}»`);
    else if (chips !== 7) fallar(caso3, `esperaba 7 días en la hoja y hay ${chips}`);
    else pasa(caso3, `«${total}»`);
  } catch (error) {
    fallar(caso3, error.message.split('\n')[0]);
  }

  /* ---------------------------------------------------------------- 4 */
  const caso4 = 'se quita un día y se registra lo que queda';
  await pagina.locator(`[data-testid="worked-day-${dias[0]}"]`).click();
  await pagina.waitForTimeout(300);
  const totalSinLunes = await texto('[data-testid="worked-total"]');
  const boton = await texto('[data-testid="worked-confirm"]');
  mkdirSync('capturas', { recursive: true });
  await pagina.screenshot({ path: 'capturas/cumplido-hoja.png' });
  await pagina.locator('[data-testid="worked-confirm"]').click();
  await pagina
    .locator('[data-testid="worked-sheet"]')
    .waitFor({ state: 'detached', timeout: 15000 });
  await pagina.waitForTimeout(600);
  const cuerpo = sinGlifos(await pagina.evaluate(() => document.body.innerText));
  if (!totalSinLunes.startsWith('10 turnos') || !totalSinLunes.includes('64:00'))
    fallar(caso4, `sin el lunes la hoja dice «${totalSinLunes}»`);
  else if (!boton.includes('Registrar 10 turnos')) fallar(caso4, `el botón dice «${boton}»`);
  else if (!cuerpo.includes('Se registraron 10 turnos como cumplidos'))
    fallar(caso4, 'no confirmó cuántos registró');
  else pasa(caso4, '10 turnos, 64:00');

  /* ---------------------------------------------------------------- 6 */
  const caso6 = 'el día quitado sigue pendiente';
  const avisoDespues = (await hayAviso())
    ? await texto('[data-testid="schedule-worked-notice"]')
    : '';
  if (!avisoDespues.includes('1 turno publicado')) fallar(caso6, `el aviso dice «${avisoDespues}»`);
  else pasa(caso6, '«1 turno publicado no tiene marcas»');
  await pagina.screenshot({ path: 'capturas/cumplido-horario.png' });

  /* ---------------------------------------------------------------- 5 */
  const caso5 = 'Horas las enseña con sus horas y «Según horario»';
  await pagina.locator('a[href="/hours"]').first().click();
  await esperarPantalla(pagina, MARCADORES['/hours']);
  for (let salto = 0; salto < SEMANAS_ATRAS; salto += 1) {
    await pagina.locator('[data-testid="week-previous"]').last().click();
    await pagina.waitForTimeout(300);
  }
  await pagina.waitForTimeout(800);
  const horas = await pagina.evaluate(() => {
    const neto = document.querySelectorAll('[data-testid="total-net"]');
    const visible = [...neto].find((n) => n.getBoundingClientRect().width > 0);
    const segun = [...document.querySelectorAll('div')].filter(
      (n) =>
        n.childElementCount === 0 &&
        n.getBoundingClientRect().width > 0 &&
        /Según horario$/.test(n.textContent ?? ''),
    ).length;
    return { neto: visible?.textContent ?? '', segun };
  });
  await pagina.screenshot({ path: 'capturas/cumplido-horas.png' });
  if (!horas.neto.includes('64:00')) fallar(caso5, `el total de la semana es «${horas.neto}»`);
  else if (horas.segun !== 10) fallar(caso5, `${horas.segun} filas dicen «Según horario», no 10`);
  else pasa(caso5, '64:00 y 10 filas «Según horario»');
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
} finally {
  await ctx.close();
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nCUMPLIDO — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nCUMPLIDO — OK: solo en semanas de antes del reloj y ya publicadas; registra lo marcado, y Horas lo dice.',
);
