/**
 * Sin F5 (Andree, 7-oct): «¿por qué tengo que dar F5 para que las cosas se actualicen?».
 * Lo que se comprueba, en la demostración:
 *
 * 1. LO QUE SE MIRA SE PONE AL DÍA SOLO: con `?escenario=avisos`, con el panel abierto llegan
 *    marcas del reloj —Diego entra, Elena sale—, e Inicio las enseña en «Ahora» sin cambiar
 *    de pantalla ni recargar.
 * 2. SIN DESPLIEGUE NO HAY AVISO DE VERSIÓN: abierta un rato, la pestaña no dice nada.
 * 3. CON UNA VERSIÓN NUEVA PUBLICADA —el documento de entrada nombra otro paquete— sale
 *    «Hay una versión nueva» abajo, dentro de la pantalla, en el ordenador y en el teléfono,
 *    y «Actualizar» recarga.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/al-dia-check.mjs dist-demo
 */
import { mkdirSync } from 'node:fs';

import {
  servirExport,
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/al-dia-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8153);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

async function entrar(pagina, consulta = '') {
  await pagina.goto(`${base}/${consulta}`, { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 800 });
}

const ahora = (pagina) =>
  pagina
    .locator('[data-testid="right-now-list"]:not([aria-hidden="true"] *)')
    .allInnerTexts()
    .then((t) => t.join(' | '))
    .catch(() => '');

try {
  /* ------------------------------------- 1: Inicio se pone al día sin recargar */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, '?escenario=avisos');
    const antes = await ahora(pagina);
    const url = pagina.url();
    /*
     * Las cuatro marcas llegan entre 2,5 y 7,5 s después de abrir el panel. Diego ya sale
     * antes —«Debía entrar a las 08:00 · Falta», de su turno de la mañana—; lo nuevo es su
     * fila de dentro, «Desde las …».
     */
    const dentro = (texto) => /Diego Paredes Vega\s+Desde las/.test(texto);
    let despues = antes;
    for (let i = 0; i < 20 && !dentro(despues); i += 1) {
      await pagina.waitForTimeout(1000);
      despues = await ahora(pagina);
    }
    if (dentro(antes)) {
      problemas.push('1: Diego ya salía dentro antes de marcar: la prueba no prueba nada');
    }
    if (!dentro(despues)) {
      problemas.push(
        `1: Inicio no enseña a Diego, que acaba de entrar, sin recargar: «${despues}»`,
      );
    }
    if (pagina.url() !== url) problemas.push('1: la página cambió de dirección: no vale');
    console.log(
      `  inicio al día        Diego dentro antes ${dentro(antes) ? 'sí' : 'no'}, después ${dentro(despues) ? 'sí' : 'no'}`,
    );
    await contexto.close();
  }

  /* ---------------------------- 2 y 3: el aviso de versión nueva, y su botón */
  for (const ancho of [1280, 390]) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: 860 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    const aviso = pagina.locator('[data-testid="version-nueva"]');

    if (ancho === 1280) {
      // 2. Sin despliegue: dos vueltas del vigía y nada.
      await pagina.waitForTimeout(9000);
      if ((await aviso.count()) > 0) {
        problemas.push('2: sale «versión nueva» sin haberse publicado nada');
      }
    }

    // 3. «Se publica»: el documento de entrada pasa a nombrar otro paquete.
    await pagina.route(`${base}/`, async (ruta) => {
      if (ruta.request().resourceType() !== 'fetch') return ruta.continue();
      const respuesta = await ruta.fetch();
      const cuerpo = (await respuesta.text()).replace(
        /entry-[0-9a-f]+\.js/,
        'entry-0000000000000000000000000000000.js',
      );
      return ruta.fulfill({ response: respuesta, body: cuerpo });
    });
    try {
      await aviso.waitFor({ timeout: 15000 });
    } catch {
      problemas.push(`3: a ${ancho} px no sale «versión nueva» con otro paquete publicado`);
    }
    if ((await aviso.count()) > 0) {
      const caja = await aviso.boundingBox();
      const vista = pagina.viewportSize();
      if (
        caja === null ||
        vista === null ||
        caja.x < 0 ||
        caja.y < 0 ||
        caja.x + caja.width > vista.width + 1 ||
        caja.y + caja.height > vista.height + 1
      ) {
        problemas.push(`3: a ${ancho} px el aviso de versión se sale de la pantalla`);
      }
      await pagina.screenshot({ path: `capturas/version-nueva-${ancho}.png` });
      // «Actualizar» recarga: con el paquete de verdad otra vez, el aviso ya no está.
      await pagina.unroute(`${base}/`);
      await Promise.all([
        pagina.waitForEvent('load', { timeout: 20000 }),
        pagina.locator('[data-testid="version-nueva-actualizar"]').click(),
      ]);
      await pagina.waitForTimeout(1500);
      if ((await aviso.count()) > 0) problemas.push('3: después de actualizar el aviso sigue');
      console.log(`  versión nueva        ${ancho} px: sale, cabe y «Actualizar» recarga`);
    }
    await contexto.close();
  }
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK: las pantallas se ponen al día solas y la versión nueva se avisa.');
