/**
 * Las marcas fuera de horario (Andree, 1-oct).
 *
 * «Deberías dejar marcar en la tablet aunque lleguen muy temprano o marquen muy tarde…
 * si marcan 1 hora antes, eso sí debes avisarme, ya veo yo si cambio de horario o es hora
 * extra… solo avisar en horario». Lo que se comprueba, en la demostración:
 *
 * 1. HORARIO AVISA de quien entró una hora o más antes de su turno y de quien salió una
 *    hora o más después, con las dos clases de marca, y pliega lo que pasa de tres. Empieza
 *    plegado en una línea que dice cuántas y de quién; «Revisar» lo abre.
 * 2. «RESOLVER EN HORAS» LLEVA A SU CASO: Horas se abre en esa semana, filtrada a esa
 *    persona, con el caso «fuera de turno» en «Por resolver» y SIN la jornada encima.
 *    Horario ya no tiene «Visto»: decidir es solo en Horas (6-oct, «debería centrarse solo
 *    en Horas»).
 * 3. DECIDIDO EN HORAS, SE VA DE HORARIO: «No es extra» (o «Está bien así») quita el caso
 *    de Horas y, al volver, el aviso de ese día en Horario, y solo ese.
 * 4. CAMBIAR SU TURNO Y PUBLICAR quita el aviso solo: la jornada se vuelve a medir contra
 *    el turno nuevo. Es la sincronización que Andree pidió en todas partes.
 * 5. AJUSTES ya no ofrece «Tolerancia de entrada temprana» —el reloj no frena a nadie— y sí
 *    el umbral del aviso.
 * 6. EN UN TELÉFONO el aviso cabe.
 *
 * La semana es la ANTERIOR: la demostración la siembra entera, así que el arnés no depende
 * del día de la semana en que se corra.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/marcas-check.mjs dist-demo
 */
import { mkdirSync } from 'node:fs';

import {
  servirExport,
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
  irA,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/marcas-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8135);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
}

/**
 * El aviso empieza plegado en una línea (1-oct): «Revisar» lo abre. Si ya está abierto, no
 * hace nada.
 */
async function abrirAviso(pagina) {
  const boton = pagina.locator('[data-testid="marcas-fuera-del-turno-abrir"]');
  if ((await boton.count()) === 0) return;
  if (/Revisar/.test(await boton.innerText())) {
    await boton.click();
    await pagina.waitForTimeout(300);
  }
}

/** Las filas del aviso que se ven: `{ id, texto }`. */
async function filas(pagina) {
  await abrirAviso(pagina);
  return pagina.locator('[data-testid^="marca-rara-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => ({ id: n.getAttribute('data-testid').slice('marca-rara-'.length), n }))
      .filter(({ id }) => !/-(turno|horas|visto)$/.test(id))
      .map(({ id, n }) => ({ id, texto: (n.innerText || '').replace(/\s+/g, ' ').trim() })),
  );
}

const esperar = (pagina, ms = 1200) => pagina.waitForTimeout(ms);

{
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);
  await irA(pagina, base, '/schedule', { asentar: 1200 });
  await pagina.locator('[data-testid="week-previous"]').click();
  await esperar(pagina, 1800);

  // --- 1. El aviso, con las dos clases y plegado.
  if ((await pagina.locator('[data-testid="marcas-fuera-del-turno"]').count()) === 0) {
    problemas.push('Horario no avisa de ninguna marca fuera de horario en la semana anterior');
  }
  // Plegado, en una línea, dice cuántas y de quién: el aviso no se pierde por plegarse.
  const resumen = await pagina
    .locator('[data-testid="marcas-fuera-del-turno-resumen"]')
    .innerText()
    .catch(() => '');
  if (!/·/.test(resumen)) {
    problemas.push(`plegado, el aviso no dice de quién son las marcas: «${resumen}»`);
  }
  console.log(`  plegado              «${resumen}»`);
  await pagina.locator('[data-testid="marcas-fuera-del-turno"]').screenshot({
    path: 'capturas/marcas-horario-plegado.png',
  });
  const plegadas = await filas(pagina);
  const plegar = pagina.locator('[data-testid="marcas-fuera-del-turno-todas"]');
  if ((await plegar.count()) > 0) {
    if (plegadas.length !== 3) {
      problemas.push(`plegado, el aviso enseña ${plegadas.length} filas y no 3`);
    }
    await plegar.click();
    await esperar(pagina, 400);
  }
  const todas = await filas(pagina);
  const entradas = todas.filter((f) => /Entró .* antes de su turno/.test(f.texto));
  const salidas = todas.filter((f) => /Salió .* después de su turno/.test(f.texto));
  if (entradas.length === 0) problemas.push('el aviso no tiene ninguna entrada temprana');
  if (salidas.length === 0) problemas.push('el aviso no tiene ninguna salida tarde');
  for (const fila of todas) {
    if (!/\d+ (h|min)/.test(fila.texto)) {
      problemas.push(`la fila «${fila.texto}» no dice cuánto fuera del turno`);
    }
  }
  console.log(
    `  aviso                ${todas.length} marcas (${entradas.length} entradas, ${salidas.length} salidas)`,
  );
  await pagina.locator('[data-testid="marcas-fuera-del-turno"]').screenshot({
    path: 'capturas/marcas-horario.png',
  });

  // Horario ya no decide: ninguna fila tiene «Visto» (6-oct).
  const vistos = await pagina
    .locator('[data-testid^="marca-rara-"][data-testid$="-visto"]')
    .count();
  if (vistos > 0) {
    problemas.push(`Horario sigue ofreciendo «Visto» en ${vistos} filas: se decide en Horas`);
  }

  // --- 2. «Resolver en Horas» lleva a su caso en «Por resolver», sin la jornada encima.
  const primera = todas[0];
  /** «Ana lun 28»: quién y qué día. Decidir es por persona y día. */
  const quienYDia = (fila) => fila.texto.split(/ (?:Entró|Salió) /)[0];
  if (primera !== undefined) {
    const jornada = primera.id.split(':')[0];
    const boton = pagina.locator(`[data-testid="marca-rara-${primera.id}-horas"]`);
    const rotulo = (await boton.innerText()).trim();
    // La semana anterior está entera cerrada: el botón resuelve, no solo mira.
    if (rotulo !== 'Resolver en Horas') {
      problemas.push(`con el día cerrado el botón dice «${rotulo}», no «Resolver en Horas»`);
    }
    await boton.click();
    const idCaso = `${jornada}:fuera_de_turno`;
    const caso = pagina.locator(`[data-testid="caso-${idCaso}"]`);
    try {
      await caso.waitFor({ timeout: 10000 });
    } catch {
      problemas.push(`«Resolver en Horas» no enseña su caso en «Por resolver» (${idCaso})`);
    }
    const url = new URL(pagina.url());
    if (!url.pathname.endsWith('/hours') || url.searchParams.get('persona') === null) {
      problemas.push(`«Resolver en Horas» lleva a ${url.pathname}${url.search}`);
    }
    if ((await pagina.locator('[data-testid="session-detail-sheet"]').count()) > 0) {
      problemas.push('«Resolver en Horas» abre la jornada encima del caso y lo tapa');
    }
    console.log(`  resolver en horas    ${url.pathname}${url.search}`);
    await pagina.screenshot({ path: 'capturas/marcas-horas.png' });

    // --- 3. Se decide en Horas y el aviso se va de Horario.
    let decision = null;
    if ((await caso.count()) > 0) {
      const noExtra = pagina.locator(`[data-testid="caso-${idCaso}-no-extra"]`);
      const bienAsi = pagina.locator(`[data-testid="caso-${idCaso}-visto"]`);
      decision = (await noExtra.count()) > 0 ? 'no es extra' : 'está bien así';
      await (decision === 'no es extra' ? noExtra : bienAsi).first().click();
      try {
        await caso.waitFor({ state: 'detached', timeout: 8000 });
      } catch {
        problemas.push(`«${decision}» no quita el caso de «Por resolver»`);
      }
    }
    const aHorario = pagina.locator('a[href$="/schedule"]').first();
    if ((await aHorario.count()) > 0) await aHorario.click();
    else await pagina.goBack();
    await pagina.locator('[data-testid="schedule-view"]').waitFor({ timeout: 10000 });
    await esperar(pagina);
    // Si Horario se volvió a montar, está otra vez en esta semana.
    const enEstaSemana = (lista) =>
      lista.some((f) => todas.some((g) => g.id === f.id)) || lista.length === 0;
    if (!enEstaSemana(await filas(pagina))) {
      await pagina.locator('[data-testid="week-previous"]').click();
      await esperar(pagina, 1500);
    }
    // Desplegada entera, sea cual sea el estado en que se quedó: «Ver N más» la abre.
    if ((await plegar.count()) > 0 && /Ver \d+ más/.test(await plegar.innerText())) {
      await plegar.click();
      await esperar(pagina, 400);
    }
    const despues = await filas(pagina);
    if (despues.some((f) => f.id.startsWith(`${jornada}:`))) {
      problemas.push(`decidido en Horas («${decision}»), Horario sigue avisando de esa marca`);
    }
    const otras = todas.filter((f) => quienYDia(f) !== quienYDia(primera));
    const perdidas = otras.filter((f) => !despues.some((g) => g.id === f.id));
    if (perdidas.length > 0) {
      problemas.push(
        `decidir un día en Horas quitó también ${perdidas.length} avisos de otros días o personas`,
      );
    }
    console.log(`  decidido en horas    «${decision}»: ${todas.length} → ${despues.length}`);
  }

  // --- 4. Cambiar su turno a la hora a la que entró, publicar, y el aviso se va.
  const temprana = (await filas(pagina)).find((f) => /Entró .* antes de su turno/.test(f.texto));
  const hora = /entró a las (\d\d:\d\d)/.exec(temprana?.texto ?? '')?.[1];
  const boton =
    temprana === undefined
      ? null
      : pagina.locator(`[data-testid="marca-rara-${temprana.id}-turno"]`);
  if (temprana === undefined || hora === undefined) {
    problemas.push('no hay una entrada temprana con su hora para probar el cambio de turno');
  } else if (boton === null || (await boton.count()) === 0) {
    problemas.push('la entrada temprana no ofrece «Cambiar su turno»');
  } else {
    await boton.click();
    await pagina.locator('[data-testid="shift-form-sheet"]').waitFor({ timeout: 10000 });
    await pagina.locator('[data-testid="shift-start"]').fill(hora);
    await pagina.locator('[data-testid="shift-form-save"]').click();
    await pagina.locator('[data-testid="shift-form-sheet"]').waitFor({ state: 'detached' });
    await esperar(pagina, 800);
    await pagina.locator('[data-testid="schedule-publish-all"]').click();
    await pagina.locator('[data-testid="confirm-sheet-confirm"]').click();
    await esperar(pagina, 2000);
    if ((await plegar.count()) > 0 && /Ver \d+ más/.test(await plegar.innerText())) {
      await plegar.click();
      await esperar(pagina, 400);
    }
    const tras = await filas(pagina);
    if (tras.some((f) => f.id === temprana.id)) {
      problemas.push(
        `cambiar su turno a las ${hora} y publicar no quita el aviso de su entrada temprana`,
      );
    }
    console.log(`  cambiar turno        a las ${hora}, publicado: ${tras.length} avisos quedan`);
  }

  // --- 5. Ajustes.
  await irA(pagina, base, '/settings', { asentar: 800 });
  const ajustes = await pagina.locator('body').innerText();
  if (/Tolerancia de entrada temprana/.test(ajustes)) {
    problemas.push(
      'Ajustes sigue ofreciendo «Tolerancia de entrada temprana», que ya no hace nada',
    );
  }
  if (!/marcas fuera del turno/.test(ajustes)) {
    // Puede estar dentro de una tarjeta plegada: se abre y se vuelve a mirar.
    const sede = pagina.locator('[data-testid^="location-card-"]').first();
    if ((await sede.count()) > 0) await sede.click().catch(() => undefined);
    await esperar(pagina, 600);
    if (!/marcas fuera del turno/.test(await pagina.locator('body').innerText())) {
      problemas.push('Ajustes no tiene el umbral «Avisar en Horario de marcas fuera del turno»');
    }
  }
  await contexto.close();
}

// --- 6. Teléfono.
{
  const contexto = await navegador.newContext({ viewport: { width: 360, height: 780 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);
  await irA(pagina, base, '/schedule', { asentar: 1200 });
  await pagina.locator('[data-testid="week-previous"]').click();
  await esperar(pagina, 1800);
  const sobra = await pagina.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (sobra > 0) problemas.push(`Horario con el aviso, a 360 px, se sale ${sobra} px`);
  const aviso = pagina.locator('[data-testid="marcas-fuera-del-turno"]');
  if ((await aviso.count()) > 0) {
    await aviso.screenshot({ path: 'capturas/marcas-telefono.png' });
  } else {
    problemas.push('en el teléfono, Horario no enseña el aviso');
  }
  await contexto.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA la comprobación de marcas fuera de horario:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log('\nOK: Horario avisa de las marcas fuera de horario y cada salida del aviso funciona.');
