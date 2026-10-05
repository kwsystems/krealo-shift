#!/usr/bin/env node
/**
 * ¿VE EL VENDEDOR LO SUYO, SOLO LO SUYO, Y SE LEE EN SU CELULAR?
 *
 * POR QUÉ EXISTE. El 30-sep se añadió la vista del vendedor: cada persona entra con su
 * correo y ve su horario, sus horas del mes y si llegó a tiempo. Andree pidió dos cosas
 * por encima de todo: que solo vean lo suyo y que funcione en el celular. Las pruebas de
 * reglas cubren lo primero en el servidor; aquí se mira lo que ve la persona:
 *
 *   1. que entrar como vendedor lleve a SU vista y no al panel, y que el panel no se abra
 *      aunque escriba la dirección;
 *   2. que la pantalla tenga lo que se pidió: hoy, la semana (esta y la próxima) y el mes;
 *   3. que no aparezca el nombre de NADIE más del equipo, salvo en «con quién le toca» y en
 *      el horario de toda la tienda (5-oct), que Andree pidió que viera;
 *   4. que a 360, 390 y 414 px no haya nada que se arrastre de lado ni se salga, y que a
 *      1280 siga siendo una columna legible;
 *   5. y que se pueda cerrar sesión, que en un celular prestado importa.
 *
 * La demostración guarda los datos en memoria: todo va sin recargar salvo donde se dice.
 *
 * USO
 *   npm run demo:export
 *   node scripts/vendedor-check.mjs dist-demo
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  servirExport,
} from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8220;
const CAPTURAS = process.env.VENDEDOR_SHOTS ?? '/tmp/ks-vendedor';

/**
 * El resto del equipo de la demostración (`src/lib/demo/seed.ts`). El vendedor es la
 * ficha 1, Ana; ninguno de estos puede aparecer en su pantalla.
 */
const OTROS = [
  'Bruno',
  'Carla',
  'Diego',
  'Elena',
  'Fabián',
  'Gaby',
  'Héctor',
  'María Fernanda',
  'Julio',
  'Karina',
];

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

async function entrarComoVendedor(pagina, consulta = '') {
  await pagina.goto(`${base}/${consulta}`, { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo-vendedor"]').click();
  await pagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
  await pagina.waitForTimeout(600);
}

/** Lo que se sale del ancho: el documento y cualquier caja con texto. */
async function desborde(pagina) {
  return pagina.evaluate(() => {
    const vista = document.documentElement.clientWidth;
    const arrastre = document.documentElement.scrollWidth - vista;
    const culpables = [];
    for (const nodo of Array.from(document.querySelectorAll('[data-testid="mi-horario"] div'))) {
      const caja = nodo.getBoundingClientRect();
      if (caja.width > 0 && caja.right > vista + 1) {
        culpables.push(`${Math.round(caja.right)}px «${(nodo.textContent ?? '').slice(0, 30)}»`);
      }
    }
    return { arrastre, culpables: culpables.slice(0, 3) };
  });
}

try {
  /* ------------------------------------------------------------------ */
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await ctx.newPage();
  await entrarComoVendedor(pagina);

  const caso1 = 'entrar como vendedor lleva a su vista, no al panel';
  const url = new URL(pagina.url()).pathname;
  const conMenu = await pagina.locator('a[href="/team"]').count();
  if (url !== '/me') fallar(caso1, `terminó en ${url}`);
  else if (conMenu > 0) fallar(caso1, 'se ve el menú del panel');
  else pasa(caso1, '/me, sin menú del panel');

  /* ------------------------------------------------------------------ */
  const caso2 = 'tiene hoy, la semana y el mes';
  const faltan = [];
  for (const id of ['mi-horario-hoy', 'mi-horario-dias', 'mi-horario-mes', 'mi-horario-horas']) {
    if ((await pagina.locator(`[data-testid="${id}"]`).count()) === 0) faltan.push(id);
  }
  const diasSemana = await pagina.locator('[data-testid^="mi-horario-dia-"]').count();
  await pagina.screenshot({ path: join(CAPTURAS, '1-vendedor-390.png'), fullPage: true });
  await pagina.locator('[data-testid="mi-horario-semana-proxima"]').click();
  await pagina.waitForTimeout(400);
  const diasProxima = await pagina
    .locator('[data-testid="mi-horario-dias"] [data-testid^="mi-horario-dia-"]')
    .count();
  /*
   * LA DEMO NO TIENE NADA PUBLICADO LA PRÓXIMA SEMANA, y eso es lo que se mide (4-oct): antes
   * salían siete filas «Libre» y debajo, en pequeño, que no estaba publicado. Ahora lo dice
   * en lugar de las filas: lo primero que se lee no puede decir lo contrario de lo que pasa.
   */
  const sinPublicar = await pagina
    .locator('[data-testid="mi-horario-semana-sin-publicar"]')
    .count();
  await pagina.screenshot({ path: join(CAPTURAS, '2-proxima-390.png'), fullPage: true });
  await pagina.locator('[data-testid="mi-horario-semana-esta"]').click();
  if (faltan.length > 0) fallar(caso2, `falta: ${faltan.join(', ')}`);
  else if (sinPublicar === 0 || diasProxima > 0)
    fallar(
      caso2,
      `la próxima semana no está publicada y enseña ${diasProxima} filas de día` +
        (sinPublicar === 0 ? ' sin decir que falta publicarla' : ''),
    );
  else
    pasa(
      caso2,
      `${diasSemana} filas de día en pantalla; la próxima, «no tienes turnos publicados» en vez de 7 días «Libre»`,
    );

  /* ------------------------------------------------------------------ */
  /*
   * UN TURNO QUE QUIEN GESTIONA ESTÁ CAMBIANDO (4-oct): se le publicó y se editó sin volver
   * a publicar. Antes desaparecía y el día decía «Libre». El escenario `cambiado` de la demo
   * deja así su último turno publicado de esta semana.
   */
  const casoCambiado = 'un turno que se está cambiando sale «por confirmar», no «Libre»';
  {
    const c = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    await entrarComoVendedor(p, '?escenario=cambiado');
    const aviso = p.locator('[data-testid^="mi-horario-por-confirmar-"]');
    if ((await aviso.count()) === 0) {
      fallar(casoCambiado, 'ningún día dice que su turno está por confirmar');
    } else {
      const dia = (await aviso.first().getAttribute('data-testid')).replace(
        'mi-horario-por-confirmar-',
        '',
      );
      // La de la SEMANA: el mismo día puede salir también en la lista del mes.
      const fila = (
        await p
          .locator(`[data-testid="mi-horario-dias"] [data-testid="mi-horario-dia-${dia}"]`)
          .innerText()
      ).replace(/\s+/g, ' ');
      if (/\bLibre\b/.test(fila)) fallar(casoCambiado, `el ${dia} dice «Libre»: ${fila}`);
      // Solo ese turno: la insignia. Con otro publicado el mismo día manda el publicado y el
      // que cambia se dice aparte, «Además, por confirmar: …».
      /*
       * Y SI ESTÁ TRABAJANDO EN ESE TURNO, la insignia dice «Trabajando» y el cambio lo dice
       * la frase de debajo (5-oct): el arnés fallaba entre las 9 y las 15 sin que la app
       * dejara de decirlo.
       */
      else if (!/Por confirmar|por confirmar:|está cambiando este turno/.test(fila))
        fallar(casoCambiado, `el ${dia} no dice que su turno está por confirmar: ${fila}`);
      else pasa(casoCambiado, `${dia}: ${fila.slice(0, 90)}`);
      await p.screenshot({ path: join(CAPTURAS, '2b-por-confirmar-390.png'), fullPage: true });
    }
    await c.close();
  }

  /* ------------------------------------------------------------------ */
  /*
   * UN DÍA CUMPLIDO POR MOTIVO ESPECIAL (4-oct): miembro de mesa. Su celular tiene que
   * decirlo, igual que Horario, Horas y Reportes. El escenario `cumplido` de la demo deja así
   * su última jornada terminada.
   */
  const casoCumplido = 'un día cumplido como miembro de mesa lo dice en su celular';
  {
    const c = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    await entrarComoVendedor(p, '?escenario=cumplido');
    const visto = await p.getByText(/Cumplido · Miembro de mesa/).count();
    if (visto === 0)
      fallar(casoCumplido, 'ni su semana ni su mes dicen «Cumplido · Miembro de mesa»');
    else pasa(casoCumplido, `${visto} vez/veces`);
    await p.screenshot({ path: join(CAPTURAS, '2c-cumplido-390.png'), fullPage: true });
    await c.close();
  }

  /* ------------------------------------------------------------------ */
  /*
   * NADIE MÁS, SALVO DONDE SE DICE CON QUIÉN LE TOCA (5-oct). Andree pidió que cada persona
   * vea también el horario de la tienda: los nombres del equipo salen ahora en la línea «Con
   * Bruno» de sus turnos y en «Toda la tienda», y en NINGÚN otro sitio de su pantalla.
   */
  const caso3 = 'no aparece nadie más del equipo fuera de «con quién le toca»';
  const texto = await pagina.locator('[data-testid="mi-horario"]').evaluate((nodo) => {
    const copia = nodo.cloneNode(true);
    for (const quitar of copia.querySelectorAll(
      '[data-testid^="mi-horario-con-"], [data-testid="mi-horario-tienda"]',
    ))
      quitar.remove();
    return copia.textContent ?? '';
  });
  const vistos = OTROS.filter((nombre) => texto.includes(nombre));
  if (vistos.length > 0) fallar(caso3, `se ven: ${vistos.join(', ')}`);
  else pasa(caso3);

  /* ------------------------------------------------------------------ */
  /*
   * EL HORARIO DE TODA LA TIENDA (5-oct): «para que sepan con quién estarán en horario».
   * Siete días, su fila marcada «Tú» con las MISMAS horas que en «Solo yo», el resto del
   * equipo con su puesto, ninguna nota de nadie, y debajo de su turno, con quién coincide.
   */
  const caso7 = 've el horario de toda la tienda y con quién le toca';
  {
    const conQuien = await pagina.locator('[data-testid^="mi-horario-con-"]').allInnerTexts();
    const semanaSuya = (
      await pagina.locator('[data-testid="mi-horario-dias"]').innerText()
    ).replace(/\s+/g, ' ');
    await pagina.locator('[data-testid="mi-horario-vista-tienda"]').click();
    await pagina.locator('[data-testid="mi-horario-tienda"]').waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(400);
    const tienda = pagina.locator('[data-testid="mi-horario-tienda"]');
    const dias = await tienda.locator('[data-testid^="tienda-dia-"]').count();
    const mios = (await tienda.locator('[data-testid^="tienda-mio-"]').allInnerTexts()).map((t) =>
      t.replace(/\s+/g, ' '),
    );
    const otros = await tienda.locator('[data-testid^="tienda-turno-"]').allInnerTexts();
    const textoTienda = await tienda.innerText();
    const rango = (t) => (/\d{2}:\d{2}\s*–\s*\d{2}:\d{2}/.exec(t) ?? [''])[0].replace(/\s+/g, ' ');
    const horasDistintas = mios.filter((t) => !semanaSuya.includes(rango(t)));
    const companeros = OTROS.filter((n) => textoTienda.includes(n));
    // Cada línea es «<icono>\nCon Bruno, Carla y Diego»: lo de después de «Con ».
    const nombresConQuien = conQuien
      .filter((linea) => linea.includes('Con '))
      .flatMap((linea) => linea.slice(linea.indexOf('Con ') + 4).split(/,|\sy\s|\s\d+\smás/))
      .map((n) => n.trim())
      .filter((n) => n !== '');
    const conQuienFuera = nombresConQuien.filter(
      (n) => !n.startsWith('Nadie') && !textoTienda.includes(n),
    );
    await pagina.screenshot({ path: join(CAPTURAS, '4-tienda-390.png'), fullPage: true });
    const medida = await desborde(pagina);

    if (dias !== 7) fallar(caso7, `la semana de la tienda tiene ${dias} días`);
    else if (mios.length === 0 || !mios.every((t) => t.startsWith('Tú')))
      fallar(caso7, `su fila no va marcada «Tú»: ${JSON.stringify(mios)}`);
    else if (horasDistintas.length > 0)
      fallar(caso7, `sus horas no son las de «Solo yo»: ${horasDistintas.join(' | ')}`);
    else if (otros.length === 0 || companeros.length === 0)
      fallar(caso7, 'no sale nadie más del equipo en «Toda la tienda»');
    else if (/Trae la llave/.test(textoTienda))
      fallar(caso7, 'una nota de turno se ve en el horario de la tienda');
    else if (conQuien.length === 0) fallar(caso7, 'debajo de sus turnos no dice con quién le toca');
    else if (conQuienFuera.length > 0)
      fallar(
        caso7,
        `«${conQuien[0]}» nombra a quien no está en la tienda: ${conQuienFuera.join(', ')}`,
      );
    else if (medida.arrastre > 1 || medida.culpables.length > 0)
      fallar(caso7, `se sale a 390: ${medida.arrastre} px ${medida.culpables.join(' | ')}`);
    else
      pasa(
        caso7,
        `7 días, ${mios.length} suyo(s) con sus horas, ${otros.length} del equipo; «${conQuien[0].trim()}»`,
      );
    await pagina.locator('[data-testid="mi-horario-vista-mia"]').click();
  }

  /* ------------------------------------------------------------------ */
  const caso4 = 'el panel no se abre aunque escriba la dirección';
  await pagina.goto(`${base}/team`, { waitUntil: 'networkidle' });
  try {
    await pagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 20000 });
    const fin = new URL(pagina.url()).pathname;
    if (fin !== '/me') fallar(caso4, `/team terminó en ${fin}`);
    else pasa(caso4, '/team lo devuelve a /me');
  } catch {
    fallar(caso4, '/team no lo devolvió a su vista');
  }
  await ctx.close();

  /* ------------------------------------------------------------------ */
  const caso5 = 'cabe en el celular y se lee en el ordenador';
  const salidas = [];
  for (const [ancho, alto] of [
    [360, 740],
    [390, 844],
    [414, 896],
    [1280, 900],
  ]) {
    const c = await navegador.newContext({ viewport: { width: ancho, height: alto } });
    const p = await c.newPage();
    await entrarComoVendedor(p);
    const medida = await desborde(p);
    if (medida.arrastre > 1) salidas.push(`${ancho}: se arrastra ${medida.arrastre} px de lado`);
    if (medida.culpables.length > 0) salidas.push(`${ancho}: ${medida.culpables.join(' | ')}`);
    if (ancho === 1280) {
      const columna = await p
        .locator('[data-testid="mi-horario-dias"]')
        .evaluate((n) => Math.round(n.getBoundingClientRect().width));
      if (columna > 600)
        salidas.push(`1280: la lista mide ${columna} px, no es una columna legible`);
      await p.screenshot({ path: join(CAPTURAS, '3-vendedor-1280.png') });
    }
    await c.close();
  }
  if (salidas.length > 0) fallar(caso5, salidas.join('; '));
  else pasa(caso5, '360, 390 y 414 sin arrastre; 1280 en una columna');

  /* ------------------------------------------------------------------ */
  const caso6 = 'se puede cerrar sesión';
  const c = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await entrarComoVendedor(p);
  await p.locator('[data-testid="mi-horario-salir"]').click();
  try {
    await esperarPantalla(p, MARCADOR_ACCESO, { timeout: 20000, asentar: 0 });
    pasa(caso6);
  } catch {
    fallar(caso6, 'cerrar sesión no volvió a la pantalla de acceso');
  }
  await c.close();
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nVENDEDOR — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nVENDEDOR — OK: entra a su vista, ve lo suyo y el horario de su tienda, cabe en el celular y puede salir.',
);
