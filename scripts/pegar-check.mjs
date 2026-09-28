/**
 * ¿ENTRA DE VERDAD UNA SEMANA PEGADA?
 *
 * POR QUÉ EXISTE. El importador de horarios se puede probar entero con pruebas unitarias
 * —y se prueba: 27 casos sobre el texto de una tabla real— pero eso mide el PARSEADOR, no
 * el camino. Entre el texto pegado y un turno que existe hay una hoja que se abre, un
 * cuadro de texto que recibe el pegado, una vista previa que tiene que cuadrar, un botón
 * que tiene que estar habilitado, una escritura en lote y una rejilla que tiene que
 * enseñar las horas nuevas. Un fallo en cualquiera de esos seis sitios deja las 27
 * pruebas en verde y el importador inservible.
 *
 * LO QUE MIDE, en el navegador de verdad:
 *   1. que la vista previa cuente los turnos que la tabla tiene y CUADRE con sus totales;
 *   2. que al crear, las horas de la rejilla pasen de 00:00 a las de la tabla;
 *   3. que entren como BORRADOR, o sea que aparezca la barra de publicar;
 *   4. y un control negativo: con un nombre que no existe, el botón NO deja crear.
 *
 * El paso 4 es el que hace que el verde de los otros tres signifique algo. Sin él, un
 * arnés que en realidad no está midiendo nada —la hoja no se abrió, el botón no es ese—
 * también daría verde, y eso ya ha pasado aquí dos veces en una sola tarde.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/pegar-check.mjs dist-demo
 */
import { servirExport, cargarPlaywright, esperarPantalla, sinGlifos, irA } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/pegar-check.mjs <export-demo>');
  process.exit(2);
}

/** «Ana Torres 00:00 esta semana» → el total. Sin el total no se puede comparar nada. */
const TOTAL = /(\d{1,3}:\d{2})\s*(?:esta semana|this week)/;

function totalDeLaCelda(texto) {
  const encontrado = TOTAL.exec(sinGlifos(texto ?? ''));
  return encontrado === null ? null : encontrado[1];
}

function nombreDeLaCelda(texto) {
  return sinGlifos(texto ?? '')
    .replace(TOTAL, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const { base, cerrar } = await servirExport(DIR, 8283);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const problemas = [];

const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const pagina = await ctx.newPage();

try {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, { testid: 'manager-home' });
  await irA(pagina, base, '/schedule', { asentar: 600 });

  /*
   * A UNA SEMANA VACIA, y no es comodidad: la demostración siembra turnos en la semana
   * actual, así que pegar encima daría solapes —que el importador bloquea, con razón— y
   * las horas de la rejilla no se podrían comparar con las de la tabla. Tres semanas
   * adelante no hay nada sembrado, y ahí 00:00 → 48:00 es una medida limpia.
   */
  for (let salto = 0; salto < 3; salto += 1) {
    await pagina.locator('[data-testid="week-next"]').first().click();
    await pagina.waitForTimeout(250);
  }

  const dias = await pagina
    .locator('[data-testid^="grid-day-"]')
    .evaluateAll((nodos) => nodos.map((n) => n.getAttribute('data-testid').slice('grid-day-'.length)));
  if (dias.length !== 7) {
    throw new Error(`esperaba 7 columnas de día en la rejilla y encontré ${dias.length}`);
  }

  const filas = await pagina
    .locator('[data-testid^="grid-name-"]')
    .evaluateAll((nodos) =>
      nodos
        .map((n) => ({ testid: n.getAttribute('data-testid'), texto: n.textContent }))
        .filter((n) => n.testid !== 'grid-name-header'),
    );
  const equipo = filas.map((fila) => ({
    testid: fila.testid,
    nombre: nombreDeLaCelda(fila.texto),
    total: totalDeLaCelda(fila.texto),
  }));
  if (equipo.length < 2) {
    throw new Error(`hacen falta 2 personas en la rejilla y hay ${equipo.length}`);
  }
  const conHoras = equipo.filter((persona) => persona.total !== '00:00');
  if (conHoras.length > 0) {
    throw new Error(
      `la semana elegida ya tiene horas (${conHoras
        .map((p) => `${p.nombre} ${p.total}`)
        .join(', ')}): la medida no sería limpia`,
    );
  }

  const [uno, dos] = equipo;
  const numeros = dias.map((dia) => Number(dia.slice(8, 10)));
  const cabecera = ['Personal', ...numeros, 'Horas'].join('\t');
  const completa = `${uno.nombre} – FT\tDESCANSO\t10:00–19:00\t11:00–20:00\t10:00–19:00\t10:00–19:00\t12:00–21:00\t13:00–22:00\t48h`;
  const parcial = `${dos.nombre} – PT\t17:00–21:00\t17:00–20:30\tDESCANSO\t18:30–22:00\t17:30–21:30\t18:00–22:00\t17:30–22:00\t23.5h`;
  const tabla = [cabecera, completa, parcial].join('\n');

  // --- 4. Control negativo, ANTES de lo demás: si esto pasa, el resto no mide nada.
  await pagina.locator('[data-testid="schedule-paste-week"]').first().click();
  await pagina.locator('[data-testid="paste-week-input"]').waitFor({ state: 'visible' });
  await pagina
    .locator('[data-testid="paste-week-input"]')
    .fill(`Nadie Que Exista\t10:00–19:00\tDESCANSO`);
  await pagina.waitForTimeout(400);

  const bloqueantes = await pagina.locator('[data-testid="paste-week-blocker"]').count();
  const desactivado = await pagina
    .locator('[data-testid="paste-week-confirm"]')
    .first()
    .getAttribute('aria-disabled');
  if (bloqueantes === 0) {
    problemas.push('control negativo: un nombre inexistente no produjo ningún aviso bloqueante');
  }
  if (desactivado !== 'true') {
    problemas.push(
      `control negativo: con un nombre inexistente el botón de crear seguía activo (aria-disabled=${desactivado})`,
    );
  }

  // --- 1. La vista previa cuadra con los totales de la tabla.
  await pagina.locator('[data-testid="paste-week-input"]').fill(tabla);
  await pagina.waitForTimeout(500);

  const bloqueantesBuenos = await pagina.locator('[data-testid="paste-week-blocker"]').count();
  if (bloqueantesBuenos > 0) {
    const textos = await pagina.locator('[data-testid="paste-week-blocker"]').allTextContents();
    problemas.push(`la tabla buena dio ${bloqueantesBuenos} aviso(s) bloqueante(s): ${textos.map(sinGlifos).join(' | ')}`);
  }

  const cuerpoHoja = sinGlifos(
    await pagina.locator('[data-testid="paste-week-sheet"]').first().textContent(),
  );
  const cuadran = (cuerpoHoja.match(/cuadra con tu tabla/g) ?? []).length;
  if (cuadran !== 2) {
    problemas.push(
      `esperaba que los dos totales cuadraran con la tabla y cuadraron ${cuadran}: ${cuerpoHoja.slice(0, 400)}`,
    );
  }

  const rotulo = sinGlifos(
    await pagina.locator('[data-testid="paste-week-confirm"]').first().textContent(),
  );
  if (!rotulo.includes('12')) {
    problemas.push(`el botón de crear no anuncia 12 turnos: «${rotulo}»`);
  }

  // --- 2 y 3. Crear, y comprobar la rejilla y la barra de publicar.
  await pagina.locator('[data-testid="paste-week-confirm"]').first().click();
  await pagina.waitForTimeout(1200);

  if ((await pagina.locator('[data-testid="paste-week-sheet"]').count()) > 0) {
    problemas.push('la hoja de pegar no se cerró después de crear');
  }

  const despues = await pagina
    .locator('[data-testid^="grid-name-"]')
    .evaluateAll((nodos) =>
      nodos
        .map((n) => ({ testid: n.getAttribute('data-testid'), texto: n.textContent }))
        .filter((n) => n.testid !== 'grid-name-header'),
    );
  const totalDe = (testid) => totalDeLaCelda(despues.find((f) => f.testid === testid)?.texto);

  if (totalDe(uno.testid) !== '48:00') {
    problemas.push(
      `${uno.nombre}: la rejilla dice ${totalDe(uno.testid)} y la tabla decía 48:00`,
    );
  }
  if (totalDe(dos.testid) !== '23:30') {
    problemas.push(
      `${dos.nombre}: la rejilla dice ${totalDe(dos.testid)} y la tabla decía 23:30 (23.5 h)`,
    );
  }

  const publicar = await pagina.locator('[data-testid="schedule-publish-all"]').count();
  if (publicar === 0) {
    problemas.push('no apareció el botón de publicar: los turnos no entraron como borrador');
  }

  const texto = sinGlifos(await pagina.evaluate(() => document.body?.innerText ?? ''));
  if (!/12 turnos/.test(texto)) {
    problemas.push('la pantalla no confirma cuántos turnos se crearon');
  }
} catch (error) {
  problemas.push(`el arnés no pudo completar la medida: ${error.message}`);
} finally {
  await ctx.close();
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error('PEGAR HORARIO — FALLA');
  for (const problema of problemas) console.error(`  · ${problema}`);
  process.exit(1);
}
console.log('PEGAR HORARIO — OK: 12 turnos pegados, totales 48:00 y 23:30, y en borrador.');
