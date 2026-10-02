/**
 * REPORTES: PROGRAMADO CONTRA TRABAJADO, Y QUE CUADRE CON LAS DEMÁS VISTAS (2-oct).
 *
 * Andree, mirando octubre el día 1: «no hay nada… todas las vistas siempre deben ir de la
 * mano». Reportes sumaba solo jornadas cerradas y no decía lo que iba en curso, mientras
 * Horas y Equipo sí. Esto comprueba, en la demostración:
 *
 * 1. LO TRABAJADO de Reportes es el de Horas, y LO EN CURSO también —personas y minutos—.
 * 2. LA TABLA POR PERSONA dice lo mismo que el ranking, persona por persona, y su columna
 *    de programado suma lo que dice arriba.
 * 3. UNA SEMANA PASADA no enseña nada en curso ni marca de «hasta ahora», y su título está
 *    en pasado.
 * 4. EN EL TELÉFONO la tabla se vuelve fichas y no se sale nada.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/programado-check.mjs dist-demo
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
  console.error('Uso: node scripts/programado-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8146);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const esperar = (pagina, ms = 900) => pagina.waitForTimeout(ms);
/* Solo la pestaña de delante: las de detrás siguen montadas dentro de un `aria-hidden`. */
const delante = (pagina, selector) => pagina.locator(`${selector}:not([aria-hidden="true"] *)`);
const aMinutos = (texto) => {
  const m = /(\d+):(\d\d)/.exec(texto ?? '');
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
};
const texto = (pagina, testid) =>
  delante(pagina, `[data-testid="${testid}"]`)
    .first()
    .innerText()
    .catch(() => '');

async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });
}

async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 1500 });
}

try {
  {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);

    // --- Horas: lo trabajado y lo en curso de esta semana.
    await irPorElMenu(pagina, '/hours');
    const netoHoras = aMinutos(await texto(pagina, 'total-net'));
    const vivoHoras = await texto(pagina, 'total-en-curso');
    const minutosVivoHoras = aMinutos(vivoHoras);
    const personasVivoHoras = Number(/(\d+)\s+person/.exec(vivoHoras)?.[1] ?? 0);

    // --- 1. Reportes, la misma semana.
    await irPorElMenu(pagina, '/reports');
    await esperar(pagina, 1200);
    if ((await delante(pagina, '[data-testid="report-hero"]').count()) === 0) {
      problemas.push('Reportes no tiene «Cómo va la semana» arriba');
    }
    const netoReportes = aMinutos(await texto(pagina, 'report-total'));
    if (netoReportes !== netoHoras) {
      problemas.push(`Reportes dice ${netoReportes} min trabajados y Horas ${netoHoras}`);
    }
    const vivo = await texto(pagina, 'report-live');
    const minutosVivo = aMinutos(vivo);
    const personasVivo = Number(/(\d+)\s+person/.exec(vivo)?.[1] ?? 0);
    if (minutosVivoHoras !== null && minutosVivo !== minutosVivoHoras) {
      problemas.push(`en curso: Reportes ${minutosVivo} min, Horas ${minutosVivoHoras}`);
    }
    if (personasVivo !== personasVivoHoras) {
      problemas.push(`dentro ahora: Reportes ${personasVivo}, Horas ${personasVivoHoras}`);
    }
    const programado = aMinutos(
      /de (\d+:\d\d)/.exec((await texto(pagina, 'report-hero')) ?? '')?.[1] ?? null,
    );
    console.log(
      `  esta semana          ${netoReportes} min (Horas ${netoHoras}), en curso ${minutosVivo} min · ${personasVivo} personas (Horas ${minutosVivoHoras} · ${personasVivoHoras}), programado ${programado}`,
    );

    // --- 2. La tabla por persona contra el ranking.
    const filas = await delante(pagina, '[data-testid^="report-attendance-row-"]').evaluateAll(
      (nodos) =>
        nodos
          .filter((n) => /^report-attendance-row-[^-]+(-[^-]+){4}$/.test(n.dataset.testid ?? ''))
          .map((n) => ({
            id: (n.dataset.testid ?? '').slice('report-attendance-row-'.length),
            texto: n.innerText,
          })),
    );
    const ranking = await delante(pagina, '[data-testid="ranking-hours"]').innerText();
    if (filas.length === 0) problemas.push('la tabla por persona está vacía');
    let sumaProgramado = 0;
    for (const fila of filas) {
      const cifras = [...fila.texto.matchAll(/(\d+):(\d\d)/g)].map((m) => m[0]);
      const trabajado = cifras[0];
      const nombreDeLaFila = fila.texto.split('\n')[0].trim();
      if (trabajado !== '00:00' && !ranking.includes(trabajado)) {
        problemas.push(`${nombreDeLaFila}: la tabla dice ${trabajado} y el ranking no`);
      }
      // La segunda cifra que no es «en curso» es lo programado.
      const sinEnCurso = fila.texto.replace(/\+\d+:\d\d[^\n]*/g, '');
      const plan = [...sinEnCurso.matchAll(/(\d+):(\d\d)/g)].map((m) => m[0])[1];
      sumaProgramado += aMinutos(plan) ?? 0;
    }
    if (programado !== null && sumaProgramado !== programado) {
      problemas.push(`la columna «Programado» suma ${sumaProgramado} y arriba dice ${programado}`);
    }
    console.log(`  tabla                ${filas.length} personas, programado ${sumaProgramado}`);
    await delante(pagina, '[data-testid="report-hero"]').screenshot({
      path: 'capturas/programado-resumen.png',
    });

    // --- 3. Una semana pasada.
    await delante(pagina, '[data-testid="week-previous"]').first().click();
    await esperar(pagina, 1500);
    const titulo = await texto(pagina, 'report-hero');
    if (!/fue/i.test(titulo))
      problemas.push(`la semana pasada no habla en pasado: «${titulo.split('\n')[0]}»`);
    if ((await delante(pagina, '[data-testid="report-live"]').count()) > 0) {
      problemas.push('la semana pasada enseña gente «dentro ahora»');
    }
    if ((await delante(pagina, '[data-testid="report-meter-hasta-ahora"]').count()) > 0) {
      problemas.push('la semana pasada marca un «programado hasta ahora»');
    }
    const programados = await delante(pagina, '[data-testid^="day-planned-"]').count();
    if (programados === 0) problemas.push('el gráfico de la semana no dibuja lo programado');
    console.log(
      `  semana pasada        «${titulo.split('\n')[0]}», ${programados} columnas con programado`,
    );
    await contexto.close();
  }

  /* ------------------------------------------------------------ 4. teléfono */
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await pagina.locator('a[href$="/reports"]').first().click();
    await esperarPantalla(pagina, MARCADORES['/reports'], { asentar: 1500 });
    const cabeceras = await delante(pagina, '[data-testid="report-attendance"]').innerText();
    if (/Persona\s+Trabajado\s+Programado/.test(cabeceras)) {
      problemas.push('a 390 px la tabla por persona sigue siendo tabla');
    }
    const fuera = await pagina.evaluate(() => {
      const vista = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll('body *'))
        .filter((nodo) => {
          const caja = nodo.getBoundingClientRect();
          return caja.width > 0 && caja.right > vista + 1;
        })
        .slice(0, 3)
        .map((nodo) => (nodo.textContent ?? '').slice(0, 30));
    });
    if (fuera.length > 0) problemas.push(`a 390 px se sale: ${fuera.join(', ')}`);
    console.log(`  teléfono             ${fuera.length} desbordes`);
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
console.log(
  '\nOK: Reportes dice lo mismo que Horas de lo trabajado y de lo en curso, y lo compara con lo programado.',
);
