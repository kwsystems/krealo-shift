/**
 * QUIÉN TIENE ACCESO: «Reactivar» y «Desligar ficha» en Ajustes (5-oct).
 *
 * Andree preguntó qué era «ligar» una cuenta: es lo que une el Gmail de alguien con su
 * ficha de Equipo. Hasta hoy, si quedaba mal unida —entró con otro correo— o se le quitaba
 * el acceso por error, no había botón para deshacerlo. Lo que se comprueba, en la
 * demostración:
 *
 *   1. La cuenta a la que se le quitó el acceso dice «Sin acceso» y ofrece «Reactivar».
 *   2. La cuenta de la vendedora dice a qué ficha está unida, por su nombre.
 *   3. «Desligar ficha» pide confirmación diciendo de quién es la ficha y qué pasa.
 *   4. En un teléfono, la tarjeta cabe.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/acceso-check.mjs dist-demo
 */
import { cargarPlaywright, entrarComoDemo, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8231;
/** La cuenta de la vendedora de la demostración (`src/lib/demo/seed.ts`). */
const VENDEDORA = '99999999-9999-4999-8999-999999999992';
const RETIRADA = 'demo-ex-vendedor';

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

const texto = async (pagina, testid) =>
  (
    await pagina
      .locator(`[data-testid="${testid}"]`)
      .first()
      .innerText()
      .catch(() => '')
  )
    .replace(/[-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function abrirAccesos(pagina) {
  await pagina.locator('a[href="/settings"]').first().click();
  await pagina.locator('[data-testid="members-card"]').first().waitFor({ timeout: 20000 });
  if ((await pagina.locator(`[data-testid="member-${VENDEDORA}"]`).count()) === 0) {
    await pagina.locator('[data-testid="members-card-toggle"]').first().click();
  }
  await pagina.locator(`[data-testid="member-${VENDEDORA}"]`).first().waitFor({ timeout: 10000 });
  await pagina.waitForTimeout(400);
}

try {
  for (const ancho of [1280, 360]) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: 1000 } });
    const pagina = await contexto.newPage();
    await entrarComoDemo(pagina, base);
    await abrirAccesos(pagina);

    // 1. Reactivar
    const retirada = await texto(pagina, `member-${RETIRADA}`);
    if ((await pagina.locator(`[data-testid="member-reactivate-${RETIRADA}"]`).count()) === 0) {
      fallar(`${ancho}px reactivar`, `la cuenta retirada no ofrece «Reactivar»: «${retirada}»`);
    } else if (!/Sin acceso/.test(retirada)) {
      fallar(
        `${ancho}px reactivar`,
        `la cuenta retirada no dice que no tiene acceso: «${retirada}»`,
      );
    } else {
      pasa(`${ancho}px reactivar`, retirada.slice(0, 80));
    }

    // 2. A qué ficha está unida
    const unida = await texto(pagina, `member-linked-${VENDEDORA}`);
    if (!/^Unida a la ficha de \S/.test(unida) || /ya no está en Equipo/.test(unida)) {
      fallar(`${ancho}px ficha unida`, `no dice de quién es la ficha: «${unida}»`);
    } else {
      pasa(`${ancho}px ficha unida`, unida);
    }

    // 3. Desligar pide confirmación y dice qué pasa
    await pagina.locator(`[data-testid="member-unlink-${VENDEDORA}"]`).first().click();
    await pagina.waitForTimeout(600);
    const hoja = (await pagina.locator('body').innerText()).replace(/\s+/g, ' ');
    if (!/¿Desligar la ficha de \S/.test(hoja) || !/se cerrará su sesión/.test(hoja)) {
      fallar(`${ancho}px desligar`, 'la confirmación no dice de quién es la ficha ni qué pasa');
    } else {
      pasa(`${ancho}px desligar`, 'confirma con el nombre y lo que pasa');
    }
    await pagina.keyboard.press('Escape');
    await pagina.waitForTimeout(300);

    // 4. Cabe
    const arrastre = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (arrastre > 1) fallar(`${ancho}px ancho`, `la página se sale ${arrastre}px`);
    else pasa(`${ancho}px ancho`, 'sin arrastre horizontal');
    await contexto.close();
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
console.log('\nOK: Ajustes deja reactivar y desligar, y dice a qué ficha está unida cada cuenta.');
