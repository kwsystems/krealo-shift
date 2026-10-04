/**
 * La disponibilidad, como en Homebase (Andree, 1-oct).
 *
 * «Un apartado donde todos los vendedores pueden poner sus comentarios en los días,
 * diciendo qué días tienen problemas para trabajar… en team un sublugar… y cuando esto
 * cambie también tiene que cambiar el apartado de los vendedores». Lo que se comprueba, en
 * la demostración:
 *
 * 1. EL MENÚ LATERAL tiene Equipo → Personas y Disponibilidad, con lo nuevo contado.
 * 2. EQUIPO → DISPONIBILIDAD enseña lo sembrado —«los martes no puede», un comentario—
 *    y «Marcar como vista» baja la cuenta.
 * 3. AGREGAR desde un hueco de la tabla lo deja en su día.
 * 4. EL HORARIO lo enseña en la celda de ese día, y el turno que choca dice «Dijo que no
 *    puede».
 * 5. EN EL TELÉFONO, Equipo tiene «Personas | Disponibilidad» y nada se sale.
 * 6. EL CELULAR DEL VENDEDOR enseña «Mi disponibilidad», deja agregar —llega como
 *    enviada, sin ver— y lo enseña en su día de la semana.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/disponibilidad-check.mjs dist-demo
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
  console.error('Uso: node scripts/disponibilidad-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8142);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const esperar = (pagina, ms = 900) => pagina.waitForTimeout(ms);
const cuenta = (pagina, selector) => pagina.locator(selector).count();

async function entrar(pagina, quien = 'sign-in-demo') {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator(`[data-testid="${quien}"]`).click();
}

async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 800 });
}

async function desborde(pagina) {
  return pagina.evaluate(() => {
    const vista = document.documentElement.clientWidth;
    const culpables = [];
    for (const nodo of Array.from(document.querySelectorAll('body *'))) {
      const caja = nodo.getBoundingClientRect();
      if (
        caja.width > 0 &&
        caja.right > vista + 1 &&
        nodo.closest('[data-testid="disponibilidad-tabla"]') === null
      ) {
        culpables.push(`${Math.round(caja.right)}px «${(nodo.textContent ?? '').slice(0, 30)}»`);
      }
    }
    return culpables.slice(0, 3);
  });
}

try {
  /* ------------------------------------------------- 1 a 4: quien gestiona, en grande */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1600, height: 1000 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });

    // --- 1. El menú.
    for (const id of ['menu-team', 'menu-sub-team', 'menu-sub-availability']) {
      if ((await cuenta(pagina, `[data-testid="${id}"]`)) === 0) {
        problemas.push(`el menú lateral no tiene «${id}»`);
      }
    }
    const insignia = await pagina
      .locator('[data-testid="menu-sub-availability-insignia"]')
      .innerText()
      .catch(() => '');
    if (insignia.trim() !== '2') problemas.push(`el menú cuenta «${insignia}» novedades, no 2`);
    console.log(`  menú                 Disponibilidad con ${insignia.trim()} nuevas`);
    await pagina
      .locator('[data-testid="menu-lateral"]')
      .screenshot({ path: 'capturas/disponibilidad-menu.png' });

    // --- 2. La pantalla, con lo sembrado.
    await irPorElMenu(pagina, '/availability');
    const tabla = await pagina.locator('[data-testid="disponibilidad-tabla"]').innerText();
    if (!/No puede/.test(tabla) || !/Estudio en la universidad/.test(tabla)) {
      problemas.push('la tabla no enseña «No puede · Estudio en la universidad»');
    }
    if (!/Comentario/.test(tabla))
      problemas.push('la tabla no enseña el comentario de los viernes');
    if ((await cuenta(pagina, '[data-testid="disponibilidad-nuevas"]')) === 0) {
      problemas.push('no se cuentan las novedades sin ver');
    }
    await pagina.screenshot({ path: 'capturas/disponibilidad-equipo.png' });

    await pagina.locator('[data-testid="disponibilidad-demo-disp-1"]').click();
    await pagina.locator('[data-testid="disponibilidad-hoja"]').waitFor({ timeout: 8000 });
    await pagina.locator('[data-testid="disponibilidad-visto"]').click();
    await pagina
      .locator('[data-testid="disponibilidad-hoja"]')
      .waitFor({ state: 'detached', timeout: 8000 })
      .catch(() => problemas.push('«Marcar como vista» no cierra la hoja'));
    await esperar(pagina);
    const tras = await pagina
      .locator('[data-testid="menu-sub-availability-insignia"]')
      .innerText()
      .catch(() => '');
    if (tras.trim() !== '1') problemas.push(`después de verla, el menú cuenta «${tras}» y no 1`);
    if ((await cuenta(pagina, '[data-testid="disponibilidad-demo-disp-1-nueva"]')) > 0) {
      problemas.push('la vista sigue con su punto de nueva');
    }
    console.log(`  visto                el menú pasa a ${tras.trim()}`);

    // --- 3. Agregar desde un hueco: jueves de la primera fila sin nada ese día.
    const hueco = pagina
      .locator('[data-testid^="disponibilidad-agregar-"][data-testid$="-4"]')
      .first();
    const idHueco = await hueco.getAttribute('data-testid');
    const persona = idHueco.slice('disponibilidad-agregar-'.length, -2);
    await hueco.click();
    await pagina.locator('[data-testid="disponibilidad-hoja"]').waitFor({ timeout: 8000 });
    await pagina.locator('[data-testid="disponibilidad-horas-horas"]').click();
    await pagina.locator('[data-testid="disponibilidad-desde"]').fill('08:00');
    await pagina.locator('[data-testid="disponibilidad-hasta"]').fill('13:00');
    await pagina.locator('[data-testid="disponibilidad-nota"]').fill('Llevo a mi hijo al colegio');
    await pagina.screenshot({ path: 'capturas/disponibilidad-hoja.png' });
    await pagina.locator('[data-testid="disponibilidad-guardar"]').click();
    await pagina
      .locator('[data-testid="disponibilidad-hoja"]')
      .waitFor({ state: 'detached', timeout: 8000 })
      .catch(() => problemas.push('guardar no cierra la hoja'));
    await esperar(pagina);
    const fila = await pagina.locator(`[data-testid="disponibilidad-fila-${persona}"]`).innerText();
    if (!/No puede 08:00–13:00/.test(fila) || !/Llevo a mi hijo/.test(fila)) {
      problemas.push(
        `lo agregado no sale en su fila: «${fila.replace(/\s+/g, ' ').slice(0, 120)}»`,
      );
    }
    console.log('  agregar              jueves 08:00–13:00 en su fila');

    // --- 4. En el Horario: la celda del martes y el turno que choca.
    await irPorElMenu(pagina, '/schedule');
    await esperar(pagina, 1500);
    const enLaRejilla = await cuenta(pagina, '[data-testid^="grid-disponibilidad-"]');
    if (enLaRejilla === 0)
      problemas.push('el Horario no enseña ninguna disponibilidad en la rejilla');
    const choques = await cuenta(pagina, '[data-testid$="-choca"]');
    if (choques === 0) problemas.push('ningún turno dice «Dijo que no puede»');
    console.log(
      `  horario              ${enLaRejilla} en la rejilla, ${choques} turnos que chocan`,
    );
    await pagina.screenshot({ path: 'capturas/disponibilidad-horario.png' });
    await contexto.close();
  }

  /* -------------------------------------------------------- 5: en el teléfono */
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });
    await pagina.locator('a[href$="/team"]').first().click();
    await esperarPantalla(pagina, MARCADORES['/team'], { asentar: 600 });
    await pagina.locator('[data-testid="equipo-pestanas-disponibilidad"]').click();
    await esperarPantalla(pagina, MARCADORES['/availability'], { asentar: 800 });
    const fuera = await desborde(pagina);
    if (fuera.length > 0) problemas.push(`a 390 px se sale: ${fuera.join(', ')}`);
    await pagina.screenshot({ path: 'capturas/disponibilidad-telefono.png', fullPage: true });
    console.log(`  teléfono             ${fuera.length} desbordes`);
    await contexto.close();
  }

  /* ----------------------------------------------------- 6: el celular del vendedor */
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, 'sign-in-demo-vendedor');
    await pagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
    await pagina.locator('[data-testid="mi-disponibilidad"]').waitFor({ timeout: 10000 });
    const antes = await pagina.locator('[data-testid="mi-disponibilidad"]').innerText();
    if (!/Los viernes salgo a las 18:00/.test(antes)) {
      problemas.push('su celular no enseña su comentario de los viernes');
    }
    await pagina.locator('[data-testid="mi-disponibilidad-agregar"]').click();
    await pagina.locator('[data-testid="disponibilidad-hoja"]').waitFor({ timeout: 8000 });
    await pagina.locator('[data-testid="disponibilidad-dia-2"]').click();
    await pagina.locator('[data-testid="disponibilidad-nota"]').fill('Tengo clases');
    await pagina.locator('[data-testid="disponibilidad-guardar"]').click();
    await pagina
      .locator('[data-testid="disponibilidad-hoja"]')
      .waitFor({ state: 'detached', timeout: 8000 })
      .catch(() => problemas.push('en el celular, guardar no cierra la hoja'));
    await esperar(pagina);
    const despues = await pagina.locator('[data-testid="mi-disponibilidad"]').innerText();
    if (!/No puedo/.test(despues) || !/Tengo clases/.test(despues) || !/sin ver/.test(despues)) {
      problemas.push(
        `lo agregado desde el celular no sale como enviado: «${despues.replace(/\s+/g, ' ').slice(0, 160)}»`,
      );
    }
    const enSuSemana = await cuenta(pagina, '[data-testid^="mi-disponibilidad-del-dia-"]');
    if (enSuSemana === 0) problemas.push('su semana no enseña lo que dijo al lado de su día');
    const fuera = await desborde(pagina);
    if (fuera.length > 0) problemas.push(`en el celular se sale: ${fuera.join(', ')}`);
    await pagina
      .locator('[data-testid="mi-disponibilidad"]')
      .screenshot({ path: 'capturas/disponibilidad-celular.png' });
    console.log(`  celular              agregado, ${enSuSemana} días de su semana lo enseñan`);
    await contexto.close();
  }

  /*
   * ¿QUIÉN LA TIENE DE VERDAD? (4-oct). Andree: «revisar si realmente los empleados tienen lo
   * de disponibilidad». La tiene quien ya entró al celular con su correo, y eso ahora lo dice
   * la ficha de Equipo. En la demo, la vendedora (ficha 1) ya entró; el resto, no.
   */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });
    await irPorElMenu(pagina, '/team');
    const vendedora = '33333333-3333-4333-8333-000000000001';
    const lectura = async (id) => {
      await pagina.locator(`[data-testid="team-member-${id}"]`).first().click();
      const fila = pagina.locator('[data-testid="employee-phone-access"]');
      await fila.waitFor({ timeout: 15000 }).catch(() => undefined);
      const texto =
        (await fila.count()) === 0 ? null : (await fila.innerText()).replace(/\s+/g, ' ');
      // Con su botón «Cerrar»: la hoja no se cierra con Escape en web.
      await pagina
        .locator('[data-testid="employee-detail-sheet"]')
        .getByRole('button', { name: 'Cerrar', exact: true })
        .first()
        .click();
      await pagina
        .locator('[data-testid="employee-detail-sheet"]')
        .waitFor({ state: 'detached', timeout: 10000 })
        .catch(() => undefined);
      await esperar(pagina, 500);
      return texto;
    };
    const ella = await lectura(vendedora);
    const otraFila = pagina.locator(
      `[data-testid^="team-member-"][role="button"]:not([data-testid="team-member-${vendedora}"])`,
    );
    const otraId = ((await otraFila.first().getAttribute('data-testid')) ?? '').slice(
      'team-member-'.length,
    );
    const otra = await lectura(otraId);
    if (ella === null || !/Ya entró/.test(ella))
      problemas.push(`la ficha de la vendedora no dice que ya entró al celular: «${ella}»`);
    if (otra === null || /Ya entró/.test(otra))
      problemas.push(`la ficha de alguien que nunca entró dice otra cosa: «${otra}»`);
    console.log(`  acceso al celular    vendedora «${ella}» · otra «${otra}»`);
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
console.log('\nOK: la disponibilidad se escribe en el celular y se ve en Equipo y en el Horario.');
