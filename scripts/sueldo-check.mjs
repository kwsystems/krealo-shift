/**
 * EL SUELDO APROXIMADO DEL MES (13-oct).
 *
 * Andree: «que cada uno pueda ver más o menos aproximadamente cuánto es el sueldo que se
 * gana… si faltó dos días y no ha justificado, tienen que ser descuento… pero siempre poner
 * que es un aproximado, que al final eso se va a ver en su boleta».
 *
 * En la demostración —la vendedora tiene sueldo, una falta justificada la semana pasada y,
 * si hoy no es lunes, otra sin revisar esta semana—:
 *
 * 1. LA MISMA CIFRA EN LOS DOS SITIOS: su ficha de Equipo y su celular dicen el mismo total,
 *    y los dos dicen que es un aproximado y que lo que vale es la boleta.
 * 2. UNA DECISIÓN EN HORAS LO MUEVE: justificar la falta sin revisar lo SUBE en Equipo (o, sin
 *    falta sin revisar, quitarle la justificación a la de la semana pasada lo BAJA). Y la
 *    línea de la falta vale el día más su sexto de descanso: S/ 1,500 → S/ 58.33.
 * 3. PONER UN SUELDO: a quien no tiene, «Poner su sueldo»; un monto sin sentido dice por qué
 *    no se guarda; uno por debajo del mínimo lo avisa; y al guardar sale su tarjeta.
 * 4. UN GERENTE DE SEDE NO LO VE: lo comprueban las reglas (`reglas.test.ts`); aquí, que el
 *    celular de la vendedora no enseña ningún formulario.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/sueldo-check.mjs dist-demo
 */
import {
  servirExport,
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/sueldo-check.mjs <export-demo>');
  process.exit(2);
}

// Por id, no por nombre: la lista dice el nombre corto («Ana»), que casa dentro de otros.
const VENDEDORA = '33333333-3333-4333-8333-000000000001';
const SIN_SUELDO = '33333333-3333-4333-8333-000000000004';

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8164);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const delante = (pagina, selector) =>
  pagina.locator(
    selector
      .split(',')
      .map((parte) => `${parte.trim()}:not([aria-hidden="true"] *)`)
      .join(', '),
  );
const esperar = (pagina, ms) => pagina.waitForTimeout(ms);
/** «S/ 1,234.56» → 1234.56 */
const monto = (texto) => {
  const m = (texto ?? '').match(/S\/\s*([\d,]+\.\d{2})/);
  return m === null ? null : Number(m[1].replace(/,/g, ''));
};

async function entrar(pagina, quien = 'sign-in-demo') {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator(`[data-testid="${quien}"]`).click();
}

async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 1200 });
}

async function abrirFicha(pagina, empleado) {
  await irPorElMenu(pagina, '/team');
  await delante(pagina, `[data-testid="team-member-${empleado}"]`).first().click();
  const hoja = pagina.locator('[data-testid="employee-detail-sheet"]');
  await hoja.waitFor({ timeout: 10000 });
  await pagina
    .locator('[data-testid="sueldo-de-la-persona"]')
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => problemas.push(`la ficha de ${empleado} no tiene el bloque del sueldo`));
  await esperar(pagina, 1500);
  return hoja;
}

async function cerrarFicha(pagina) {
  const hoja = pagina.locator('[data-testid="employee-detail-sheet"]');
  const boton = hoja.getByText('Cerrar', { exact: true });
  if ((await boton.count()) > 0) await boton.first().click();
  await hoja.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
}

const totalEn = async (raiz) =>
  monto(
    await raiz
      .locator('[data-testid="sueldo-total"]')
      .first()
      .innerText()
      .catch(() => ''),
  );
const lineaEn = async (raiz, clave) => {
  const linea = raiz.locator(`[data-testid="sueldo-linea-${clave}"]`);
  if ((await linea.count()) === 0) return null;
  return monto(await linea.first().innerText());
};

async function revisarAviso(raiz, donde) {
  const aviso = await raiz
    .locator('[data-testid="sueldo-aviso"]')
    .first()
    .innerText()
    .catch(() => '');
  if (!/aproximado/i.test(aviso) || !/boleta/i.test(aviso)) {
    problemas.push(`${donde}: no dice que es un aproximado y que vale la boleta («${aviso}»)`);
  }
}

try {
  /* ------------------------------------------- 1. la misma cifra en los dos sitios */
  const celular = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pCel = await celular.newPage();
  await pCel.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pCel, MARCADOR_ACCESO, { asentar: 0 });
  await pCel.locator('[data-testid="sign-in-demo-vendedor"]').click();
  await pCel.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
  const tarjetaCel = pCel.locator('[data-testid="sueldo-del-mes"]');
  await tarjetaCel.waitFor({ timeout: 15000 }).catch(() => undefined);
  const enCelular = await totalEn(pCel);
  console.log(`  celular              ${enCelular}`);
  if (enCelular === null) problemas.push('el celular de la vendedora no enseña su sueldo');
  else await revisarAviso(pCel, 'celular');
  if (
    (await pCel
      .locator('[data-testid="sueldo-formulario"], [data-testid="sueldo-cambiar"]')
      .count()) > 0
  ) {
    problemas.push('el celular de la vendedora ofrece cambiar su sueldo');
  }
  if ((await tarjetaCel.count()) > 0) {
    await tarjetaCel.first().scrollIntoViewIfNeeded();
    await tarjetaCel.first().screenshot({ path: 'capturas/sueldo-celular.png' });
  }
  await celular.close();

  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  await entrar(pagina);
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 800 });

  let hoja = await abrirFicha(pagina, VENDEDORA);
  const enEquipo = await totalEn(hoja);
  const sinRevisar = await lineaEn(hoja, 'sin-revisar');
  const faltas = await lineaEn(hoja, 'faltas');
  console.log(
    `  equipo               ${enEquipo} (sin revisar ${sinRevisar}, sin justificar ${faltas})`,
  );
  if (enEquipo === null) problemas.push('la ficha de Equipo no enseña el sueldo de la vendedora');
  else await revisarAviso(hoja, 'Equipo');
  if (enCelular !== null && enEquipo !== null && enCelular !== enEquipo) {
    problemas.push(`el celular dice ${enCelular} y Equipo ${enEquipo}`);
  }
  if ((await hoja.locator('[data-testid="sueldo-justificadas"]').count()) === 0) {
    problemas.push('la falta justificada no se dice («no se descuenta»)');
  }
  await hoja
    .locator('[data-testid="sueldo-de-la-persona"]')
    .first()
    .screenshot({ path: 'capturas/sueldo-equipo.png' })
    .catch(() => undefined);
  await cerrarFicha(pagina);

  /* ------------------------------------------- 2. una decisión en Horas lo mueve */
  await irPorElMenu(pagina, '/hours');
  const conSinRevisar = sinRevisar !== null;
  if (!conSinRevisar) {
    // Lunes: la de esta semana todavía no existe. Se usa la de la semana pasada.
    await delante(pagina, '[data-testid="week-previous"]').first().click();
    await esperar(pagina, 1500);
  }
  const porque = delante(pagina, '[data-testid^="falta-"][data-testid$="-porque"]');
  if ((await porque.count()) === 0) {
    problemas.push('Horas no enseña la falta de la vendedora');
  } else {
    await porque.first().click();
    await pagina.locator('[data-testid="justificar-falta-hoja"]').waitFor({ timeout: 8000 });
    const tipo = conSinRevisar ? 'justified' : 'unjustified';
    const motivo = conSinRevisar ? 'medical' : 'no_notice';
    await pagina.locator(`[data-testid="justificar-falta-tipo-${tipo}"]`).click();
    await pagina.locator(`[data-testid="justificar-falta-${motivo}"]`).click();
    await pagina.locator('[data-testid="justificar-falta-guardar"]').click();
    await pagina
      .locator('[data-testid="justificar-falta-hoja"]')
      .waitFor({ state: 'detached', timeout: 8000 })
      .catch(() => problemas.push('la hoja de la falta no se cerró al guardar'));
    await esperar(pagina, 1200);

    hoja = await abrirFicha(pagina, VENDEDORA);
    const despues = await totalEn(hoja);
    const lineaDespues = await lineaEn(hoja, conSinRevisar ? 'sin-revisar' : 'faltas');
    console.log(
      `  tras ${conSinRevisar ? 'justificarla' : 'quitarle la justificación'}   ${despues} (línea ${lineaDespues})`,
    );
    if (despues === null || enEquipo === null) {
      problemas.push('tras decidir la falta, la ficha no enseña el sueldo');
    } else if (conSinRevisar && !(despues > enEquipo)) {
      problemas.push(`justificar la falta no sube el sueldo: ${enEquipo} → ${despues}`);
    } else if (!conSinRevisar && !(despues < enEquipo)) {
      problemas.push(`una falta sin justificar no baja el sueldo: ${enEquipo} → ${despues}`);
    }
    if (conSinRevisar && lineaDespues !== null) {
      problemas.push('la falta justificada sigue en «sin revisar»');
    }
    // El día y su sexto de descanso, de S/ 1,500: 50 × 7/6.
    const valorDeUna = conSinRevisar ? sinRevisar : lineaDespues;
    if (valorDeUna !== null && Math.abs(valorDeUna - 58.33) > 0.01) {
      problemas.push(`una falta de S/ 1,500 al mes vale ${valorDeUna}, no S/ 58.33`);
    }
    await cerrarFicha(pagina);
  }

  /* ------------------------------------------- 3. poner un sueldo */
  hoja = await abrirFicha(pagina, SIN_SUELDO);
  const poner = hoja.locator('[data-testid="sueldo-poner"]');
  if ((await poner.count()) === 0) {
    problemas.push('la ficha de alguien sin sueldo no ofrece «Poner su sueldo»');
  } else {
    await poner.first().click();
    const campo = hoja.locator('[data-testid="sueldo-monto"]').first();
    await campo.fill('mil');
    await hoja.locator('[data-testid="sueldo-guardar"]').first().click();
    await esperar(pagina, 400);
    if ((await hoja.locator('[data-testid="sueldo-por-que-no"]').count()) === 0) {
      problemas.push('un sueldo escrito con letras no dice por qué no se guarda');
    }
    await campo.fill('900');
    await esperar(pagina, 200);
    if ((await hoja.locator('[data-testid="sueldo-monto-menor-rmv"]').count()) === 0) {
      problemas.push('un sueldo de S/ 900 no avisa que está por debajo del mínimo');
    }
    await campo.fill('1,800');
    await esperar(pagina, 200);
    const seGuarda = await hoja
      .locator('[data-testid="sueldo-monto-se-guarda"]')
      .first()
      .innerText()
      .catch(() => '');
    if (monto(seGuarda) !== 1800) problemas.push(`«1,800» se iba a guardar como «${seGuarda}»`);
    await hoja.locator('[data-testid="sueldo-pension-onp"]').first().click();
    await hoja.locator('[data-testid="sueldo-guardar"]').first().click();
    await hoja
      .locator('[data-testid="sueldo-del-mes"]')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => problemas.push('al guardar el sueldo no sale su tarjeta'));
    const base1800 = await lineaEn(hoja, 'base');
    const pension = await lineaEn(hoja, 'pension');
    console.log(`  sueldo nuevo         base ${base1800}, ONP ${pension}`);
    if (base1800 !== 1800) problemas.push(`el sueldo guardado dice ${base1800}, no 1800`);
    if (pension === null) problemas.push('con ONP no se descuenta la pensión');
    await hoja
      .locator('[data-testid="sueldo-de-la-persona"]')
      .first()
      .screenshot({ path: 'capturas/sueldo-nuevo.png' })
      .catch(() => undefined);
  }

  if (errores.length > 0) problemas.push(`errores en la página: ${errores.join(' | ')}`);
  await contexto.close();
} catch (error) {
  problemas.push(`el arnés se cayó: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error('\nPROBLEMAS:');
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK: el sueldo aproximado cuadra en el celular y en Equipo, y se mueve con Horas.');
