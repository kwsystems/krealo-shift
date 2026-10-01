/**
 * Las horas por día: los filtros de días de Reportes y la semana de cada persona en Equipo
 * (30-sep).
 *
 * Andree pidió dos cosas el mismo día: en Reportes, filtrar «por día o varios días o
 * ciertos días en específico»; en Equipo, ver «cada día cuántas horas, no solo que ha
 * hecho 36». Las dos enseñan LAS MISMAS HORAS partidas de otra manera, así que lo que se
 * comprueba es que cuadren entre sí y con lo que ya había:
 *
 * 1. REPORTES POR DÍA dice lo mismo que la columna de ese día en la semana.
 * 2. DÍAS SUELTOS suman solo los elegidos, con una columna por día; DÍAS SEGUIDOS del
 *    lunes a hoy suman lo que la semana entera.
 * 3. UN DÍA QUE NO HA LLEGADO no se puede elegir.
 * 4. LA TIRA DE EQUIPO suma lo que dice su total, y el total de quien no está dentro es el
 *    de su barra en Reportes: dos pantallas, las mismas horas.
 * 5. LA FICHA dice, día por día, lo mismo que la tira, y las semanas del mes suman el mes.
 * 6. EN UN TELÉFONO nada se sale de la pantalla.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/horas-check.mjs dist-demo
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
  console.error('Uso: node scripts/horas-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8133);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
}

const aMinutos = (texto) => {
  const m = /(\d+):(\d\d)/.exec(texto ?? '');
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
};
const leerTotal = async (pagina) =>
  aMinutos(await pagina.locator('[data-testid="report-total"]').innerText());

/** Las columnas del gráfico «Cómo va», por su clave: `{ '2026-09-28': 505, ... }`. */
async function columnas(pagina) {
  return pagina.locator('[data-testid^="day-column-"]').evaluateAll((nodos) =>
    Object.fromEntries(
      nodos.map((n) => {
        const m = /(\d+):(\d\d)\s*$/.exec(n.getAttribute('aria-label') ?? '');
        return [
          n.getAttribute('data-testid').slice('day-column-'.length),
          m === null ? null : Number(m[1]) * 60 + Number(m[2]),
        ];
      }),
    ),
  );
}

/** Espera a que el total de Reportes deje de moverse: las consultas llegan por partes. */
async function asentar(pagina) {
  let antes = null;
  for (let i = 0; i < 12; i += 1) {
    await pagina.waitForTimeout(400);
    const ahora = await pagina
      .locator('[data-testid="report-total"]')
      .innerText()
      .catch(() => null);
    if (ahora !== null && ahora === antes) return;
    antes = ahora;
  }
}

// ------------------------------------------------------------------ Reportes
{
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);
  await irA(pagina, base, '/reports', { asentar: 800 });
  await asentar(pagina);

  const semana = await columnas(pagina);
  const totalSemana = await leerTotal(pagina);
  const dias = Object.keys(semana).sort();
  // Hoy es el día de la semana que lleva «hoy» marcado; se lee de la propia pantalla.
  await pagina.locator('[data-testid="report-period-dia"]').click();
  await pagina.locator('[data-testid="day-title"]').waitFor({ timeout: 10000 });
  await asentar(pagina);
  const tituloHoy = await pagina.locator('[data-testid="day-title"]').innerText();
  const totalHoy = await leerTotal(pagina);
  if ((await pagina.locator('[data-testid="chart-week"]').count()) !== 0) {
    problemas.push('por día sigue el gráfico «Cómo va»: una columna sola no compara nada');
  }
  // El día de hoy es el último de la semana que no es futuro: el de la columna con el
  // número de hoy en su título.
  const numeroHoy = /(\d+) de/.exec(tituloHoy)?.[1];
  const hoy = dias.find((dia) => String(Number(dia.slice(8))) === numeroHoy);
  if (hoy === undefined) {
    problemas.push(`por día, «${tituloHoy}» no es ningún día de esta semana`);
  } else if (totalHoy !== semana[hoy]) {
    problemas.push(
      `por día, hoy suma ${totalHoy} min y su columna de la semana ${semana[hoy]}: no cuadra`,
    );
  }
  console.log(`  por día              «${tituloHoy}» ${totalHoy} min = columna ${semana[hoy]}`);

  // Ayer, si es de esta semana.
  const ayer = hoy === undefined ? undefined : dias[dias.indexOf(hoy) - 1];
  if (ayer !== undefined) {
    await pagina.locator('[data-testid="day-previous"]').click();
    await asentar(pagina);
    const totalAyer = await leerTotal(pagina);
    if (totalAyer !== semana[ayer]) {
      problemas.push(`por día, ayer suma ${totalAyer} min y su columna ${semana[ayer]}`);
    }
    if ((await pagina.locator('[data-testid="day-current"]').count()) === 0) {
      problemas.push('por día, en ayer no sale «Ir a hoy»');
    }
  }

  // --- Días sueltos: el primero de la semana y hoy.
  await pagina.locator('[data-testid="report-period-dias"]').click();
  await pagina.locator('[data-testid="report-days-sheet"]').waitFor({ timeout: 10000 });
  const resumenInicial = await pagina.locator('[data-testid="report-days-summary"]').innerText();
  if (!/7 días/.test(resumenInicial)) {
    problemas.push(`«Elegir días» no abre con la última semana marcada: «${resumenInicial}»`);
  }
  await pagina.locator('[data-testid="report-days-mode-sueltos"]').click();
  await pagina.locator('[data-testid="report-days-clear"]').click();
  const elegidos = hoy === undefined ? [] : [...new Set([dias[0], hoy])];
  for (const dia of elegidos) {
    // El calendario abre en el mes de hoy; el lunes puede ser del mes anterior.
    if (dia.slice(0, 7) !== hoy.slice(0, 7)) {
      await pagina.locator('[data-testid="report-days-month-previous"]').click();
    }
    await pagina.locator(`[data-testid="report-days-calendar-dia-${dia}"]`).click();
    if (dia.slice(0, 7) !== hoy.slice(0, 7)) {
      await pagina.locator('[data-testid="report-days-month-next"]').click();
    }
  }
  // Mañana, si es de este mes, no se puede tocar.
  const manana = hoy === undefined ? undefined : dias[dias.indexOf(hoy) + 1];
  if (manana !== undefined && manana.slice(0, 7) === hoy.slice(0, 7)) {
    const celda = pagina.locator(`[data-testid="report-days-calendar-dia-${manana}"]`);
    if ((await celda.getAttribute('aria-disabled')) !== 'true') {
      problemas.push(`mañana (${manana}) se puede elegir: un día que no ha llegado no tiene horas`);
    }
  }
  await pagina.screenshot({ path: 'capturas/horas-elegir-dias.png' });
  await pagina.locator('[data-testid="report-days-apply"]').click();
  await pagina.locator('[data-testid="report-days-sheet"]').waitFor({ state: 'detached' });
  await asentar(pagina);

  const etiqueta = await pagina.locator('[data-testid="report-days-label"]').innerText();
  const sueltos = await columnas(pagina);
  const totalSueltos = await leerTotal(pagina);
  const esperado = elegidos.reduce((suma, dia) => suma + (semana[dia] ?? 0), 0);
  if (Object.keys(sueltos).sort().join() !== [...elegidos].sort().join()) {
    problemas.push(
      `días sueltos: el gráfico tiene las columnas ${Object.keys(sueltos).join(', ')} y se ` +
        `eligieron ${elegidos.join(', ')}`,
    );
  }
  if (totalSueltos !== esperado) {
    problemas.push(
      `días sueltos: suman ${totalSueltos} min y sus columnas de la semana ${esperado}: se ` +
        'cuelan los días de en medio o se pierde alguno',
    );
  }
  console.log(`  días sueltos         «${etiqueta}» ${totalSueltos} min = ${esperado}`);
  await pagina.screenshot({ path: 'capturas/horas-reportes-dias.png' });

  // --- Días seguidos: del primero de la semana a hoy es la semana entera.
  await pagina.locator('[data-testid="report-days-open"]').click();
  await pagina.locator('[data-testid="report-days-sheet"]').waitFor({ timeout: 10000 });
  await pagina.locator('[data-testid="report-days-mode-seguidos"]').click();
  if (hoy !== undefined) {
    const otroMes = dias[0].slice(0, 7) !== hoy.slice(0, 7);
    if (otroMes) await pagina.locator('[data-testid="report-days-month-previous"]').click();
    await pagina.locator(`[data-testid="report-days-calendar-dia-${dias[0]}"]`).click();
    if (otroMes) await pagina.locator('[data-testid="report-days-month-next"]').click();
    await pagina.locator(`[data-testid="report-days-calendar-dia-${hoy}"]`).click();
  }
  await pagina.locator('[data-testid="report-days-apply"]').click();
  await pagina.locator('[data-testid="report-days-sheet"]').waitFor({ state: 'detached' });
  await asentar(pagina);
  const totalSeguidos = await leerTotal(pagina);
  /*
   * Contra las columnas de esos mismos días, no contra la semana entera: la demostración
   * siembra «hoy» con la fecha del navegador, y entre la medianoche UTC y la de Lima hay
   * horas en un día que para la sede todavía no ha llegado.
   */
  const hastaHoy =
    hoy === undefined
      ? totalSemana
      : dias.filter((dia) => dia <= hoy).reduce((suma, dia) => suma + (semana[dia] ?? 0), 0);
  if (totalSeguidos !== hastaHoy) {
    problemas.push(
      `días seguidos del ${dias[0]} a hoy suman ${totalSeguidos} min y sus columnas ${hastaHoy}`,
    );
  }
  console.log(
    `  días seguidos        del ${dias[0]} a hoy ${totalSeguidos} min = columnas ${hastaHoy}`,
  );
  await contexto.close();
}

// -------------------------------------------------------------------- Equipo
{
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);

  // Las barras de esta semana en Reportes, por persona, para comparar.
  await irA(pagina, base, '/reports', { asentar: 800 });
  await asentar(pagina);
  const enReportes = Object.fromEntries(
    await pagina
      .locator('[data-testid="ranking-hours"] [data-testid^="ranking-row-"]')
      .evaluateAll((nodos) =>
        nodos.map((n) => [
          n.getAttribute('data-testid').slice('ranking-row-'.length),
          n.getAttribute('aria-label') ?? '',
        ]),
      ),
  );

  await irA(pagina, base, '/team', { asentar: 1200 });
  const filas = await pagina
    .locator('[data-testid^="team-member-"][role="button"]')
    .evaluateAll((nodos) =>
      nodos.map((n) => ({
        id: n.getAttribute('data-testid').slice('team-member-'.length),
        etiqueta: n.getAttribute('aria-label') ?? '',
        dentro: n.querySelector('[data-testid$="-en-curso"]') !== null,
      })),
    );
  if (filas.length === 0) problemas.push('Equipo no enseña a nadie');

  let comparadas = 0;
  for (const fila of filas) {
    const partes = /(?:Esta semana|This week): (\d+:\d\d)(.*)$/.exec(fila.etiqueta);
    const total = aMinutos(partes?.[1]);
    // Lo que va después del total: «, en curso. lun 08:30, mar 04:00».
    const porDia = [...(partes?.[2] ?? '').matchAll(/\b[a-záéíóú]{3}\.? (\d+:\d\d)/g)].map((m) =>
      aMinutos(m[1]),
    );
    const suma = porDia.reduce((a, b) => a + b, 0);
    if (total === null) {
      problemas.push(`la fila de ${fila.id} no dice sus horas de esta semana`);
      continue;
    }
    if (suma !== total) {
      problemas.push(`la tira de ${fila.id} suma ${suma} min y su total dice ${total}`);
    }
    const tiras = await pagina.locator(`[data-testid^="team-member-${fila.id}-semana-2"]`).count();
    if (tiras !== porDia.length) {
      problemas.push(`la tira de ${fila.id} pinta ${tiras} columnas para ${porDia.length} días`);
    }
    // Quien no está dentro: el total es el de Reportes, que solo cuenta jornadas cerradas.
    if (!fila.dentro && enReportes[fila.id] !== undefined) {
      const reportes = aMinutos(/(\d+:\d\d)\s*$/.exec(enReportes[fila.id])?.[1]);
      comparadas += 1;
      if (reportes !== total) {
        problemas.push(`${fila.id}: Equipo dice ${total} min esta semana y Reportes ${reportes}`);
      }
    }
  }
  if (comparadas === 0) problemas.push('no se pudo comparar a nadie de Equipo con Reportes');
  console.log(
    `  equipo               ${filas.length} filas, ${comparadas} comparadas con Reportes`,
  );
  await pagina.screenshot({ path: 'capturas/horas-equipo.png' });

  // La ficha de la primera persona con horas.
  const totalDe = (fila) =>
    aMinutos(/(?:Esta semana|This week): (\d+:\d\d)/.exec(fila.etiqueta)?.[1]) ?? 0;
  const conHoras = filas.find((fila) => totalDe(fila) > 0);
  if (conHoras !== undefined) {
    await pagina.locator(`[data-testid="team-member-${conHoras.id}"]`).click();
    await pagina.locator('[data-testid="person-hours"]').waitFor({ timeout: 10000 });
    await pagina.waitForTimeout(1200);
    const totalFila = totalDe(conHoras);
    const totalFicha = aMinutos(
      await pagina.locator('[data-testid="person-hours-total-value"]').innerText(),
    );
    if (totalFicha !== totalFila) {
      problemas.push(`la ficha dice ${totalFicha} min esta semana y su fila ${totalFila}`);
    }
    const diasFicha = await pagina
      .locator('[data-testid^="person-day-"][data-testid$="-total"]')
      .evaluateAll((nodos) => nodos.map((n) => n.textContent ?? ''));
    if (diasFicha.length !== 7) problemas.push(`la ficha tiene ${diasFicha.length} días, no 7`);
    const sumaFicha = diasFicha.reduce((a, t) => {
      const m = /(\d+):(\d\d)/.exec(t);
      return a + (m === null ? 0 : Number(m[1]) * 60 + Number(m[2]));
    }, 0);
    if (sumaFicha !== totalFicha) {
      problemas.push(`los días de la ficha suman ${sumaFicha} min y su total ${totalFicha}`);
    }
    const tramos = await pagina.locator('[data-testid$="-tramos"]').count();
    if (tramos === 0) problemas.push('la ficha no dice a qué hora entró y salió ningún día');
    await pagina.locator('[data-testid="person-hours"]').scrollIntoViewIfNeeded();
    await pagina.screenshot({ path: 'capturas/horas-ficha.png' });

    await pagina.locator('[data-testid="person-hours-view-semana"]').click();
    await pagina.locator('[data-testid="person-month-title"]').waitFor({ timeout: 10000 });
    await pagina.waitForTimeout(1200);
    const semanas = await pagina
      .locator('[data-testid="person-hours-weeks"] [data-testid^="ranking-row-"]')
      .evaluateAll((nodos) => nodos.map((n) => n.getAttribute('aria-label') ?? ''));
    const sumaSemanas = semanas.reduce((a, e) => {
      const m = /(\d+):(\d\d)\s*$/.exec(e);
      return a + (m === null ? 0 : Number(m[1]) * 60 + Number(m[2]));
    }, 0);
    const totalMes = aMinutos(
      await pagina.locator('[data-testid="person-hours-total-value"]').innerText(),
    );
    if (semanas.length === 0) problemas.push('por semana, la ficha no tiene ninguna semana');
    if (sumaSemanas !== totalMes) {
      problemas.push(`por semana, las semanas suman ${sumaSemanas} min y el mes ${totalMes}`);
    }
    console.log(
      `  ficha                semana ${totalFicha} min = días ${sumaFicha}; ` +
        `${semanas.length} semanas suman ${sumaSemanas} = mes ${totalMes}`,
    );
  }
  await contexto.close();
}

// ---------------------------------------------------------------- Teléfono
{
  const contexto = await navegador.newContext({ viewport: { width: 360, height: 780 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);
  for (const [ruta, accion] of [
    ['/team', null],
    ['/reports', '[data-testid="report-period-dias"]'],
  ]) {
    await irA(pagina, base, ruta, { asentar: 1000 });
    if (accion !== null) {
      await pagina.locator(accion).click();
      await pagina.waitForTimeout(800);
    }
    const sobra = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (sobra > 0) problemas.push(`${ruta} a 360 px se sale ${sobra} px por la derecha`);
  }
  await pagina.screenshot({ path: 'capturas/horas-telefono.png' });
  await contexto.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA la comprobación de horas por día:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log('\nOK: los días de Reportes y la semana de Equipo cuadran entre sí y con la semana.');
