/**
 * LAS CIFRAS QUE SE REPITEN ENTRE PANTALLAS DICEN LO MISMO (2-oct).
 *
 * Andree: «¿puedes revisar si hay incongruencias en la web?». La revisión encontró
 * pantallas que contaban lo mismo con reglas distintas: Inicio sumaba borradores como
 * programado y Reportes no; llamaba «Trabajando» a una salida olvidada que Horas llama
 * «Sin salida»; decía «En descanso» de quien Equipo decía «Almorzando», y Equipo ponía al
 * lado la hora de entrada en vez la de la pausa; el número de Disponibilidad del menú
 * contaba toda la empresa y la pantalla una sede; Bandeja no llevaba número. Esto lo
 * comprueba en la demostración, cifra por cifra:
 *
 * 1. PROGRAMADO: Inicio = Reportes (lo publicado), y Horario dice cuánto de su total es
 *    borrador, con lo publicado igual a esas dos.
 * 2. DENTRO AHORA: Inicio (trabajando + en descanso) = Horas = Reportes, en personas.
 * 3. EL ESTADO DE QUIEN DESCANSA: la misma palabra en Inicio, Horas y Equipo, y la misma
 *    hora al lado en Equipo que en Horas.
 * 4. LOS NÚMEROS DEL MENÚ: Bandeja = lo pendiente en Bandeja = lo que dice Inicio, y
 *    Disponibilidad = las novedades de su pantalla.
 * 5. LA CASILLA «NECESITA REVISIÓN» DE HORAS = las filas que lista su filtro.
 * 6. EL CELULAR de la vendedora suma esta semana lo mismo que su fila de Equipo.
 * 7. «NO HA LLEGADO» (2-oct): con turnos ya empezados sin marca (`?escenario=sinllegar`),
 *    Horario marca en la tarjeta a las mismas personas que Inicio cuenta. Andree miraba un
 *    turno de las 13:00 a las 15:27 y Horario no decía nada.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/vistas-check.mjs dist-demo
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
  console.error('Uso: node scripts/vistas-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8147);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

/* Solo la pestaña de delante: las de detrás siguen montadas dentro de un `aria-hidden`. */
const delante = (pagina, selector) =>
  pagina.locator(
    selector
      .split(',')
      .map((parte) => `${parte.trim()}:not([aria-hidden="true"] *)`)
      .join(', '),
  );
const texto = (pagina, selector) =>
  delante(pagina, selector)
    .allInnerTexts()
    .then((t) => t.join(' | '))
    .catch(() => '');
const ultimaCifra = (t) => {
  const cifras = (t ?? '').match(/\d+/g);
  return cifras === null ? null : Number(cifras[cifras.length - 1]);
};
const aMinutos = (t) => {
  const m = /(\d+):(\d\d)/.exec(t ?? '');
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
};
/** «8 h 25 min», «45 min», «3 h» → minutos. */
const duracionAMinutos = (t) => {
  const h = /(\d+)\s*h/.exec(t);
  const m = /(\d+)\s*min/.exec(t);
  return (h === null ? 0 : Number(h[1]) * 60) + (m === null ? 0 : Number(m[1]));
};

async function entrar(pagina, quien = 'sign-in-demo') {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator(`[data-testid="${quien}"]`).click();
}

async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 1500 });
}

let minutosDeLaVendedoraEnEquipo = null;
let nombreDeLaVendedora = null;

try {
  {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 1500 });

    // --- Inicio.
    const semanaInicio = await texto(pagina, '[data-testid="scheduled-vs-worked"]');
    const programadoInicio = aMinutos(semanaInicio.split('/')[1] ?? '');
    const trabajando = ultimaCifra(await texto(pagina, '[data-testid="tile-working"]')) ?? 0;
    const enDescanso = ultimaCifra(await texto(pagina, '[data-testid="tile-on-break"]')) ?? 0;
    const ahoraInicio = await texto(pagina, '[data-testid="right-now-list"]');
    const titulares = await texto(
      pagina,
      '[data-testid^="hoy-titular-"], [data-testid^="hoy-secundario-"]',
    );
    const solicitudesInicio = (() => {
      const m = /(\d+)\s*\n?\s*solicitud/.exec(titulares.replace(/\|/g, '\n'));
      return m === null ? 0 : Number(m[1]);
    })();
    const sinCerrarInicio = (() => {
      const m = /(\d+)\s*\n?\s*fichajes? sin cerrar/.exec(titulares.replace(/\|/g, '\n'));
      return m === null ? 0 : Number(m[1]);
    })();
    const insigniaBandeja =
      ultimaCifra(await texto(pagina, '[data-testid="menu-requests-insignia"]')) ?? 0;
    const insigniaDisponibilidad =
      ultimaCifra(await texto(pagina, '[data-testid="menu-sub-availability-insignia"]')) ?? 0;
    console.log(
      `  inicio               programado ${programadoInicio}, dentro ${trabajando}+${enDescanso}, sin cerrar ${sinCerrarInicio}, solicitudes ${solicitudesInicio}`,
    );

    // --- 1. Reportes, la semana.
    await irPorElMenu(pagina, '/reports');
    const heroe = await texto(pagina, '[data-testid="report-hero"]');
    const programadoReportes = aMinutos(/de (\d+:\d\d)/.exec(heroe)?.[1] ?? '');
    if (programadoInicio !== programadoReportes) {
      problemas.push(`programado: Inicio ${programadoInicio} min, Reportes ${programadoReportes}`);
    }
    const vivoReportes = await texto(pagina, '[data-testid="report-live"]');
    const personasReportes = Number(/(\d+)\s+person/.exec(vivoReportes)?.[1] ?? 0);

    // --- 1b. Horario: el total con su parte en borrador.
    await irPorElMenu(pagina, '/schedule');
    // La nota para la vendedora se ve en su tarjeta, sin abrir el turno (3-oct).
    if ((await delante(pagina, '[data-testid$="-nota-persona"]').count()) === 0) {
      problemas.push('Horario no enseña en la tarjeta la nota para la persona');
    }
    const resumen = await texto(pagina, '[data-testid="weekly-total-drafts"]');
    if (resumen !== '') {
      const publicadas = aMinutos(/y (\d+:\d\d) publicad/.exec(resumen)?.[1] ?? '');
      if (publicadas !== programadoReportes) {
        problemas.push(
          `Horario dice ${publicadas} min publicados y Reportes ${programadoReportes}`,
        );
      }
      console.log(`  horario              «${resumen}»`);
    } else {
      console.log('  horario              sin borradores esta semana');
    }

    // --- 2 y 5. Horas.
    await irPorElMenu(pagina, '/hours');
    const dentroHoras = await texto(pagina, '[data-testid="total-en-curso"]');
    const personasHoras = Number(/(\d+)\s+person/.exec(dentroHoras)?.[1] ?? 0);
    if (trabajando + enDescanso !== personasHoras) {
      problemas.push(`dentro ahora: Inicio ${trabajando}+${enDescanso}, Horas ${personasHoras}`);
    }
    if (personasReportes !== personasHoras) {
      problemas.push(`dentro ahora: Reportes ${personasReportes}, Horas ${personasHoras}`);
    }
    const filasHoras = await texto(pagina, '[data-testid^="session-"]');
    const sinSalida = (filasHoras.match(/Sin salida/g) ?? []).length;
    if (sinSalida !== sinCerrarInicio) {
      problemas.push(
        `sin cerrar: Inicio ${sinCerrarInicio}, filas «Sin salida» de Horas ${sinSalida}`,
      );
    }
    const casilla = ultimaCifra(await texto(pagina, '[data-testid="total-por-revisar"]'));
    await delante(pagina, '[data-testid="timesheet-status-filter-needsReview"]').first().click();
    await pagina.waitForTimeout(900);
    const listadas = await delante(pagina, '[data-testid^="session-"]').evaluateAll(
      (nodos) =>
        nodos.filter((n) => /^session-[^-]+(-[^-]+){4}$/.test(n.dataset.testid ?? '')).length,
    );
    if (casilla !== listadas) {
      problemas.push(
        `«Necesita revisión»: la casilla dice ${casilla} y el filtro lista ${listadas}`,
      );
    }
    await delante(pagina, '[data-testid="timesheet-status-filter-all"]').first().click();
    await pagina.waitForTimeout(600);
    console.log(
      `  horas                dentro ${personasHoras}, sin salida ${sinSalida}, por revisar ${casilla}/${listadas}`,
    );

    // --- 3. Quien descansa: la palabra y la hora.
    const palabra = (t) =>
      /Almorzando/.test(t) ? 'Almorzando' : /En descanso/.test(t) ? 'En descanso' : null;
    const enHoras = palabra(filasHoras);
    const enInicio = palabra(ahoraInicio);
    await irPorElMenu(pagina, '/team');
    const filasEquipo = await texto(pagina, '[data-testid^="team-member-"]');
    const enEquipo = palabra(filasEquipo);
    if (enDescanso > 0 && !(enHoras === enInicio && enInicio === enEquipo)) {
      problemas.push(
        `quien descansa: Inicio «${enInicio}», Horas «${enHoras}», Equipo «${enEquipo}»`,
      );
    }
    const horaEquipo = /(?:Almorzando|En descanso)\s*\|?\s*desde (\d\d:\d\d)/.exec(
      filasEquipo,
    )?.[1];
    const horaHoras = /(?:Almorzando|En descanso)[^|]*?desde (\d\d:\d\d)/.exec(filasHoras)?.[1];
    if (
      enDescanso > 0 &&
      horaEquipo !== undefined &&
      horaHoras !== undefined &&
      horaEquipo !== horaHoras
    ) {
      problemas.push(`la hora de la pausa: Equipo ${horaEquipo}, Horas ${horaHoras}`);
    }
    console.log(
      `  descanso             «${enInicio}» · Equipo desde ${horaEquipo}, Horas desde ${horaHoras}`,
    );

    // La vendedora de la demostración, para el paso 6: su fila de Equipo.
    const filas = await delante(pagina, '[data-testid^="team-member-"]').evaluateAll((nodos) =>
      nodos
        .filter((n) => /^team-member-[^-]+(-[^-]+){4}$/.test(n.dataset.testid ?? ''))
        .map((n) => n.innerText),
    );
    const primera = filas[0] ?? '';
    nombreDeLaVendedora =
      primera
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /[a-z]{3}/i.test(l)) ?? null;
    minutosDeLaVendedoraEnEquipo = aMinutos(primera);

    // --- 4. Los números del menú.
    await irPorElMenu(pagina, '/requests');
    const bandeja = await texto(pagina, 'body');
    const pendientes = [...bandeja.matchAll(/\((\d+)\)/g)].reduce((s, m) => s + Number(m[1]), 0);
    if (insigniaBandeja !== pendientes || pendientes !== solicitudesInicio) {
      problemas.push(
        `solicitudes: menú ${insigniaBandeja}, Bandeja ${pendientes}, Inicio ${solicitudesInicio}`,
      );
    }
    await irPorElMenu(pagina, '/availability');
    const novedades = await texto(pagina, '[data-testid="disponibilidad-nuevas"]');
    const enPantalla = novedades === '' ? 0 : (ultimaCifra(/(\d+)/.exec(novedades)?.[1]) ?? 0);
    if (insigniaDisponibilidad !== enPantalla) {
      problemas.push(`disponibilidad: menú ${insigniaDisponibilidad}, pantalla ${enPantalla}`);
    }
    console.log(
      `  menú                 Bandeja ${insigniaBandeja} (${pendientes} pendientes), Disponibilidad ${insigniaDisponibilidad} (${enPantalla})`,
    );
    await contexto.close();
  }

  /* -------------------------------------------- 6. el celular de la vendedora */
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await contexto.newPage();
    await entrar(pagina, 'sign-in-demo-vendedor');
    await pagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
    await pagina.waitForTimeout(1500);
    const hola = await pagina.locator('[data-testid="mi-horario-hola"]').innerText();
    const semana = await pagina.locator('[data-testid^="mi-horario-dia-"]').evaluateAll((nodos) =>
      nodos
        .filter((n) => /^mi-horario-dia-\d{4}-\d\d-\d\d$/.test(n.dataset.testid ?? ''))
        .slice(0, 7)
        .map((n) => n.innerText),
    );
    const suma = semana.reduce((s, dia) => {
      const linea =
        dia
          .split('\n')
          .reverse()
          .find((l) => /\d+\s*(h|min)\b/.test(l)) ?? '';
      return s + duracionAMinutos(linea);
    }, 0);
    const esLaMisma =
      nombreDeLaVendedora !== null && hola.includes(nombreDeLaVendedora.split(' ')[0]);
    if (
      esLaMisma &&
      minutosDeLaVendedoraEnEquipo !== null &&
      Math.abs(suma - minutosDeLaVendedoraEnEquipo) > 1
    ) {
      problemas.push(
        `el celular suma ${suma} min esta semana y su fila de Equipo ${minutosDeLaVendedoraEnEquipo}`,
      );
    }
    // La nota de su turno (3-oct): la que se escribe en Horario para ella.
    if ((await pagina.locator('[data-testid^="mi-horario-nota-"]').count()) === 0) {
      problemas.push('el celular de la vendedora no enseña la nota de su turno');
    }
    console.log(
      `  celular              ${suma} min esta semana (Equipo ${minutosDeLaVendedoraEnEquipo}${esLaMisma ? '' : ', otra persona'})`,
    );
    await contexto.close();
  }

  /* --------------------------------------------------- 7. quien no ha llegado */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    await pagina.goto(base + '/?escenario=sinllegar', { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
    await pagina.locator('[data-testid="sign-in-demo"]').click();
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 1500 });
    const titulares = (
      await texto(pagina, '[data-testid^="hoy-titular-"], [data-testid^="hoy-secundario-"]')
    ).replace(/\|/g, '\n');
    const enInicio = Number(/(\d+)\s*\n?\s*personas? no ha/.exec(titulares)?.[1] ?? 0);
    const enLaLista = (
      (await texto(pagina, '[data-testid="right-now-list"]')).match(/No ha llegado/g) ?? []
    ).length;
    await irPorElMenu(pagina, '/schedule');
    const enHorario = await delante(pagina, '[data-testid$="-sin-llegar"]').count();
    /*
     * El turno se coloca cuarenta minutos atrás, también si eso cae ayer; solo no puede
     * cruzar al domingo, que es otra semana. El primer rato del lunes no hay dónde ponerlo
     * y se dice, en vez de fallar o de dar por bueno un cero.
     */
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Lima',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    const primerRatoDelLunes =
      partes.weekday === 'Mon' && Number(partes.hour) * 60 + Number(partes.minute) < 50;
    if (enInicio === 0 && !primerRatoDelLunes) {
      problemas.push('el escenario «sinllegar» no deja a nadie sin llegar en Inicio');
    }
    if (primerRatoDelLunes) {
      console.log('  no ha llegado        sin comprobar: es el primer rato del lunes');
    }
    if (enHorario !== enInicio || enLaLista !== enInicio) {
      problemas.push(
        `no ha llegado: Inicio ${enInicio} (lista ${enLaLista}), tarjetas de Horario ${enHorario}`,
      );
    }
    await pagina.screenshot({ path: 'capturas/vistas-sin-llegar-horario.png' });
    console.log(
      `  no ha llegado        Inicio ${enInicio} (lista ${enLaLista}), Horario ${enHorario}`,
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
console.log('\nOK: las cifras que se repiten entre pantallas dicen lo mismo.');
