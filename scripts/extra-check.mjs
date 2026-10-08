#!/usr/bin/env node
/**
 * ¿LAS HORAS EXTRA SON LAS QUE APRUEBA QUIEN GESTIONA, Y SOLO ESAS?
 *
 * POR QUÉ EXISTE. Andree, el 30-sep, mirando Reportes: salían horas extra porque la gente
 * marca unos minutos antes o después, y «entrar 10 minutos antes es normal, hasta 15; eso
 * no es hora extra. Contarlo sí, pero no como extra. La hora extra es cuando yo veo que
 * esa persona marcó dos horas de más, y ahí quien gestiona dice: esto cuenta». Se mide el
 * recorrido entero en un navegador:
 *
 *   1. sin nada aprobado no hay ni un minuto de extra, aunque haya jornadas de más de 8 h,
 *      y todo lo trabajado sigue contando como regular;
 *   2. la fila de quien trabajó de más dice «Posible hora extra» con cuánto;
 *   3. un valor que no se entiende no se guarda y dice por qué;
 *   4. aprobar una hora la suma a la extra y la quita de las regulares, y la fila lo dice;
 *   5. Reportes cuenta la misma hora;
 *   6. quitarla la devuelve a cero;
 *   7. y Ajustes tiene el umbral del aviso, no el de las 8 h.
 *
 * USO
 *   npm run demo:export
 *   node scripts/extra-check.mjs dist-demo
 */

import { mkdirSync } from 'node:fs';

import {
  cargarPlaywright,
  entrarComoDemo,
  esperarPantalla,
  irA,
  MARCADORES,
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

/** «Horas netas80:03» → 80:03. El rótulo y el número van en el mismo nodo de texto. */
const cifra = (texto) => /(\d{1,3}:\d{2})\s*$/.exec(sinGlifos(texto ?? ''))?.[1] ?? null;
const aMinutos = (hhmm) => {
  const [h, m] = (hhmm ?? '0:0').split(':').map(Number);
  return h * 60 + m;
};

const { base, cerrar } = await servirExport(DIR, 8291);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
const pagina = await ctx.newPage();

const totales = async () => ({
  neto: cifra(await pagina.locator('[data-testid="total-net"]').first().textContent()),
  extra: cifra(await pagina.locator('[data-testid="total-overtime"]').first().textContent()),
  regular: cifra(
    await pagina
      .locator('[data-testid="total-net"]')
      .first()
      .locator('xpath=following::*[contains(., "Regulares")][1]')
      .textContent(),
  ),
});

try {
  await entrarComoDemo(pagina, base);
  await irA(pagina, base, '/hours');
  await pagina.waitForTimeout(1200);

  /* ---------------------------------------------------------------- 1 */
  const caso1 = 'sin aprobar no hay extra, aunque haya jornadas largas';
  const antes = await totales();
  const larga = await pagina.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="session-"]')].some((fila) => {
      const cifras = (fila.textContent ?? '').match(/\b(\d{2}):(\d{2})\b/g) ?? [];
      return cifras.some((c) => Number(c.slice(0, 2)) >= 8 && Number(c.slice(0, 2)) < 24);
    }),
  );
  if (antes.extra !== '00:00') fallar(caso1, `la extra de la semana es ${antes.extra}`);
  else if (antes.regular !== antes.neto)
    fallar(caso1, `regulares ${antes.regular} y netas ${antes.neto} no son lo mismo`);
  else pasa(caso1, `netas ${antes.neto}, extra 00:00${larga ? ', con jornadas de 8 h o más' : ''}`);

  /* ---------------------------------------------------------------- 2 */
  const caso2 = 'quien trabajó de más sale como posible hora extra';
  const posible = pagina.locator('[data-testid^="session-"]', { hasText: 'Posible hora extra' });
  const cuantas = await posible.count();
  if (cuantas === 0) throw new Error('ninguna fila dice «Posible hora extra» en la demostración');
  const etiqueta = sinGlifos(
    (await posible
      .first()
      .getByText(/Posible hora extra/)
      .first()
      .textContent()) ?? '',
  );
  pasa(caso2, `${cuantas} fila(s); la primera «${etiqueta}»`);

  /* ---------------------------------------------------------------- 3 */
  const caso3 = 'un valor que no se entiende no se guarda';
  await posible.first().click();
  await pagina.locator('[data-testid="overtime-section"]').waitFor({ timeout: 15000 });
  mkdirSync('capturas', { recursive: true });
  await pagina.screenshot({ path: 'capturas/extra-hoja.png' });
  const propuesto = await pagina.locator('[data-testid="overtime-input"]').inputValue();
  // «1.5» ya se entiende (8-oct): hora y media, y la hoja lo dice antes de guardar.
  await pagina.locator('[data-testid="overtime-input"]').fill('1.5');
  const leido = await pagina
    .locator('[data-testid="overtime-read-as"]')
    .innerText()
    .catch(() => '');
  if (!/1 h 30 min/.test(leido)) fallar(caso3, `«1.5» no se lee como 1 h 30 min: «${leido}»`);
  await pagina.locator('[data-testid="overtime-input"]').fill('una hora');
  await pagina.locator('[data-testid="overtime-save"]').click();
  await pagina.waitForTimeout(400);
  const hoja = sinGlifos(await pagina.locator('[data-testid="overtime-section"]').innerText());
  if (!/Escribe horas \(1, 1:30\)/.test(hoja)) fallar(caso3, 'no explicó cómo escribirlo');
  else if ((await pagina.locator('[data-testid="overtime-section"]').count()) === 0)
    fallar(caso3, 'la hoja se cerró como si se hubiera guardado');
  else pasa(caso3, `el campo venía con «${propuesto}», lo trabajado de más`);

  /* ---------------------------------------------------------------- 4 */
  const caso4 = 'aprobar una hora la pasa de regular a extra';
  await pagina.locator('[data-testid="overtime-input"]').fill('1:00');
  await pagina.locator('[data-testid="overtime-save"]').click();
  await pagina
    .locator('[data-testid="overtime-section"]')
    .waitFor({ state: 'detached', timeout: 15000 });
  await pagina.waitForTimeout(800);
  const despues = await totales();
  const badge = await pagina
    .locator('[data-testid^="session-"]', { hasText: 'Hora extra 01:00' })
    .count();
  await pagina.screenshot({ path: 'capturas/extra-horas.png' });
  if (despues.extra !== '01:00') fallar(caso4, `la extra de la semana es ${despues.extra}`);
  else if (aMinutos(despues.regular) !== aMinutos(despues.neto) - 60)
    fallar(caso4, `regulares ${despues.regular} con netas ${despues.neto}: no se restó la hora`);
  else if (badge !== 1) fallar(caso4, `${badge} filas dicen «Hora extra 01:00»`);
  else pasa(caso4, `extra 01:00, regulares ${despues.regular} de ${despues.neto}`);

  /* ---------------------------------------------------------------- 5 */
  const caso5 = 'Reportes cuenta la misma hora';
  await pagina.locator('a[href="/reports"]').first().click();
  await esperarPantalla(pagina, MARCADORES['/reports']);
  await pagina.waitForTimeout(1200);
  const enReportes = cifra(
    await pagina.locator('[data-testid="report-overtime"]').first().textContent(),
  );
  await pagina.screenshot({ path: 'capturas/extra-reportes.png' });
  if (enReportes !== '01:00') fallar(caso5, `Reportes dice ${enReportes}`);
  else pasa(caso5);

  /* ---------------------------------------------------------------- 6 */
  const caso6 = 'quitarla la devuelve a cero';
  await pagina.locator('a[href="/hours"]').first().click();
  await esperarPantalla(pagina, MARCADORES['/hours']);
  await pagina.waitForTimeout(600);
  await pagina
    .locator('[data-testid^="session-"]', { hasText: 'Hora extra 01:00' })
    .first()
    .click();
  await pagina.locator('[data-testid="overtime-remove"]').click();
  await pagina
    .locator('[data-testid="overtime-section"]')
    .waitFor({ state: 'detached', timeout: 15000 });
  await pagina.waitForTimeout(800);
  const alFinal = await totales();
  if (alFinal.extra !== '00:00') fallar(caso6, `después de quitarla la extra es ${alFinal.extra}`);
  else pasa(caso6);

  /* ---------------------------------------------------------------- 7 */
  const caso7 = 'Ajustes tiene el aviso, no el umbral de 8 h';
  await pagina.locator('a[href="/settings"]').first().click();
  await esperarPantalla(pagina, MARCADORES['/settings']);
  const ajustes = sinGlifos(await pagina.evaluate(() => document.body.innerText));
  const abrir = pagina.locator('[data-testid="location-card"]').first();
  await abrir.click().catch(() => {});
  await pagina.waitForTimeout(600);
  const conTarjeta = sinGlifos(await pagina.evaluate(() => document.body.innerText));
  if (/Umbral diario de horas extra/.test(ajustes + conTarjeta))
    fallar(caso7, 'sigue el «Umbral diario de horas extra»');
  else if (!/Avisar de posible hora extra desde/.test(conTarjeta))
    fallar(caso7, 'no encontré «Avisar de posible hora extra desde»');
  else pasa(caso7);

  /* ---------------------------------------------------------------- 8 */
  /*
   * APROBAR EL PERIODO (30-sep). Nunca había funcionado en la tienda —el panel no podía ni
   * crear el periodo— y el aviso decía «Hay fichajes que necesitan revisión» fuera cual
   * fuera el error. La semana en curso tiene gente dentro: tiene que negarse diciendo
   * quién. La anterior está cerrada: reabrir y aprobar tiene que funcionar.
   */
  const caso8 = 'aprobar el periodo dice quién tiene la jornada abierta, y si no hay, aprueba';
  await irA(pagina, base, '/hours', { asentar: 800 });
  await pagina.locator('[data-testid="timesheet-approve"]').first().click();
  const aviso = pagina.locator('[data-testid="timesheet-approve-error"]');
  await aviso.waitFor({ timeout: 10000 }).catch(() => undefined);
  const dice = sinGlifos((await aviso.textContent().catch(() => '')) ?? '');
  if (/necesitan revisión/.test(dice)) fallar(caso8, `sigue el aviso genérico: «${dice}»`);
  else if (!/jornada abierta|jornadas? abiertas?/.test(dice) || !/\p{L}{3,}/u.test(dice))
    fallar(caso8, `con gente dentro el aviso dice «${dice}»`);
  else {
    await pagina.locator('[data-testid="week-previous"]').first().click();
    await pagina.waitForTimeout(1200);
    const reabrir = pagina.locator('[data-testid="timesheet-reopen"]');
    if ((await reabrir.count()) > 0) {
      await reabrir.first().click();
      await pagina.locator('[data-testid="timesheet-approve"]').waitFor({ timeout: 10000 });
    }
    await pagina.locator('[data-testid="timesheet-approve"]').first().click();
    const aprobado = await pagina
      .locator('[data-testid="timesheet-reopen"]')
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    const errorAnterior = await pagina.locator('[data-testid="timesheet-approve-error"]').count();
    if (!aprobado || errorAnterior > 0) fallar(caso8, 'la semana anterior, cerrada, no se aprobó');
    else pasa(caso8, `«${dice.slice(0, 90)}…»`);
  }
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
} finally {
  await ctx.close();
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nEXTRA — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nEXTRA — OK: sin aprobar no hay extra, se avisa de la posible, se aprueba, cuadra con Reportes y se quita; y el periodo se aprueba o dice quién lo impide.',
);
