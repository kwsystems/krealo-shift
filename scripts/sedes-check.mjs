#!/usr/bin/env node
/**
 * ¿UNA SEDE CERRADA DESAPARECE DE VERDAD, Y SE PUEDE REABRIR SIN PERDER NADA?
 *
 * POR QUÉ EXISTE. El 29-sep Andree desactivó «Asia» y la sede seguía saliendo en los
 * filtros de Equipo, en la cabecera y en cada selector de sede: desactivar solo cambiaba
 * la etiqueta en Ajustes. Pidió que desapareciera de todo y que se pudiera volver a
 * activar después.
 *
 * Una prueba de unidad cubre la regla —`sedesActivas`, `sedeElegida`—, pero no puede ver
 * lo que falló: que CADA PANTALLA leía la lista entera. Aquí se cierra una sede en un
 * navegador y se mira pantalla por pantalla.
 *
 * Y UNA SEGUNDA COSA, la que haría daño de verdad si se rompe. Guardar un empleado BORRA
 * todas sus sedes y escribe las del formulario. Si Equipo dejara de leer las asignaciones
 * de la sede cerrada, editar a alguien que está en las dos le quitaría la cerrada en
 * silencio, y al reabrirla ya no estaría. Así que se hace justo eso: alguien en las dos
 * sedes, se cierra una, se le edita y se guarda, se reabre y se comprueba que sigue en ella.
 *
 * La demostración guarda los datos en memoria: TODO va sin recargar, navegando por el
 * menú. Una recarga lo sembraría de nuevo y el arnés mediría la siembra.
 *
 * USO
 *   npm run demo:export
 *   node scripts/sedes-check.mjs dist-demo
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { cargarPlaywright, entrarComoDemo, servirExport, sinGlifos } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8217;
const CAPTURAS = process.env.SEDES_SHOTS ?? '/tmp/ks-sedes';

/** Las dos sedes sembradas en la demostración (`src/lib/demo/seed.ts`). */
const PRINCIPAL = { id: '22222222-2222-4222-8222-222222222221', nombre: 'Sede Principal' };
const SUCURSAL = { id: '22222222-2222-4222-8222-222222222222', nombre: 'Sucursal Miraflores' };

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
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 1400 } });
const pagina = await contexto.newPage();
const foto = (nombre) => pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`) });

const cuenta = (selector) => pagina.locator(selector).count();

/** Al menú de la izquierda, sin recargar: ver arriba. */
async function menu(ruta, marcador) {
  await pagina.locator(`a[href="${ruta}"]`).first().click();
  await pagina.locator(`[data-testid="${marcador}"]`).first().waitFor({ timeout: 20000 });
  await pagina.waitForTimeout(500);
}

/** Qué sedes ofrece la hoja de la cabecera. */
async function sedesDeLaCabecera() {
  await pagina.locator('[data-testid="scope-open"]').click();
  await pagina.locator('[data-testid="scope-sheet"]').waitFor({ timeout: 20000 });
  await pagina.waitForTimeout(300);
  const ids = await pagina
    .locator('[data-testid^="scope-loc-"]')
    .evaluateAll((nodos) => nodos.map((n) => n.getAttribute('data-testid').slice(10)));
  await pagina.keyboard.press('Escape');
  await pagina.locator('[data-testid="scope-sheet"]').waitFor({ state: 'detached', timeout: 5000 });
  return ids;
}

/** Abre la tarjeta de sede de Ajustes si está plegada. */
async function tarjetaDeSede() {
  await menu('/settings', 'location-card');
  if ((await cuenta('[data-testid="location-name"]')) === 0) {
    await pagina.locator('[data-testid="location-card-toggle"]').click();
    await pagina.locator('[data-testid="location-name"]').waitFor({ timeout: 10000 });
  }
}

/** Abre la ficha de alguien de la sede que está puesta y le da a «Editar». */
async function editarA(nombre) {
  await menu('/team', 'team-controls');
  await pagina
    .locator('[data-testid="team-search"] input, input[data-testid="team-search"]')
    .first()
    .fill(nombre);
  await pagina.waitForTimeout(400);
  await pagina.locator('[role="button"][data-testid^="team-member-"]').first().click();
  await pagina.locator('[data-testid="employee-edit"]').click();
  await pagina.locator('[data-testid="employee-form-sheet"]').waitFor({ timeout: 10000 });
}

/** El chip de una sede en el formulario, y si está marcado. */
async function chipDeSede(id) {
  const chip = pagina.locator(`[data-testid="employee-locations-${id}"]`);
  if ((await chip.count()) === 0) return null;
  /*
   * MARCADO = LLEVA EL CHECK. Se mira el icono y no `aria-selected` porque ese atributo no
   * llega al HTML: con react-native-web 0.21, `accessibilityState` ya no se traduce, así
   * que ningún chip dice su estado. El check es un glifo de la fuente de iconos dentro
   * del texto: si al quitar los glifos el texto cambia, el chip está marcado.
   */
  const texto = (await chip.innerText()).trim();
  return sinGlifos(texto) !== texto;
}

async function guardar() {
  await pagina.locator('[data-testid="employee-form-save"]').click();
  await pagina
    .locator('[data-testid="employee-form-sheet"]')
    .waitFor({ state: 'detached', timeout: 15000 });
  await pagina.keyboard.press('Escape').catch(() => undefined);
  await pagina.waitForTimeout(500);
}

try {
  await entrarComoDemo(pagina, base);

  /* ------------------------------------------------------------------ */
  const caso0 = 'con las dos abiertas, los selectores ofrecen las dos';
  /*
   * La mitad que da sentido al resto: si los selectores no estuvieran nunca, «no aparece la
   * cerrada» pasaría sin medir nada.
   */
  const antes = await sedesDeLaCabecera();
  await menu('/team', 'team-controls');
  const equipoAntes = await cuenta(`[data-testid="team-location-${SUCURSAL.id}"]`);
  if (antes.length !== 2 || equipoAntes !== 1) {
    fallar(
      caso0,
      `cabecera ${antes.length} sedes, filtro de Equipo con la sucursal: ${equipoAntes}`,
    );
  } else {
    pasa(caso0, 'cabecera y filtro de Equipo con las dos');
  }

  /* ------------------------------------------------------------------ */
  const caso1 = 'alguien en las dos sedes';
  /*
   * Se prepara ANTES de cerrar: con la sucursal cerrada su chip no está en el formulario.
   * Se elige a una persona de la principal y se le suma la sucursal.
   */
  const persona = await (async () => {
    await pagina.locator('[role="button"][data-testid^="team-member-"]').first().click();
    const ficha = pagina.locator('[data-testid="employee-detail-sheet"]');
    await ficha.waitFor({ timeout: 10000 });
    await pagina.locator('[data-testid="employee-edit"]').click();
    await pagina.locator('[data-testid="employee-form-sheet"]').waitFor({ timeout: 10000 });
    return pagina
      .locator('[data-testid="employee-full-name"] input, input[data-testid="employee-full-name"]')
      .first()
      .inputValue();
  })();
  if ((await chipDeSede(SUCURSAL.id)) === false) {
    await pagina.locator(`[data-testid="employee-locations-${SUCURSAL.id}"]`).click();
  }
  const principalMarcada = await chipDeSede(PRINCIPAL.id);
  const sucursalMarcada = await chipDeSede(SUCURSAL.id);
  await guardar();
  if (principalMarcada !== true || sucursalMarcada !== true) {
    fallar(
      caso1,
      `no se pudo dejar a ${persona} en las dos (principal ${principalMarcada}, sucursal ${sucursalMarcada})`,
    );
  } else {
    pasa(caso1, persona);
  }

  /* ------------------------------------------------------------------ */
  const caso2 = 'cerrar la sucursal desde Ajustes';
  await tarjetaDeSede();
  await pagina.locator(`[data-testid="location-pick-${SUCURSAL.id}"]`).click();
  await pagina.waitForTimeout(400);
  await pagina.locator('[data-testid="location-close"]').click();
  await pagina.locator('[data-testid="confirm-sheet-confirm"]').click();
  try {
    await pagina.locator('[data-testid="location-reopen"]').waitFor({ timeout: 15000 });
    pasa(caso2, 'y la tarjeta se queda en ella, con «Reabrir esta sede» a la vista');
  } catch {
    fallar(caso2, 'tras cerrarla, la tarjeta de Ajustes no enseña el botón de reabrirla');
  }
  await foto('1-ajustes-cerrada');

  /* ------------------------------------------------------------------ */
  const caso3 = 'Ajustes la sigue ofreciendo, marcada como cerrada';
  const chipAjustes = pagina.locator(`[data-testid="location-pick-${SUCURSAL.id}"]`);
  const textoChip = (await chipAjustes.count()) === 0 ? null : await chipAjustes.innerText();
  if (textoChip === null || !/Cerrada/.test(textoChip)) {
    fallar(caso3, `el selector de Ajustes no la ofrece como cerrada (${textoChip ?? 'no está'})`);
  } else {
    pasa(caso3, textoChip.replace(/\s+/g, ' ').trim());
  }

  /* ------------------------------------------------------------------ */
  const caso4 = 'la cerrada no sale en ningún otro sitio';
  const fuera = [];
  const cabecera = await sedesDeLaCabecera();
  if (cabecera.includes(SUCURSAL.id)) fuera.push('la hoja de la cabecera');
  const textoCabecera = await pagina.locator('[data-testid="scope-open"]').innerText();
  if (textoCabecera.includes(SUCURSAL.nombre)) fuera.push('el título de la cabecera');
  for (const [ruta, marcador, selector] of [
    ['/team', 'team-controls', 'team-location'],
    ['/schedule', 'schedule-view', 'schedule-location'],
    ['/hours', 'timesheet-status-filter', 'timesheet-location'],
  ]) {
    await menu(ruta, marcador);
    if ((await cuenta(`[data-testid="${selector}-${SUCURSAL.id}"]`)) > 0) fuera.push(ruta);
    const donde = await pagina.evaluate((nombre) => {
      const salida = [];
      const recorrer = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (recorrer.nextNode()) {
        const nodo = recorrer.currentNode;
        if (!(nodo.textContent ?? '').includes(nombre)) continue;
        const el = nodo.parentElement;
        /*
         * AJUSTES SE QUEDA MONTADO DE FONDO al cambiar de pestaña —el navegador de pestañas
         * no desmonta la anterior—, tapado por la pantalla activa pero con caja y todo. Su
         * selector sí nombra la sede cerrada, a propósito: es donde se reabre. Contarlo
         * aquí sería medir Ajustes en cada pantalla.
         */
        if (el.closest('[data-testid="location-card"]') !== null) continue;
        const caja = el.getBoundingClientRect();
        const visible = caja.width > 0 && caja.height > 0 && el.checkVisibility?.() !== false;
        const conId = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?';
        salida.push(`${visible ? 'VISIBLE' : 'oculto'}:${conId}`);
      }
      return salida;
    }, SUCURSAL.nombre);
    if (donde.some((d) => d.startsWith('VISIBLE'))) fuera.push(`${ruta} (su nombre en pantalla)`);
  }
  await foto('2-equipo-sin-la-cerrada');
  if (fuera.length > 0) fallar(caso4, `sigue saliendo en: ${fuera.join(', ')}`);
  else pasa(caso4, 'ni en la cabecera, ni en Equipo, ni en Horario, ni en Horas');

  /* ------------------------------------------------------------------ */
  const caso5 = 'editar con la sede cerrada no le quita la sede';
  await editarA(persona);
  const chipCerrada = await chipDeSede(SUCURSAL.id);
  if (chipCerrada !== null) {
    fallar(caso5, 'el formulario ofrece la sede cerrada');
  }
  await guardar();

  await tarjetaDeSede();
  await pagina.locator('[data-testid="location-reopen"]').click();
  await pagina.locator('[data-testid="location-close"]').waitFor({ timeout: 15000 });

  const reabierta = await sedesDeLaCabecera();
  if (!reabierta.includes(SUCURSAL.id)) {
    fallar(caso5, 'reabierta, la sucursal no vuelve a la cabecera');
  } else {
    await editarA(persona);
    const sigue = await chipDeSede(SUCURSAL.id);
    await pagina.keyboard.press('Escape');
    if (sigue !== true) {
      fallar(caso5, `${persona} ya no está en la sucursal: se perdió al guardar con ella cerrada`);
    } else {
      pasa(caso5, `${persona} sigue en las dos tras guardar con una cerrada y reabrirla`);
    }
  }
  await foto('3-reabierta');
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
  await foto('error').catch(() => undefined);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nSEDES — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nSEDES — OK: una sede cerrada no sale fuera de Ajustes, se reabre, y nadie pierde su sede al guardar.',
);
