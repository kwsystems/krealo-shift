/**
 * Lo que se arregla en un sitio se ve en todos (Andree, 1-oct).
 *
 * «Si yo ya arreglé lo de [una vendedora], ¿por qué en Horario sale que sigue trabajando?
 * Cada vez que yo cambio en un lado debería sincronizarse con los otros.» Y, de paso,
 * «¿podemos ya borrar los test de reloj?». Lo que se comprueba, en la demostración:
 *
 * 1. PONER LA SALIDA DE QUIEN SIGUE DENTRO, desde su jornada en Horas, la saca de «En turno
 *    ahora» en Horario y de la franja de Inicio, sin recargar.
 * 2. UNA SALIDA EN UNA HORA QUE NO LLEGÓ —la trampa de la medianoche— se para en la hoja,
 *    con el porqué.
 * 3. «AGREGAR FICHAJE MANUAL» deja elegir el día, y propone el de la jornada abierta para
 *    una salida que falta.
 * 4. «QUITAR DE LA LISTA» saca un reloj de Ajustes.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/sincronia-check.mjs dist-demo
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
  console.error('Uso: node scripts/sincronia-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8139);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const esperar = (pagina, ms = 1000) => pagina.waitForTimeout(ms);

/** Por la barra lateral, sin recargar: la demostración vive en memoria. */
async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 800 });
}

const enTurnoAhora = (pagina) =>
  pagina.locator('[data-testid^="en-turno-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => n.getAttribute('data-testid'))
      .filter((id) => id !== 'en-turno-ahora')
      .map((id) => id.slice('en-turno-'.length)),
  );

const sumarUnMinuto = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + 1;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const restarUnMinuto = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + 24 * 60 - 1) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

try {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });

  // --- Quién está dentro antes, en Horario.
  await irA(pagina, base, '/schedule', { asentar: 1500 });
  const antes = await enTurnoAhora(pagina);
  console.log(`  en turno ahora       ${antes.length} persona(s)`);
  if (antes.length === 0) problemas.push('Horario no enseña a nadie en turno: no hay qué cerrar');

  // --- Su jornada abierta en Horas.
  await irPorElMenu(pagina, '/hours');
  await esperar(pagina, 1200);
  const abierta = await pagina
    .locator('[data-testid^="session-"][data-testid$="-en-curso"]')
    .first()
    .getAttribute('data-testid')
    .catch(() => null);
  if (abierta === null) {
    problemas.push('Horas no enseña ninguna jornada en curso');
  } else {
    const fila = abierta.slice(0, -'-en-curso'.length);
    await pagina.locator(`[data-testid="${fila}"]`).first().click();
    await pagina.locator('[data-testid="session-detail-sheet"]').waitFor({ timeout: 8000 });
    if ((await pagina.locator('[data-testid="session-correct-open-hint"]').count()) === 0) {
      problemas.push(
        'la hoja de una jornada abierta no dice que la salida se registra como fichaje',
      );
    }
    const entrada = await pagina.locator('[data-testid="session-correct-start"]').inputValue();

    /*
     * --- 0. «Le di Corregir fichaje y nunca se cierra» (8-oct): sin motivo, el botón se ponía
     * gris y lo que faltaba se decía abajo del todo. Tiene que decirlo junto al botón, y el
     * botón seguir vivo.
     */
    await pagina.locator('[data-testid="session-correct-end"]').fill(sumarUnMinuto(entrada));
    await pagina.locator('[data-testid="session-correct-submit"]').click();
    await esperar(pagina, 400);
    const porQue = await pagina
      .locator('[data-testid="session-correct-why"]')
      .innerText()
      .catch(() => '');
    if (!/motivo/i.test(porQue)) {
      problemas.push(
        `sin motivo, «Corregir fichaje» no dice junto al botón qué falta: «${porQue}»`,
      );
    }
    if (await pagina.locator('[data-testid="session-correct-submit"]').isDisabled()) {
      problemas.push('sin motivo, «Corregir fichaje» se queda gris');
    }

    // --- 2. Una hora antes de la entrada es la madrugada siguiente: todavía no llegó.
    await pagina.locator('[data-testid="session-correct-end"]').fill(restarUnMinuto(entrada));
    await pagina.locator('[data-testid="session-correct-reason"]').fill('Se fue sin marcar');
    await pagina.locator('[data-testid="session-correct-submit"]').click();
    await esperar(pagina, 600);
    const hoja = await pagina.locator('[data-testid="session-detail-sheet"]').innerText();
    if (!/todavía no llegó/.test(hoja)) {
      problemas.push('una salida en una hora que no llegó no se para en la hoja');
    }
    await pagina.locator('[data-testid="session-detail-sheet"]').screenshot({
      path: 'capturas/sincronia-futura.png',
    });

    // --- 1. La salida buena: un minuto después de entrar.
    await pagina.locator('[data-testid="session-correct-end"]').fill(sumarUnMinuto(entrada));
    await pagina.locator('[data-testid="session-correct-submit"]').click();
    // Guardada la corrección, la hoja se cierra SOLA (8-oct): antes se cerraba aquí a mano.
    try {
      await pagina
        .locator('[data-testid="session-detail-sheet"]')
        .waitFor({ state: 'detached', timeout: 8000 });
    } catch {
      const error = await pagina
        .locator('[data-testid="session-detail-error"]')
        .innerText()
        .catch(() => '');
      problemas.push(`guardada la corrección, la hoja no se cierra${error ? `: «${error}»` : ''}`);
      const cerrarHoja = pagina
        .locator('[data-testid="session-detail-sheet"]')
        .getByText('Cerrar', { exact: true });
      if ((await cerrarHoja.count()) > 0) await cerrarHoja.first().click();
    }
    await esperar(pagina, 600);

    await irPorElMenu(pagina, '/schedule');
    await esperar(pagina, 1200);
    const despues = await enTurnoAhora(pagina);
    console.log(`  tras poner la salida ${despues.length} persona(s) en turno`);
    if (despues.length !== antes.length - 1) {
      problemas.push(
        `Horario sigue enseñando ${despues.length} en turno, y antes eran ${antes.length}`,
      );
    }
    await irPorElMenu(pagina, '/');
    await esperar(pagina, 1000);
    const trabajando = await pagina
      .locator('[data-testid="tile-working"]')
      .innerText()
      .catch(() => null);
    if (trabajando !== null)
      console.log(`  inicio               «${trabajando.replace(/\s+/g, ' ')}»`);
  }

  // --- 3. El fichaje manual elige día.
  await irPorElMenu(pagina, '/hours');
  await pagina.locator('[data-testid="timesheet-manual"]').click();
  await pagina.locator('[data-testid="manual-entry-sheet"]').waitFor({ timeout: 8000 });
  const dias = await pagina.locator('[data-testid="manual-entry-day"]').innerText();
  if (!/Hoy/.test(dias) || !/Ayer/.test(dias)) {
    problemas.push(`el fichaje manual no deja elegir el día: «${dias.replace(/\s+/g, ' ')}»`);
  }
  console.log(`  días del fichaje     ${dias.replace(/\s+/g, ' ')}`);
  // «Olvidé marcar entrada» se registra al momento: el aviso decía que iba a Solicitudes.
  const aviso = await pagina.locator('[data-testid="manual-entry-notice"]').innerText();
  if (/Solicitudes|Bandeja/.test(aviso)) {
    problemas.push(`el fichaje directo dice que va a Solicitudes: «${aviso.replace(/\s+/g, ' ')}»`);
  }
  await pagina.locator('[data-testid="manual-entry-sheet"]').screenshot({
    path: 'capturas/sincronia-manual.png',
  });

  // --- 3b. LA TIENDA ABRIÓ TARDE (4-oct). Andree: «la tienda abre a las 2 pm pero quiero
  // que la gente que tenía que entrar a las 10 salga como si hubiera marcado; ya quiero que
  // corra su horario». Se hace con este mismo fichaje: su entrada, hoy, a una hora que ya
  // pasó. Desde ese momento tiene que estar EN TURNO en Horario y en «Ahora mismo» de Inicio,
  // desde esa hora. En la demostración no salía en Horario: la entrada abría la jornada pero
  // no la ponía en «quién está dentro».
  const dentroAntes = await enTurnoAhora(pagina).catch(() => []);
  const personas = await pagina
    .locator('[data-testid^="manual-entry-employee-"]')
    .evaluateAll((nodos) =>
      nodos.map((n) => n.getAttribute('data-testid').slice('manual-entry-employee-'.length)),
    );
  const fuera = personas.find((id) => !antes.includes(id) && !dentroAntes.includes(id));
  if (fuera === undefined) {
    problemas.push('no hay nadie fuera a quien poner la entrada de hoy');
  } else {
    const minutosDeHoy = (() => {
      const [h, m] = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Lima',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(new Date())
        .split(':')
        .map(Number);
      return h * 60 + m;
    })();
    const minuto = Math.max(0, minutosDeHoy - 90);
    const hora = `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`;
    await pagina.locator(`[data-testid="manual-entry-employee-${fuera}"]`).click();
    await pagina.locator('[data-testid="manual-entry-time"]').fill(hora);
    await pagina
      .locator('[data-testid="manual-entry-reason"]')
      .fill('La tienda abrió a las 2 pm: horario especial');
    await pagina.locator('[data-testid="manual-entry-submit"]').click();
    await pagina
      .locator('[data-testid="manual-entry-sheet"]')
      .waitFor({ state: 'detached', timeout: 8000 })
      .catch(() => problemas.push('la entrada de hoy no se guardó: la hoja sigue abierta'));
    await esperar(pagina, 1000);

    await irPorElMenu(pagina, '/schedule');
    await esperar(pagina, 1200);
    const enHorario = (await enTurnoAhora(pagina)).includes(fuera);
    if (!enHorario) problemas.push(`con su entrada de las ${hora}, Horario no la pone en turno`);
    await irPorElMenu(pagina, '/');
    await esperar(pagina, 1000);
    const ahoraMismo = await pagina
      .locator('[data-testid="right-now-list"]')
      .innerText()
      .catch(() => '');
    const enInicio = ahoraMismo.includes(`Desde las ${hora}`);
    if (!enInicio) {
      problemas.push(`con su entrada de las ${hora}, Inicio no dice «Desde las ${hora}»`);
    }
    console.log(
      `  entrada a las ${hora}   Horario ${enHorario ? 'en turno' : 'NO'}, Inicio ${enInicio ? `«Desde las ${hora}»` : 'NO'}`,
    );
  }
  const cerrarManual = pagina
    .locator('[data-testid="manual-entry-sheet"]')
    .getByText('Cerrar', { exact: true });
  if ((await cerrarManual.count()) > 0) await cerrarManual.first().click();
  await esperar(pagina, 500);

  // --- 4. Quitar un reloj de la lista.
  await irPorElMenu(pagina, '/settings');
  const relojes = () => pagina.locator('[data-testid^="kiosk-remove-"]').count();
  // La tarjeta de relojes se pliega: se abre si hace falta.
  if ((await relojes()) === 0) {
    const titulo = pagina.getByText('Relojes', { exact: false }).first();
    if ((await titulo.count()) > 0) await titulo.click();
    await esperar(pagina, 600);
  }
  const antesRelojes = await relojes();
  if (antesRelojes === 0) {
    problemas.push('Ajustes no ofrece «Quitar de la lista» en ningún reloj');
  } else {
    await pagina.locator('[data-testid^="kiosk-remove-"]').first().click();
    await esperar(pagina, 500);
    await pagina.getByText('Quitar de la lista', { exact: true }).last().click();
    await esperar(pagina, 1200);
    const despuesRelojes = await relojes();
    console.log(`  relojes              ${antesRelojes} → ${despuesRelojes}`);
    if (despuesRelojes !== antesRelojes - 1) {
      problemas.push(`quitar un reloj deja ${despuesRelojes} de ${antesRelojes}`);
    }
  }
  await contexto.close();
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK: lo que se corrige en Horas llega a Horario e Inicio, y los relojes se quitan.');
