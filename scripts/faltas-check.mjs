/**
 * LA FALTA, IGUAL EN TODAS LAS PANTALLAS (Andree, 1-oct).
 *
 * «Cuando una persona no marca en todo el turno se toma como falta… aplícalo en todas las
 * vistas y en todos los lugares donde debería salir». La regla vive en un solo sitio
 * (`src/features/timesheets/faltas.ts`); esto comprueba, en la demostración, que cada
 * pantalla la enseña y que todas cuentan LO MISMO:
 *
 * 1. HORARIO: el turno sin marcas sale en rojo con «Falta», y la persona lleva la cuenta.
 * 2. HORAS: la lista de faltas de la semana y su casilla dicen el mismo número que Horario.
 * 3. REPORTES: la casilla «Faltas» de la semana dice ese mismo número.
 * 4. ARREGLARLA: «Vino y no marcó» registra entrada y salida y la falta se va de Horas, de
 *    Horario y de Reportes a la vez, sin recargar.
 * 5. EQUIPO: las faltas de esta semana, en la fila de cada persona, suman lo que dice Horas.
 * 6. EL CELULAR DEL VENDEDOR: su mes cuenta sus faltas y el día lo dice con «Falta».
 *
 * Y POR QUÉ FALTÓ (2-oct), que se dice en Horas y se ve en todas:
 * 7. La falta sembrada de la semana pasada sale JUSTIFICADA, con su motivo, en Horas, en la
 *    tarjeta de Horario y en Reportes (casilla y leyenda del gráfico).
 * 8. CAMBIARLA a «Sin justificar · No avisó» cambia Horas, Horario y Reportes sin recargar;
 *    «Otro motivo» sin comentario no se guarda.
 * 9. JUSTIFICAR la de esta semana se ve en la fila de Equipo y en Horario.
 * 10. El celular de la vendedora dice «Falta justificada» con el motivo.
 * 11. UN COMENTARIO NO QUITA LA FALTA (3-oct): escribir una nota en el turno que es falta
 *     la guarda, el turno sigue publicado —sin «Cambiado» ni nada que publicar—, la
 *     falta sigue y la nota se ve en la tarjeta. Andree comentó dos faltas y desaparecieron.
 *
 * Se mira la SEMANA ANTERIOR porque siempre está sembrada entera, con una falta a propósito
 * (ver la semilla); la actual depende del día en que se corra.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/faltas-check.mjs dist-demo
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
  console.error('Uso: node scripts/faltas-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8143);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const esperar = (pagina, ms = 900) => pagina.waitForTimeout(ms);
/*
 * SOLO LA PESTAÑA DE DELANTE. Las que ya se abrieron siguen montadas detrás —con tamaño,
 * así que para Playwright son «visibles»— y con su semana puesta, solo que dentro de un
 * `aria-hidden`: sin esto, «la semana anterior» de Horas pulsaba el botón escondido de
 * Horario.
 */
const visible = (pagina, selector) =>
  pagina.locator(
    selector
      .split(',')
      .map((parte) => `${parte.trim()}:not([aria-hidden="true"] *)`)
      .join(', '),
  );
const cuenta = (pagina, selector) => visible(pagina, selector).count();
/**
 * El número de una casilla: el ÚLTIMO, porque el valor va abajo y el detalle —«1
 * justificada»— encima, con el rótulo (ver `StatTile`). Con la primera cifra se leía el
 * detalle en vez del valor.
 */
const numeroDe = async (pagina, testid) => {
  const texto = await visible(pagina, `[data-testid="${testid}"]`)
    .first()
    .innerText()
    .catch(() => '');
  const cifras = texto.match(/\d+/g);
  return cifras === null ? null : Number(cifras[cifras.length - 1]);
};

async function entrar(pagina, quien = 'sign-in-demo') {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator(`[data-testid="${quien}"]`).click();
}

async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 800 });
}

/** La semana anterior a la de hoy, venga de donde venga la pestaña. */
async function semanaAnterior(pagina) {
  const actual = visible(pagina, '[data-testid="week-current"]');
  if ((await actual.count()) > 0) {
    // Puede desaparecer mientras se cuenta: la pestaña de antes aún se estaba ocultando.
    await actual
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await esperar(pagina, 800);
  }
  await visible(pagina, '[data-testid="week-previous"]').first().click();
  await esperar(pagina, 1500);
}

/** La semana de hoy, por si la pestaña se quedó en otra. */
async function semanaActual(pagina) {
  const actual = visible(pagina, '[data-testid="week-current"]');
  if ((await actual.count()) > 0) {
    await actual
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await esperar(pagina, 1200);
  }
}

const TARJETAS_CON_FALTA = '[data-testid^="shift-"][data-testid$="-falta"]';
const FILAS_DE_FALTA = '[data-testid^="falta-"][data-testid$="-vino"]';
const ESTADOS_DE_FALTA = '[data-testid^="falta-"][data-testid$="-estado"]';
const BOTONES_POR_QUE = '[data-testid^="falta-"][data-testid$="-porque"]';
const HOJA = '[data-testid="justificar-falta-hoja"]';

/** Abre «¿Por qué faltó?» de la primera falta, elige tipo y motivo, y guarda. */
async function justificar(pagina, { tipo, motivo, nota }) {
  await visible(pagina, BOTONES_POR_QUE).first().click();
  await pagina.locator(HOJA).waitFor({ timeout: 8000 });
  await pagina.locator(`[data-testid="justificar-falta-tipo-${tipo}"]`).click();
  await pagina.locator(`[data-testid="justificar-falta-${motivo}"]`).click();
  if (nota !== undefined) await pagina.locator('[data-testid="justificar-falta-nota"]').fill(nota);
  await pagina.locator('[data-testid="justificar-falta-guardar"]').click();
  await pagina
    .locator(HOJA)
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => problemas.push(`justificar (${tipo}, ${motivo}) no cierra la hoja`));
  await esperar(pagina, 1200);
}

const textoDe = (pagina, selector) =>
  visible(pagina, selector)
    .allInnerTexts()
    .then((textos) => textos.join(' | '));

try {
  /* ------------------------------------------------- 1 a 5: quien gestiona */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1600, height: 1000 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });

    // --- 1. Horario, semana anterior.
    await irPorElMenu(pagina, '/schedule');
    await semanaAnterior(pagina);
    const enHorario = await cuenta(pagina, TARJETAS_CON_FALTA);
    if (enHorario === 0) problemas.push('Horario no marca ningún turno como falta');
    const conCuenta = await cuenta(pagina, '[data-testid^="grid-faltas-"]');
    if (enHorario > 0 && conCuenta === 0) {
      problemas.push('Horario marca la falta pero no la cuenta al lado del nombre');
    }
    console.log(`  horario              ${enHorario} turnos con «Falta»`);
    await pagina.screenshot({ path: 'capturas/faltas-horario.png' });

    // --- 2. Horas, misma semana.
    await irPorElMenu(pagina, '/hours');
    await semanaAnterior(pagina);
    const enHoras = await cuenta(pagina, FILAS_DE_FALTA);
    const casilla = await numeroDe(pagina, 'total-faltas');
    if (enHoras !== enHorario) {
      problemas.push(`Horas lista ${enHoras} faltas y Horario marca ${enHorario}`);
    }
    if (casilla !== enHoras)
      problemas.push(`la casilla de Horas dice ${casilla} y la lista ${enHoras}`);
    console.log(`  horas                ${enHoras} en la lista, casilla ${casilla}`);
    await pagina.locator('[data-testid="faltas-de-la-semana"]').screenshot({
      path: 'capturas/faltas-horas.png',
    });

    // --- 3. Reportes, misma semana.
    await irPorElMenu(pagina, '/reports');
    await semanaAnterior(pagina);
    const enReportes = await numeroDe(pagina, 'report-absences');
    if (enReportes !== enHoras) {
      problemas.push(`Reportes cuenta ${enReportes} faltas y Horas ${enHoras}`);
    }
    if ((await cuenta(pagina, '[data-testid="ranking-absences"]')) === 0 && enHoras > 0) {
      problemas.push('Reportes no enseña a quién son las faltas');
    }
    console.log(`  reportes             ${enReportes} faltas`);
    await pagina
      .locator('[data-testid="chart-absences"]')
      .screenshot({ path: 'capturas/faltas-reportes.png' });

    // --- 7. La falta sembrada de la semana pasada viene justificada.
    await irPorElMenu(pagina, '/hours');
    await semanaAnterior(pagina);
    const estados = await textoDe(pagina, ESTADOS_DE_FALTA);
    if (!/Justificada · Descanso médico/.test(estados)) {
      problemas.push(`Horas no dice que la falta sembrada está justificada: «${estados}»`);
    }
    if ((await cuenta(pagina, '[data-testid^="falta-"][data-testid$="-nota"]')) === 0) {
      problemas.push('Horas no enseña el comentario de la falta justificada');
    }
    await pagina.locator('[data-testid="faltas-de-la-semana"]').screenshot({
      path: 'capturas/faltas-justificada-horas.png',
    });
    await irPorElMenu(pagina, '/schedule');
    await semanaAnterior(pagina);
    const tarjetas = await textoDe(pagina, TARJETAS_CON_FALTA);
    if (!/Falta justificada · Descanso médico/.test(tarjetas)) {
      problemas.push(`Horario no dice «Falta justificada»: «${tarjetas}»`);
    }
    await irPorElMenu(pagina, '/reports');
    await semanaAnterior(pagina);
    const casillaReportes = await textoDe(pagina, '[data-testid="report-absences"]');
    if (!/justificada/.test(casillaReportes)) {
      problemas.push(`la casilla de Reportes no cuenta la justificada: «${casillaReportes}»`);
    }
    const graficoFaltas = await textoDe(pagina, '[data-testid="chart-absences"]');
    if (!/Justificadas/.test(graficoFaltas)) {
      problemas.push('el gráfico de faltas de Reportes no tiene la leyenda de justificadas');
    }
    await pagina
      .locator('[data-testid="chart-absences"]')
      .screenshot({ path: 'capturas/faltas-justificada-reportes.png' });
    console.log(`  justificada          Horas, Horario y Reportes la dicen`);

    // --- 11. Un comentario en el turno que es falta no la quita ni pide publicar.
    await irPorElMenu(pagina, '/schedule');
    await semanaAnterior(pagina);
    const pendientes = async () =>
      Number(
        /(\d+)\s+cambios? sin publicar/.exec(
          await visible(pagina, 'body')
            .first()
            .innerText()
            .catch(() => ''),
        )?.[1] ?? 0,
      );
    const antesDelComentario = await pendientes();
    const faltasAntesDeComentar = await cuenta(pagina, TARJETAS_CON_FALTA);
    await visible(pagina, TARJETAS_CON_FALTA).first().click();
    await pagina.locator('[data-testid="shift-manager-note"]').waitFor({ timeout: 8000 });
    await pagina
      .locator('[data-testid="shift-manager-note"]')
      .fill('Avisó por WhatsApp a las 19:00');
    await pagina.locator('[data-testid="shift-form-save"]').click();
    await pagina
      .locator('[data-testid="shift-form-sheet"]')
      .waitFor({ state: 'detached', timeout: 8000 })
      .catch(() => problemas.push('guardar el comentario no cierra la hoja'));
    await esperar(pagina, 1200);
    const faltasTrasComentar = await cuenta(pagina, TARJETAS_CON_FALTA);
    if (faltasTrasComentar !== faltasAntesDeComentar) {
      problemas.push(
        `tras comentar, Horario marca ${faltasTrasComentar} faltas y antes ${faltasAntesDeComentar}`,
      );
    }
    const trasElComentario = await pendientes();
    if (trasElComentario !== antesDelComentario) {
      problemas.push(
        `un comentario dejó ${trasElComentario} cambios sin publicar (antes ${antesDelComentario})`,
      );
    }
    if ((await cuenta(pagina, '[data-testid$="-nota-privada"]')) === 0) {
      problemas.push('el comentario no se ve en la tarjeta del turno');
    }
    const aviso = await visible(pagina, 'body').first().innerText();
    if (!/Comentario guardado/.test(aviso)) {
      problemas.push('al guardar solo el comentario no dice que no hay nada que publicar');
    }
    await pagina.screenshot({ path: 'capturas/faltas-comentario.png' });
    console.log(
      `  comentario           faltas ${faltasAntesDeComentar} → ${faltasTrasComentar}, por publicar ${antesDelComentario} → ${trasElComentario}`,
    );

    // --- 8. Cambiarla a «Sin justificar», y «Otro» sin comentario no se guarda.
    await irPorElMenu(pagina, '/hours');
    await semanaAnterior(pagina);
    await visible(pagina, BOTONES_POR_QUE).first().click();
    await pagina.locator(HOJA).waitFor({ timeout: 8000 });
    await pagina.locator('[data-testid="justificar-falta-other"]').click();
    await pagina.locator('[data-testid="justificar-falta-nota"]').fill('');
    await pagina.locator('[data-testid="justificar-falta-guardar"]').click();
    await esperar(pagina, 500);
    if ((await cuenta(pagina, HOJA)) === 0) {
      problemas.push('«Otro motivo» se guardó sin comentario');
    }
    await pagina.screenshot({ path: 'capturas/faltas-justificar-hoja.png' });
    await pagina.keyboard.press('Escape');
    await pagina
      .locator(HOJA)
      .waitFor({ state: 'detached', timeout: 4000 })
      .catch(() => pagina.locator('[aria-label="Cerrar"]').first().click());
    await esperar(pagina, 600);
    await justificar(pagina, { tipo: 'unjustified', motivo: 'no_notice' });
    const estadosTras = await textoDe(pagina, ESTADOS_DE_FALTA);
    if (!/Sin justificar · No avisó/.test(estadosTras)) {
      problemas.push(`tras cambiarla Horas no dice «Sin justificar»: «${estadosTras}»`);
    }
    await irPorElMenu(pagina, '/schedule');
    await semanaAnterior(pagina);
    const tarjetasTras = await textoDe(pagina, TARJETAS_CON_FALTA);
    if (!/Falta sin justificar · No avisó/.test(tarjetasTras)) {
      problemas.push(`tras cambiarla Horario no lo dice: «${tarjetasTras}»`);
    }
    await irPorElMenu(pagina, '/reports');
    await semanaAnterior(pagina);
    const casillaTrasCambio = await textoDe(pagina, '[data-testid="report-absences"]');
    if (/justificada/.test(casillaTrasCambio)) {
      problemas.push(`tras cambiarla Reportes sigue contándola justificada`);
    }
    console.log(`  cambiar              Horas, Horario y Reportes dicen «Sin justificar»`);

    // --- 4. Arreglarla: vino y no marcó.
    await irPorElMenu(pagina, '/hours');
    await semanaAnterior(pagina);
    if (enHoras > 0) {
      await visible(pagina, FILAS_DE_FALTA).first().click();
      await pagina.locator('[data-testid="falta-vino-hoja"]').waitFor({ timeout: 8000 });
      const entrada = await pagina.locator('[data-testid="falta-vino-entrada"]').inputValue();
      if (!/^\d\d:\d\d$/.test(entrada)) problemas.push(`la entrada no viene puesta: «${entrada}»`);
      // Sin motivo no se guarda: es un fichaje manual.
      await pagina.locator('[data-testid="falta-vino-guardar"]').click();
      await esperar(pagina, 500);
      if ((await cuenta(pagina, '[data-testid="falta-vino-hoja"]')) === 0) {
        problemas.push('«Vino y no marcó» se guardó sin motivo');
      }
      await pagina.locator('[data-testid="falta-vino-motivo"]').fill('El reloj no tenía batería');
      await pagina.screenshot({ path: 'capturas/faltas-vino.png' });
      await pagina.locator('[data-testid="falta-vino-guardar"]').click();
      await pagina
        .locator('[data-testid="falta-vino-hoja"]')
        .waitFor({ state: 'detached', timeout: 8000 })
        .catch(() => problemas.push('registrar entrada y salida no cierra la hoja'));
      await esperar(pagina, 1500);
      const tras = await cuenta(pagina, FILAS_DE_FALTA);
      if (tras !== enHoras - 1)
        problemas.push(`tras arreglarla Horas lista ${tras}, no ${enHoras - 1}`);
      const casillaTras = await numeroDe(pagina, 'total-faltas');
      if (casillaTras !== enHoras - 1) {
        problemas.push(`tras arreglarla la casilla de Horas dice ${casillaTras}`);
      }
      console.log(`  arreglar             Horas pasa de ${enHoras} a ${tras}`);

      await irPorElMenu(pagina, '/schedule');
      await semanaAnterior(pagina);
      const horarioTras = await cuenta(pagina, TARJETAS_CON_FALTA);
      if (horarioTras !== enHorario - 1) {
        problemas.push(
          `tras arreglarla Horario sigue con ${horarioTras} faltas, no ${enHorario - 1}`,
        );
      }
      await irPorElMenu(pagina, '/reports');
      await semanaAnterior(pagina);
      const reportesTras = await numeroDe(pagina, 'report-absences');
      if (reportesTras !== enHoras - 1) {
        problemas.push(`tras arreglarla Reportes sigue con ${reportesTras} faltas`);
      }
      console.log(`  sincronía            Horario ${horarioTras}, Reportes ${reportesTras}`);
    }

    // --- 5. Equipo, esta semana, contra Horas de esta semana.
    await irPorElMenu(pagina, '/hours');
    await semanaActual(pagina);
    const estaSemana = await cuenta(pagina, FILAS_DE_FALTA);
    await irPorElMenu(pagina, '/team');
    await esperar(pagina, 1500);
    const textos = await visible(
      pagina,
      '[data-testid$="-faltas"][data-testid^="team-member-"]',
    ).allInnerTexts();
    const enEquipo = textos.reduce((suma, texto) => suma + Number(/\d+/.exec(texto)?.[0] ?? 0), 0);
    if (enEquipo !== estaSemana) {
      problemas.push(`Equipo suma ${enEquipo} faltas esta semana y Horas lista ${estaSemana}`);
    }
    // La tira es decorativa (`aria-hidden`: la fila ya lo dice en palabras), así que se
    // busca sin el filtro de la pestaña de delante. Solo Equipo tiene estas filas.
    const cruces = await pagina
      .locator('[data-testid^="team-member-"][data-testid*="-semana-falta-"]')
      .count();
    if (estaSemana > 0 && cruces === 0)
      problemas.push('la tira de Equipo no marca el día de la falta');
    console.log(
      `  equipo               ${enEquipo} esta semana (Horas ${estaSemana}), ${cruces} cruces`,
    );
    await pagina.screenshot({ path: 'capturas/faltas-equipo.png' });

    // --- 9. Justificar la de esta semana y verla en Equipo y en Horario.
    if (estaSemana > 0) {
      await irPorElMenu(pagina, '/hours');
      await semanaActual(pagina);
      await justificar(pagina, { tipo: 'justified', motivo: 'permission' });
      await irPorElMenu(pagina, '/team');
      await esperar(pagina, 1200);
      const filas = await textoDe(pagina, '[data-testid$="-faltas"][data-testid^="team-member-"]');
      if (!/justificada/.test(filas)) {
        problemas.push(`tras justificarla Equipo no lo dice: «${filas}»`);
      }
      await irPorElMenu(pagina, '/schedule');
      await semanaActual(pagina);
      const tarjetasHoy = await textoDe(pagina, TARJETAS_CON_FALTA);
      if (!/Falta justificada · Permiso avisado/.test(tarjetasHoy)) {
        problemas.push(`tras justificarla Horario no lo dice: «${tarjetasHoy}»`);
      }
      console.log(`  esta semana          Equipo «${filas}»`);
    } else {
      console.log('  esta semana          sin faltas todavía: no se justifica nada');
    }
    await contexto.close();
  }

  /* ----------------------------------------------- 6: el celular del vendedor */
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, 'sign-in-demo-vendedor');
    await pagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
    await pagina.locator('[data-testid="mi-horario-faltas"]').waitFor({ timeout: 10000 });
    await esperar(pagina, 1500);
    let total = 0;
    let conInsignia = 0;
    let justificadaEnElCelular = false;
    for (let mes = 0; mes < 2; mes += 1) {
      if (mes > 0) {
        await pagina.locator('[data-testid="month-previous"]').click();
        await esperar(pagina, 1500);
      }
      const delMes = (await numeroDe(pagina, 'mi-horario-faltas')) ?? 0;
      total += delMes;
      const lista = await pagina
        .locator('[data-testid="mi-horario-dias-mes"]')
        .innerText()
        .catch(() => '');
      conInsignia += (lista.match(/Falta/g) ?? []).length;
      // Un día entero justificado lleva la insignia «Falta justificada»; si vino a otro turno
      // ese día, la línea «Justificada · motivo» bajo su turno.
      if (/Falta justificada|Justificada · /.test(lista)) {
        justificadaEnElCelular = true;
        if (!/Descanso médico/.test(lista)) {
          problemas.push('el celular dice que está justificada sin el motivo');
        }
      }
      if (delMes > 0 && (await cuenta(pagina, '[data-testid="mi-horario-faltas-aviso"]')) === 0) {
        problemas.push('su mes tiene faltas y no le dice qué hacer si vino');
      }
    }
    if (total === 0) problemas.push('el celular del vendedor no cuenta ninguna falta');
    if (total > 0 && conInsignia === 0) problemas.push('ningún día de su mes dice «Falta»');
    if (!justificadaEnElCelular) {
      problemas.push('el celular de la vendedora no enseña su falta justificada');
    }
    await pagina.screenshot({ path: 'capturas/faltas-celular.png', fullPage: true });
    console.log(
      `  celular              ${total} faltas en dos meses, ${conInsignia} días con «Falta»`,
    );
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
  '\nOK: la falta sale igual en Horario, Horas, Reportes, Equipo y el celular, y se arregla en todas a la vez.',
);
