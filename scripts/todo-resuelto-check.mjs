/**
 * RESUELTO ES RESUELTO (Andree, 8-oct): «sigue saliendo eso y ya lo corregí, no se borró…
 * esto causa una mala impresión, es que la app está mal».
 *
 * Lo que hace, en la demostración y como lo haría quien gestiona:
 *
 * 1. En Horas, semana anterior y semana actual, resuelve UNO POR UNO todos los casos de «Por
 *    resolver» con su botón principal —y si abre una hoja, la guarda con lo que propone—.
 * 2. Cada caso tiene que IRSE al resolverlo. Uno que se queda es el fallo de siempre: «lo
 *    arreglé y sigue ahí».
 * 3. Resueltos todos, recarga la página: lo resuelto no vuelve.
 * 4. Y no queda nada en rojo de lo decidido: «Necesita revisión» solo puede contar lo que
 *    sigue sin decidir (una jornada abierta de verdad). Si cuenta algo, se dice qué.
 *
 * Es la demostración en un navegador: no toca datos de nadie, y al cerrar no queda nada.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/todo-resuelto-check.mjs dist-demo
 */
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
  console.error('Uso: node scripts/todo-resuelto-check.mjs <export-demo>');
  process.exit(2);
}

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8161);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const esperar = (pagina, ms) => pagina.waitForTimeout(ms);

async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
}

/** Los casos que se ven, con su id y su texto. */
const casos = (pagina) =>
  pagina.locator('[data-testid^="caso-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => ({ id: n.getAttribute('data-testid').slice('caso-'.length), n }))
      .filter(({ id }) => /^[^\s]+:[a-z_]+$/.test(id))
      .map(({ id, n }) => ({ id, texto: (n.innerText || '').replace(/\s+/g, ' ').trim() })),
  );

async function semana(pagina, cual) {
  await irA(pagina, base, '/hours', { asentar: 1200 });
  if (cual === 'anterior') {
    await pagina.locator('[data-testid="week-previous"]').click();
    await esperar(pagina, 1800);
  }
}

/** Resuelve todos los casos de la semana que se ve; devuelve cuántos resolvió. */
async function resolverTodos(pagina, cual, opcion) {
  let resueltos = 0;
  const vistos = new Map();
  for (let vuelta = 0; vuelta < 40; vuelta += 1) {
    const lista = await casos(pagina);
    if (lista.length === 0) break;
    const caso = lista[0];
    vistos.set(caso.id, (vistos.get(caso.id) ?? 0) + 1);
    if (vistos.get(caso.id) > 2) {
      problemas.push(`${cual}: el caso no se va al resolverlo — «${caso.texto.slice(0, 140)}»`);
      break;
    }
    // El botón principal: el primero de la fila que no sea «Ver jornada».
    const botones = pagina.locator(
      `[data-testid="caso-${caso.id}"] [role="button"]:not([data-testid$="-jornada"])`,
    );
    if ((await botones.count()) === 0) {
      problemas.push(`${cual}: un caso sin ningún botón — «${caso.texto.slice(0, 140)}»`);
      break;
    }
    // La principal, o la otra respuesta si la hay: las dos tienen que resolverlo.
    const cuantos = await botones.count();
    await (opcion === 'alternativa' && cuantos > 1 ? botones.nth(1) : botones.first()).click();
    await esperar(pagina, 500);
    // Si abrió una hoja, se guarda con lo que propone.
    for (const [hoja, guardar] of [
      ['caso-falta-sheet', 'caso-falta-guardar'],
      ['caso-salida-sheet', 'caso-salida-guardar'],
    ]) {
      if ((await pagina.locator(`[data-testid="${hoja}"]`).count()) > 0) {
        await pagina.locator(`[data-testid="${guardar}"]`).first().click();
        await pagina
          .locator(`[data-testid="${hoja}"]`)
          .waitFor({ state: 'detached', timeout: 8000 })
          .catch(() => problemas.push(`${cual}: la hoja ${hoja} no se cerró al guardar`));
      }
    }
    // «Corregir salida» abre la jornada: se pone la salida 15 min antes, con su motivo.
    if ((await pagina.locator('[data-testid="session-detail-sheet"]').count()) > 0) {
      const salida = await pagina.locator('[data-testid="session-correct-end"]').inputValue();
      const [h, m] = salida.split(':').map(Number);
      const antes = (h ?? 0) * 60 + (m ?? 0) - 15;
      await pagina
        .locator('[data-testid="session-correct-end"]')
        .fill(
          `${String(Math.floor(antes / 60)).padStart(2, '0')}:${String(antes % 60).padStart(2, '0')}`,
        );
      await pagina.locator('[data-testid="session-correct-reason"]').fill('Se fue a esa hora');
      await pagina.locator('[data-testid="session-correct-submit"]').click();
      await pagina
        .locator('[data-testid="session-detail-sheet"]')
        .waitFor({ state: 'detached', timeout: 8000 })
        .catch(() => problemas.push(`${cual}: la hoja de la jornada no se cerró al corregir`));
    }
    try {
      await pagina
        .locator(`[data-testid="caso-${caso.id}"]`)
        .waitFor({ state: 'detached', timeout: 8000 });
      resueltos += 1;
    } catch {
      const error = await pagina
        .locator('[data-testid="por-resolver-error"]')
        .innerText()
        .catch(() => '');
      problemas.push(
        `${cual}: resolverlo no lo quita — «${caso.texto.slice(0, 120)}»${error ? ` · error: «${error}»` : ''}`,
      );
      break;
    }
  }
  return resueltos;
}

/** «Necesita revisión» y, si cuenta algo, las filas que lo cuentan. */
async function loQueQuedaEnRojo(pagina) {
  const texto = await pagina
    .locator('[data-testid="total-por-revisar"]')
    .innerText()
    .catch(() => '');
  const cuenta = Number([...texto.matchAll(/\d+/g)].at(-1)?.[0] ?? '0');
  if (cuenta === 0) return { cuenta, filas: [] };
  await pagina
    .locator('[data-testid="timesheet-status-filter"]')
    .getByText('Necesita revisión', { exact: true })
    .first()
    .click()
    .catch(() => undefined);
  await esperar(pagina, 600);
  const filas = await pagina.locator('[data-testid^="session-"]').evaluateAll((nodos) =>
    nodos
      .filter((n) => {
        const id = n.getAttribute('data-testid');
        return (
          !id.endsWith('-en-curso') &&
          !/^session-(detail|correct|auto-exit|clock-drift|list)/.test(id)
        );
      })
      .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0),
  );
  return { cuenta, filas: [...new Set(filas)].slice(0, 6) };
}

for (const opcion of ['principal', 'alternativa']) {
  console.log(`\n  — con la respuesta ${opcion} de cada caso —`);
  try {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();
    const erroresDeConsola = [];
    pagina.on('pageerror', (e) => erroresDeConsola.push(e.message));
    await entrar(pagina);

    for (const cual of ['anterior', 'actual']) {
      await semana(pagina, cual);
      await pagina
        .locator('[data-testid="por-resolver"]')
        .waitFor({ timeout: 8000 })
        .catch(() => undefined);
      const antes = (await casos(pagina)).length;
      const resueltos = await resolverTodos(pagina, `${cual} (${opcion})`, opcion);
      console.log(`  semana ${cual.padEnd(9)} ${antes} caso(s), ${resueltos} resuelto(s)`);

      /*
       * Lo resuelto no vuelve al ir a otra pantalla y volver. Por el menú y no recargando: en la
       * demostración, recargar la página vuelve a los datos de partida.
       */
      await pagina.locator('a[href$="/team"]').first().click();
      await esperarPantalla(pagina, MARCADORES['/team'], { asentar: 600 });
      await pagina.locator('a[href$="/hours"]').first().click();
      await esperarPantalla(pagina, MARCADORES['/hours'], { asentar: 1200 });
      if (cual === 'anterior') {
        await pagina.locator('[data-testid="week-previous"]').click();
      }
      await esperar(pagina, 1800);
      const vuelven = await casos(pagina);
      // Solo vale lo que siga abierto de verdad: alguien dentro ahora mismo.
      const deVerdad = vuelven.filter((c) => !/Sigue dentro/.test(c.texto));
      if (deVerdad.length > 0) {
        problemas.push(
          `${cual}: al volver a Horas vuelven ${deVerdad.length} caso(s): ${deVerdad
            .map((c) => `«${c.texto.slice(0, 90)}»`)
            .join(' · ')}`,
        );
      }

      const rojo = await loQueQuedaEnRojo(pagina);
      const sinDecidir = rojo.filas.filter((f) => !/en curso|Sin salida/i.test(f));
      console.log(`  en rojo ${cual.padEnd(9)} «Necesita revisión» ${rojo.cuenta}`);
      if (sinDecidir.length > 0) {
        problemas.push(
          `${cual}: decidido todo, siguen en rojo: ${sinDecidir.map((f) => `«${f.slice(0, 110)}»`).join(' · ')}`,
        );
      }
    }

    if (erroresDeConsola.length > 0) {
      problemas.push(`errores de la página: ${erroresDeConsola.slice(0, 3).join(' | ')}`);
    }
    await contexto.close();
  } catch (error) {
    problemas.push(`${opcion}: el recorrido no pudo terminar — ${error.message.split('\n')[0]}`);
  }
}
await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  '\nOK: con las dos respuestas, cada caso se va al resolverlo, no vuelve al volver a Horas y no queda nada en rojo.',
);
