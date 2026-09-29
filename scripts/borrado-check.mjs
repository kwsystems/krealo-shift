#!/usr/bin/env node
/**
 * ¿SE BORRAN DE UNA VEZ LOS DE PRUEBA, Y SOLO ELLOS?
 *
 * POR QUÉ EXISTE. El 29-sep Andree tenía siete registros de prueba en Equipo → Inactivo
 * —Ana, varios Joseph y otros— y borrarlos uno por uno, ficha por ficha y nombre por
 * nombre, era pesado. Se añadió «Eliminar varios». Lo que este arnés comprueba es lo que
 * una prueba de componente no ve:
 *
 *   1. que el botón SOLO exista en Inactivo: en la lista del equipo que trabaja, no;
 *   2. que en ese modo tocar una fila la MARQUE y no abra la ficha, y que la casilla diga
 *      en el HTML si está marcada (`aria-checked`), que es lo que oye un lector de pantalla;
 *   3. que la hoja nombre a cada persona antes de pedir nada, y que el botón no haga nada
 *      hasta escribir la palabra;
 *   4. y lo que importa de verdad: que desaparezcan LOS MARCADOS y NADIE MÁS. El resto del
 *      equipo ya está usando la app.
 *
 * La demostración guarda los datos en memoria: todo va sin recargar.
 *
 * USO
 *   npm run demo:export
 *   node scripts/borrado-check.mjs dist-demo
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { cargarPlaywright, entrarComoDemo, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8218;
const CAPTURAS = process.env.BORRADO_SHOTS ?? '/tmp/ks-borrado';

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

await mkdir(CAPTURAS, { recursive: true });
const { base, cerrar } = await servirExport(RAIZ, PUERTO);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 1600 } });
const pagina = await contexto.newPage();
const foto = (nombre) => pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`) });

const FILAS =
  '[data-testid^="team-member-"][role="button"], [data-testid^="team-member-"][role="checkbox"]';

/** Los ids de las filas que se ven, en orden. */
async function filas() {
  return pagina
    .locator(FILAS)
    .evaluateAll((nodos) =>
      nodos.map((n) => n.getAttribute('data-testid').slice('team-member-'.length)),
    );
}

async function filtro(valor) {
  await pagina.locator(`[data-testid="team-status-filter-${valor}"]`).click();
  await pagina.waitForTimeout(500);
}

try {
  await entrarComoDemo(pagina, base);
  await pagina.locator('a[href="/team"]').first().click();
  await pagina.locator('[data-testid="team-controls"]').waitFor({ timeout: 20000 });
  await pagina.waitForTimeout(600);

  /* ------------------------------------------------------------------ */
  const caso1 = 'en la lista del equipo que trabaja no hay «Eliminar varios»';
  if ((await pagina.locator('[data-testid="team-delete-many-start"]').count()) > 0) {
    fallar(caso1, 'el botón está en Activo');
  } else {
    pasa(caso1);
  }

  /* ------------------------------------------------------------------ */
  // Dos de prueba: se desactivan los dos primeros, que es lo que hizo Andree.
  const todosAntes = await (async () => {
    await filtro('all');
    return filas();
  })();
  await filtro('active');
  const deBaja = [];
  for (let i = 0; i < 2; i += 1) {
    const fila = pagina.locator('[data-testid^="team-member-"][role="button"]').first();
    const id = (await fila.getAttribute('data-testid')).slice('team-member-'.length);
    await fila.click();
    await pagina.locator('[data-testid="employee-deactivate"]').click();
    await pagina
      .locator('[data-testid="employee-detail-sheet"]')
      .waitFor({ state: 'detached', timeout: 15000 });
    await pagina.waitForTimeout(400);
    deBaja.push(id);
  }

  await filtro('inactive');
  const inactivosAntes = await filas();

  /* ------------------------------------------------------------------ */
  const caso2 = 'en Inactivo sí está, y tocar una fila la marca en vez de abrirla';
  const empezar = pagina.locator('[data-testid="team-delete-many-start"]');
  if ((await empezar.count()) === 0) {
    fallar(caso2, 'no hay botón «Eliminar varios» en Inactivo');
    throw new Error('sin botón no hay nada más que medir');
  }
  await empezar.click();
  await pagina.waitForTimeout(300);
  for (const id of deBaja) await pagina.locator(`[data-testid="team-member-${id}"]`).click();
  await pagina.waitForTimeout(300);
  const fichaAbierta = await pagina.locator('[data-testid="employee-detail-sheet"]').count();
  const estados = await Promise.all(
    inactivosAntes.map(async (id) => [
      id,
      await pagina.locator(`[data-testid="team-member-${id}"]`).getAttribute('aria-checked'),
    ]),
  );
  const marcadasEnHtml = estados.filter(([, v]) => v === 'true').map(([id]) => id);
  const sinEstado = estados.filter(([, v]) => v !== 'true' && v !== 'false');
  if (fichaAbierta > 0) {
    fallar(caso2, 'tocar una fila abrió la ficha');
  } else if (sinEstado.length > 0) {
    fallar(caso2, `${sinEstado.length} casilla(s) no dicen en el HTML si están marcadas`);
  } else if (
    marcadasEnHtml.length !== deBaja.length ||
    !deBaja.every((id) => marcadasEnHtml.includes(id))
  ) {
    fallar(caso2, `marcadas en el HTML: ${marcadasEnHtml.length}, se marcaron ${deBaja.length}`);
  } else {
    pasa(caso2, `${deBaja.length} marcadas, y cada casilla lo dice con aria-checked`);
  }
  await foto('1-marcadas');

  /* ------------------------------------------------------------------ */
  const caso3 = 'la hoja nombra a cada una y no borra sin la palabra';
  await pagina.locator('[data-testid="team-delete-many-review"]').click();
  const hoja = pagina.locator('[data-testid="team-delete-many-sheet"]');
  await hoja.waitFor({ timeout: 10000 });
  await pagina.locator('[data-testid="team-delete-many-totals"]').waitFor({ timeout: 15000 });
  const textoHoja = await pagina.locator('[data-testid="team-delete-many-list"]').innerText();
  const renglones = textoHoja.split('\n').filter((l) => l.trim() !== '');
  await pagina.locator('[data-testid="team-delete-many-confirm"]').click({ force: true });
  await pagina.waitForTimeout(600);
  const siguenTrasToque = await filas();
  if (!(await hoja.isVisible())) {
    fallar(caso3, 'un toque sin escribir la palabra cerró la hoja');
  } else if (siguenTrasToque.length !== inactivosAntes.length) {
    fallar(caso3, 'un toque sin escribir la palabra borró a alguien');
  } else if (renglones.length < deBaja.length * 2) {
    fallar(caso3, `la hoja no nombra a las ${deBaja.length}: «${textoHoja.slice(0, 120)}»`);
  } else {
    pasa(caso3, renglones.filter((_, i) => i % 2 === 0).join(', '));
  }
  await foto('2-hoja');

  /* ------------------------------------------------------------------ */
  const caso4 = 'con la palabra, se borran las marcadas y nadie más';
  await pagina
    .locator(
      '[data-testid="team-delete-many-word"] input, input[data-testid="team-delete-many-word"]',
    )
    .first()
    .fill('eliminar');
  await pagina.locator('[data-testid="team-delete-many-confirm"]').click();
  await hoja.waitFor({ state: 'detached', timeout: 30000 });
  await pagina.waitForTimeout(800);
  const inactivosDespues = await filas();
  await filtro('all');
  const todosDespues = await filas();
  const desaparecidos = todosAntes.filter((id) => !todosDespues.includes(id));
  const sobran = desaparecidos.filter((id) => !deBaja.includes(id));
  const siguen = deBaja.filter((id) => todosDespues.includes(id));
  if (siguen.length > 0) {
    fallar(caso4, `${siguen.length} de las marcadas siguen en Todos`);
  } else if (sobran.length > 0) {
    fallar(caso4, `desapareció alguien que no estaba marcado: ${sobran.join(', ')}`);
  } else if (inactivosDespues.some((id) => deBaja.includes(id))) {
    fallar(caso4, 'siguen en Inactivo');
  } else {
    pasa(
      caso4,
      `Todos pasa de ${todosAntes.length} a ${todosDespues.length}; el resto del equipo intacto`,
    );
  }
  await foto('3-despues');
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
  await foto('error').catch(() => undefined);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nBORRADO — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nBORRADO — OK: solo en Inactivo, marca sin abrir, no borra sin la palabra y borra solo lo marcado.',
);
