#!/usr/bin/env node
/**
 * ¿APROBAR UN «OLVIDÉ MARCAR» EN LA BANDEJA HACE ALGO, Y SE VE?
 *
 * POR QUÉ EXISTE. Andree, el 30-sep: «apruebo un request de que alguien se olvidó de
 * marcar y no sale nada, no se borra». En producción aprobar fallaba siempre —las reglas
 * no dejan tocar una solicitud desde la app y la función del servidor no existía— y la
 * pantalla no decía nada. En la demostración funcionaba, porque la demostración aceptaba
 * la escritura directa: EL ARNÉS DE ENTONCES HABRÍA DADO VERDE. Ahora las dos pasan por la
 * misma función y esto recorre, en un navegador:
 *
 *   1. las solicitudes enseñan su hora y su día, no «--:--»;
 *   2. aprobar abre la hoja con la hora propuesta ya puesta;
 *   3. una hora mal escrita se dice en la hoja y no se envía;
 *   4. un fichaje que no cabe se dice en la hoja, con qué hacer, y la solicitud sigue ahí;
 *   5. aprobar bien la quita de pendientes y dice que quedó registrada;
 *   6. en «Todos» sale como aprobada y sin botones;
 *   7. y en el reloj, «Olvidé marcar» no envía una hora que no se entiende.
 *
 * USO
 *   npm run demo:export
 *   node scripts/bandeja-check.mjs dist-demo
 */

import { mkdirSync } from 'node:fs';

import {
  cargarPlaywright,
  entrarComoDemo,
  esperarPantalla,
  MARCADORES,
  sembrarKiosco,
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

const { base, cerrar } = await servirExport(DIR, 8294);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
mkdirSync('capturas', { recursive: true });

const tarjetas = (pagina, tipo = '') =>
  pagina.locator(`[data-testid^="solicitud-${tipo}"]:visible`);
const hoja = (pagina) => pagina.locator('[data-testid="approve-sheet"]:visible');

/** Abre la hoja de aprobar de la primera tarjeta de ese tipo. */
async function abrirAprobar(pagina, tipo) {
  const tarjeta = tarjetas(pagina, tipo).first();
  await tarjeta.locator('[data-testid^="request-approve-"]').click();
  await hoja(pagina).waitFor({ timeout: 10000 });
  // La hoja entra deslizándose: se escribe cuando ya está quieta.
  await pagina.waitForTimeout(400);
}

async function escribir(pagina, testid, valor) {
  const campo = pagina.locator(`[data-testid="${testid}"]:visible`);
  await campo.fill('');
  await campo.fill(valor);
}

try {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const pagina = await ctx.newPage();
  await entrarComoDemo(pagina, base);
  // Seis solicitudes en la sede que se mira: la bandeja atrasada de la demostración.
  await pagina.goto(`${base}/requests?escenario=solicitudes`, { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADORES['/requests'], { asentar: 600 });

  /* ---------------------------------------------------------------- 1 */
  const caso1 = 'cada solicitud dice su hora y su día';
  const antes = await tarjetas(pagina).count();
  // Solo la pantalla de Bandeja: las ya visitadas siguen montadas en la página (4-oct).
  const texto = sinGlifos(await pagina.locator('[data-testid="manager-requests"]').innerText());
  if (antes < 2) fallar(caso1, `esperaba varias pendientes y hay ${antes}`);
  else if (texto.includes('--:--')) fallar(caso1, 'alguna enseña «--:--» en vez de la hora');
  // «Hora propuesta» y no «Hora que propones»: esto lo lee quien gestiona (4-oct).
  else if ((texto.match(/Hora propuesta/g) ?? []).length < antes)
    fallar(caso1, 'hay tarjetas sin la hora propuesta');
  else pasa(caso1, `${antes} pendientes`);

  /* ---------------------------------------------------------------- 2 */
  const caso2 = 'aprobar abre la hoja con la hora propuesta ya puesta';
  await abrirAprobar(pagina, 'forgot_clock_in');
  const puesta = await pagina.locator('[data-testid="approve-time"]:visible').inputValue();
  const dia = sinGlifos(
    (await pagina.locator('[data-testid="approve-day"]:visible').textContent()) ?? '',
  );
  if (!/^\d{2}:\d{2}$/.test(puesta)) fallar(caso2, `la hora sale «${puesta}»`);
  else if (dia.trim().length < 6) fallar(caso2, `el día sale «${dia}»`);
  else pasa(caso2, `${puesta}, ${dia}`);

  /* ---------------------------------------------------------------- 3 */
  const caso3 = 'una hora mal escrita se dice en la hoja y no se envía';
  await escribir(pagina, 'approve-time', '99:99');
  await pagina.locator('[data-testid="approve-confirm"]:visible').click();
  await pagina.waitForTimeout(300);
  const avisoHora = sinGlifos(
    (await pagina
      .locator('[data-testid="approve-error"]:visible')
      .textContent()
      .catch(() => '')) ?? '',
  );
  // El aviso de hora mala dice que no se entiende y cómo escribirla (8-oct: ya vale «18.30»).
  if (!/no se entiende/.test(avisoHora)) fallar(caso3, `el aviso dice «${avisoHora}»`);
  else if ((await hoja(pagina).count()) === 0) fallar(caso3, 'la hoja se cerró');
  else pasa(caso3);

  /* ---------------------------------------------------------------- 5 */
  const caso5 = 'aprobar bien la quita de pendientes y dice que quedó registrada';
  await escribir(pagina, 'approve-time', '08:00');
  await escribir(pagina, 'approve-clock-out', '16:00');
  await pagina.locator('[data-testid="approve-confirm"]:visible').click();
  await hoja(pagina)
    .waitFor({ state: 'detached', timeout: 10000 })
    .catch(() => undefined);
  await pagina.waitForTimeout(600);
  const aviso = sinGlifos(
    (await pagina
      .locator('[data-testid="requests-feedback"]:visible')
      .textContent()
      .catch(() => '')) ?? '',
  );
  const despues = await tarjetas(pagina).count();
  await pagina.screenshot({ path: 'capturas/bandeja-aprobada.png' });
  if ((await hoja(pagina).count()) > 0) {
    const error = await pagina
      .locator('[data-testid="approve-error"]:visible')
      .textContent()
      .catch(() => '');
    fallar(caso5, `la hoja sigue abierta: «${sinGlifos(error ?? '')}»`);
  } else if (!/Aprobada.*registrado/.test(aviso)) fallar(caso5, `el aviso dice «${aviso}»`);
  else if (despues !== antes - 1) fallar(caso5, `había ${antes} pendientes y quedan ${despues}`);
  else pasa(caso5, `«${aviso}», quedan ${despues}`);

  /* ---------------------------------------------------------------- 4 */
  const caso4 = 'un fichaje que no cabe se dice en la hoja y la solicitud sigue ahí';
  if ((await tarjetas(pagina, 'forgot_clock_out').count()) === 0) {
    fallar(caso4, 'no hay ninguna de «olvidé marcar salida» para probarlo');
  } else {
    const pendientes = await tarjetas(pagina).count();
    await abrirAprobar(pagina, 'forgot_clock_out');
    // Tres semanas atrás: la demostración no tiene jornadas ahí, así que no hay de qué salir.
    for (let i = 0; i < 21; i += 1) {
      await pagina.locator('[data-testid="approve-day-previous"]:visible').click();
    }
    await pagina.locator('[data-testid="approve-confirm"]:visible').click();
    const error = pagina.locator('[data-testid="approve-error"]:visible');
    await error.waitFor({ timeout: 10000 }).catch(() => undefined);
    const dice = sinGlifos((await error.textContent().catch(() => '')) ?? '');
    await pagina.screenshot({ path: 'capturas/bandeja-no-cabe.png' });
    if (!/fuera de su jornada/.test(dice)) fallar(caso4, `el aviso dice «${dice}»`);
    else {
      await hoja(pagina).getByText('Cerrar', { exact: true }).first().click();
      await pagina.waitForTimeout(500);
      const siguen = await tarjetas(pagina).count();
      if (siguen !== pendientes) fallar(caso4, `había ${pendientes} y quedan ${siguen}`);
      else pasa(caso4, `«${dice}»`);
    }
  }

  /* ---------------------------------------------------------------- 6 */
  const caso6 = 'en «Todos» sale como aprobada y sin botones';
  await pagina
    .locator('[data-testid="requests-filter"]')
    .getByText('Todos', { exact: true })
    .click();
  await pagina.waitForTimeout(500);
  const aprobadas = tarjetas(pagina).filter({ hasText: 'Aprobada' });
  const conBotones = await aprobadas.locator('[data-testid^="request-approve-"]').count();
  if ((await aprobadas.count()) !== 1) {
    fallar(caso6, `hay ${await aprobadas.count()} aprobadas, esperaba 1`);
  } else if (conBotones > 0) fallar(caso6, 'la aprobada sigue ofreciendo «Aprobar»');
  else pasa(caso6);
  await ctx.close();

  /* ---------------------------------------------------------------- 7 */
  const caso7 = 'en el reloj, «Olvidé marcar» no envía una hora que no se entiende';
  const reloj = await navegador.newContext({ viewport: { width: 1024, height: 1366 } });
  const enReloj = await reloj.newPage();
  await sembrarKiosco(enReloj);
  await enReloj.goto(`${base}/kiosk`, { waitUntil: 'networkidle' });
  await enReloj.locator('[data-testid="keypad-1"]:visible').waitFor({ timeout: 40000 });
  for (const digito of ['1', '2', '3', '4', '5', '6']) {
    await enReloj.locator(`[data-testid="keypad-${digito}"]:visible`).click();
  }
  await enReloj.locator('[data-testid="kiosk-forgot"]:visible').click({ timeout: 20000 });
  await enReloj.locator('[data-testid="forgot-kind-forgot_clock_in"]:visible').click();
  await enReloj.locator('[data-testid="forgot-time"]:visible').fill('8 y media');
  await enReloj.locator('[data-testid="forgot-reason"]:visible').fill('El iPad estaba apagado');
  await enReloj.locator('[data-testid="forgot-submit"]:visible').click();
  await enReloj.waitForTimeout(400);
  const errorReloj = sinGlifos(
    (await enReloj
      .locator('[data-testid="forgot-error"]:visible')
      .textContent()
      .catch(() => '')) ?? '',
  );
  const enviada = await enReloj.locator('[data-testid="forgot-sent"]:visible').count();
  if (enviada > 0) fallar(caso7, 'envió «8 y media» como si fuera una hora');
  else if (!/no se entiende/.test(errorReloj)) fallar(caso7, `el aviso dice «${errorReloj}»`);
  else {
    await enReloj.locator('[data-testid="forgot-time"]:visible').fill('08:30');
    await enReloj.locator('[data-testid="forgot-submit"]:visible').click();
    const listo = await enReloj
      .locator('[data-testid="forgot-sent"]:visible')
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!listo) fallar(caso7, 'con «08:30» tampoco se envió');
    else pasa(caso7);
  }
  await reloj.close();
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nBANDEJA — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nBANDEJA — OK: aprobar registra el fichaje y la quita de pendientes, y lo que no cabe se dice.',
);
