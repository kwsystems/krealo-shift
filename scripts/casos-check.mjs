/**
 * «Por resolver» en Horas y las horas que se deben (Andree, 1-oct).
 *
 * «Lo que debería salir acá es que yo vea que ella me debe horas… y a ella debería
 * aparecerle en su apartado… debería haber algo más ahí donde se vean mejor todos estos
 * casos y yo poder arreglarlos rápidamente.» Lo que se comprueba, en la demostración:
 *
 * 1. HORAS ENSEÑA LOS CASOS de la semana: quien se fue enferma a media mañana y quien
 *    marcó la jornada entera sin refrigerio, cada uno dicho con palabras y con su arreglo.
 * 2. «LE DEBE» los registra: el caso se va de la lista y su ficha de Equipo enseña lo que
 *    debe; «Ya las compensó» lo deja sin nada pendiente.
 * 3. «DESCONTAR REFRIGERIO» quita el caso y la hora del refrigerio del total de la semana.
 * 4. LAS OTRAS SALIDAS —«Está justificado» y «Trabajó sin refrigerio»— quitan el caso sin
 *    tocar las horas.
 * 5. EL CELULAR de la persona enseña «Horas que debes».
 * 6. EN UN TELÉFONO la lista y su hoja caben.
 * 7. LA SALIDA QUE PUSO EL SISTEMA (5-oct): sale en «Por resolver» con su hora, la fila de
 *    Horas y la tarjeta de Horario dicen «Salida automática», y «La salida está bien» quita el
 *    caso sin quitar la marca.
 *
 * La semana es la ANTERIOR: la demostración la siembra entera, así que el arnés no depende
 * del día de la semana en que se corra.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/casos-check.mjs dist-demo
 */
import { mkdirSync } from 'node:fs';

import {
  servirExport,
  cargarPlaywright,
  esperarPantalla,
  medirContraste,
  MARCADOR_ACCESO,
  MARCADORES,
  irA,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/casos-check.mjs <export-demo>');
  process.exit(2);
}

mkdirSync('capturas', { recursive: true });
const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8136);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const esperar = (pagina, ms = 1200) => pagina.waitForTimeout(ms);

async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
}

/** Horas en la semana anterior, esperando a «Por resolver». */
async function horasDeLaSemanaPasada(pagina) {
  await irA(pagina, base, '/hours', { asentar: 1200 });
  await pagina.locator('[data-testid="week-previous"]').click();
  await esperar(pagina, 1800);
  try {
    await pagina.locator('[data-testid="por-resolver"]').waitFor({ timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Los casos que se ven: `{ id, texto }`, con el id del caso (`<jornada>:<tipo>`). */
async function casos(pagina) {
  return pagina.locator('[data-testid^="caso-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => ({ id: n.getAttribute('data-testid').slice('caso-'.length), n }))
      .filter(({ id }) => /:(faltan_horas|sin_refrigerio|sin_salida|salida_automatica)$/.test(id))
      .map(({ id, n }) => ({ id, texto: (n.innerText || '').replace(/\s+/g, ' ').trim() })),
  );
}

/** El total neto de la semana, en minutos. */
async function totalNeto(pagina) {
  const texto = await pagina.locator('[data-testid="total-net"]').innerText();
  const horas = [...texto.matchAll(/(\d+):(\d{2})/g)].at(-1);
  return horas === undefined ? null : Number(horas[1]) * 60 + Number(horas[2]);
}

const clic = (pagina, testid) => pagina.locator(`[data-testid="${testid}"]`).first().click();

/** Espera a que el caso se vaya; `false` si sigue ahí. */
async function seFue(pagina, id) {
  try {
    await pagina
      .locator(`[data-testid="caso-${id}"]`)
      .waitFor({ state: 'detached', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/** La ficha de Equipo de quien se llama así, abierta por la barra lateral sin recargar. */
async function abrirFicha(pagina, nombre) {
  await pagina.locator('a[href$="/team"]').first().click();
  await esperarPantalla(pagina, MARCADORES['/team'], { asentar: 800 });
  // La fila misma: con el prefijo están también la lista entera, su tira y su casilla.
  const id = await pagina
    .locator('[data-testid^="team-member-"]')
    .evaluateAll(
      (nodos, buscado) =>
        nodos
          .map((n) => ({ id: n.getAttribute('data-testid'), texto: n.innerText || '' }))
          .find(
            ({ id, texto }) => /^team-member-[0-9a-f-]{36}$/.test(id) && texto.includes(buscado),
          )?.id,
      nombre,
    );
  if (id === undefined) throw new Error(`Equipo no tiene a «${nombre}»`);
  await pagina.locator(`[data-testid="${id}"]`).click();
  await pagina.locator('[data-testid="employee-detail-sheet"]').waitFor({ timeout: 10000 });
  await pagina.locator('[data-testid="horas-que-debe"]').waitFor({ timeout: 10000 });
  // Las horas llegan después que la ficha: se espera a la primera fila, sin fallar si no hay.
  await pagina
    .locator('[data-testid="horas-que-debe"] [data-testid^="debe-"]')
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  await esperar(pagina, 400);
}

/** Lo que se sale del ancho de la ventana. */
async function desborde(pagina, selector) {
  return pagina.evaluate((sel) => {
    const vista = document.documentElement.clientWidth;
    const culpables = [];
    for (const nodo of Array.from(document.querySelectorAll(`${sel} *`))) {
      const caja = nodo.getBoundingClientRect();
      if (caja.width > 0 && caja.right > vista + 1) {
        culpables.push(`${Math.round(caja.right)}px «${(nodo.textContent ?? '').slice(0, 30)}»`);
      }
    }
    return {
      arrastre: document.documentElement.scrollWidth - vista,
      culpables: culpables.slice(0, 3),
    };
  }, selector);
}

try {
  /* ------------------------------------------------- 1, 2 y 3: los arreglos principales */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    if (!(await horasDeLaSemanaPasada(pagina))) {
      problemas.push('Horas no enseña «Por resolver» en la semana anterior');
    }
    const lista = await casos(pagina);
    const falta = lista.find((c) => c.id.endsWith(':faltan_horas'));
    const refrigerio = lista.find((c) => c.id.endsWith(':sin_refrigerio'));
    console.log(`  por resolver         ${lista.length} casos`);
    for (const caso of lista) console.log(`                       ${caso.texto.slice(0, 110)}`);
    if (falta === undefined) problemas.push('no sale el caso de quien se fue antes');
    else if (!/Salió a las .* y su turno acababa a las/.test(falta.texto)) {
      problemas.push(`el caso de quien se fue antes no dice qué pasó: «${falta.texto}»`);
    } else if (!/Le faltan \d/.test(falta.texto) || !/Motivo que dio/.test(falta.texto)) {
      problemas.push(`el caso de quien se fue antes no dice cuánto ni el motivo: «${falta.texto}»`);
    }
    if (refrigerio === undefined) problemas.push('no sale el caso de quien no marcó refrigerio');
    else if (!/sin refrigerio/.test(refrigerio.texto)) {
      problemas.push(`el caso del refrigerio no lo dice: «${refrigerio.texto}»`);
    }

    const contraste = await medirContraste(pagina, {
      minimo: 4.5,
      minimoGrande: 3,
      tamanoGrande: 24,
    });
    const enLaCaja = await pagina
      .locator('[data-testid="por-resolver"]')
      .innerText()
      .catch(() => '');
    const malos = contraste.fallos.filter((f) => enLaCaja.includes(f.texto));
    if (malos.length > 0) {
      problemas.push(
        `contraste en «Por resolver»: ${malos
          .slice(0, 3)
          .map((f) => `«${f.texto}» ${f.razon}:1`)
          .join(', ')}`,
      );
    }
    await pagina.locator('[data-testid="por-resolver"]').screenshot({
      path: 'capturas/casos-horas.png',
    });

    // --- 3. Descontar el refrigerio: el caso se va y la semana pierde esa hora.
    if (refrigerio !== undefined) {
      const antes = await totalNeto(pagina);
      await clic(pagina, `caso-${refrigerio.id}-refrigerio`);
      const fuera = await seFue(pagina, refrigerio.id);
      await esperar(pagina, 800);
      const despues = await totalNeto(pagina);
      if (!fuera) problemas.push('«Descontar refrigerio» no quita el caso');
      // Lo que se descuenta es el refrigerio de SU turno, el que dice el propio caso.
      const deTurno = /lleva (?:(\d+) h ?)?(?:(\d+) min)? de refrigerio/.exec(refrigerio.texto);
      const esperado =
        deTurno === null ? null : Number(deTurno[1] ?? 0) * 60 + Number(deTurno[2] ?? 0);
      if (antes === null || despues === null || esperado === null || antes - despues !== esperado) {
        problemas.push(
          `«Descontar refrigerio» deja la semana en ${despues} min, antes ${antes} y su turno lleva ${esperado}`,
        );
      }
      console.log(`  descontar refrigerio total ${antes} → ${despues} min (turno con ${esperado})`);
    }

    // --- 2. «Le debe»: la hoja trae lo que falta; guardar lo registra en su ficha.
    if (falta !== undefined) {
      const nombre = falta.texto.split(/\s(?:lun|mar|mié|jue|vie|sáb|dom)\b/i)[0].trim();
      await clic(pagina, `caso-${falta.id}-debe`);
      await pagina.locator('[data-testid="caso-falta-sheet"]').waitFor({ timeout: 8000 });
      const propuesta = await pagina.locator('[data-testid="caso-falta-horas"]').inputValue();
      await pagina.locator('[data-testid="caso-falta-nota"]').fill('Se fue enferma');
      await pagina.screenshot({ path: 'capturas/casos-hoja.png' });
      await clic(pagina, 'caso-falta-guardar');
      await pagina
        .locator('[data-testid="caso-falta-sheet"]')
        .waitFor({ state: 'detached', timeout: 8000 })
        .catch(() => problemas.push('la hoja de «Le debe» no se cierra al guardar'));
      if (!(await seFue(pagina, falta.id))) problemas.push('«Le debe» no quita el caso');
      console.log(`  le debe              ${propuesta} (${nombre})`);

      await abrirFicha(pagina, nombre);
      const total = await pagina.locator('[data-testid="horas-que-debe-total"]').innerText();
      const ficha = await pagina.locator('[data-testid="horas-que-debe"]').innerText();
      if (total.trim() !== propuesta) {
        problemas.push(`su ficha dice que debe «${total}», no ${propuesta}`);
      }
      if (!ficha.includes('Se fue enferma')) problemas.push('su ficha no enseña la nota');
      await pagina.locator('[data-testid="horas-que-debe"]').screenshot({
        path: 'capturas/casos-ficha.png',
      });
      await pagina.locator('[data-testid$="-compensada"]').first().click();
      await esperar(pagina, 1200);
      const saldado = await pagina.locator('[data-testid="horas-que-debe-total"]').innerText();
      if (saldado.trim() !== 'Nada') {
        problemas.push(`después de «Ya las compensó» su ficha dice «${saldado}»`);
      }
      if ((await pagina.locator('[data-testid$="-deshacer"]').count()) === 0) {
        problemas.push('lo compensado no se puede deshacer');
      }
      console.log(`  ficha                debe ${total.trim()} → «${saldado.trim()}»`);
    }
    await contexto.close();
  }

  /* --------------------------------------- 4: las otras salidas, en una demo recién puesta */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await horasDeLaSemanaPasada(pagina);
    const lista = await casos(pagina);
    const falta = lista.find((c) => c.id.endsWith(':faltan_horas'));
    const refrigerio = lista.find((c) => c.id.endsWith(':sin_refrigerio'));
    const antes = await totalNeto(pagina);
    if (refrigerio !== undefined) {
      await clic(pagina, `caso-${refrigerio.id}-sin-refrigerio`);
      if (!(await seFue(pagina, refrigerio.id))) {
        problemas.push('«Trabajó sin refrigerio» no quita el caso');
      }
    }
    if (falta !== undefined) {
      await clic(pagina, `caso-${falta.id}-justificado`);
      await pagina.locator('[data-testid="caso-falta-sheet"]').waitFor({ timeout: 8000 });
      if ((await pagina.locator('[data-testid="caso-falta-horas"]').count()) > 0) {
        problemas.push('«Está justificado» pide las horas que debe');
      }
      await clic(pagina, 'caso-falta-guardar');
      if (!(await seFue(pagina, falta.id))) problemas.push('«Está justificado» no quita el caso');
    }
    await esperar(pagina, 800);
    const despues = await totalNeto(pagina);
    if (antes !== despues) {
      problemas.push(`las salidas que no descuentan cambian la semana: ${antes} → ${despues}`);
    }
    const quedan = await pagina.locator('[data-testid="por-resolver"]').count();
    console.log(
      `  justificado y sin refrigerio: semana ${antes} → ${despues}; caja ${quedan ? 'sigue' : 'se fue'}`,
    );
    await contexto.close();
  }

  /* ------------------------------------------- 7: la salida que puso el sistema (5-oct) */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await horasDeLaSemanaPasada(pagina);
    const sola = (await casos(pagina)).find((c) => c.id.endsWith(':salida_automatica'));
    if (sola === undefined) {
      problemas.push('no sale en «Por resolver» la jornada que se cerró sola');
    } else {
      if (!/se cerró sola a las 2:00|se cerró sola a las 14:00/.test(sola.texto)) {
        problemas.push(`el caso de la salida automática no dice la hora: «${sola.texto}»`);
      }
      const sesionId = sola.id.slice(0, -':salida_automatica'.length);
      const fila = await pagina
        .locator(`[data-testid="session-${sesionId}"]`)
        .first()
        .innerText()
        .catch(() => '');
      if (!/Salida automática/.test(fila)) {
        problemas.push(
          `la fila de Horas no dice «Salida automática»: «${fila.replace(/\s+/g, ' ')}»`,
        );
      }
      await clic(pagina, `caso-${sola.id}-ok`);
      if (!(await seFue(pagina, sola.id))) problemas.push('«La salida está bien» no quita el caso');
      const filaDespues = await pagina
        .locator(`[data-testid="session-${sesionId}"]`)
        .first()
        .innerText()
        .catch(() => '');
      if (!/Salida automática/.test(filaDespues)) {
        problemas.push('dar la salida por buena borra «Salida automática» de la fila');
      }

      // Horario, por el menú —recargar perdería la demostración—, en la misma semana. Horas
      // sigue montada detrás, así que todo se busca dentro de Horario.
      await pagina.locator('a[href$="/schedule"]').first().click();
      await esperarPantalla(pagina, MARCADORES['/schedule'], { asentar: 800 });
      const horario = pagina.locator('[data-testid="manager-schedule"]');
      const enHorario = () => horario.locator('[data-testid$="-salida-automatica"]').count();
      let tarjetas = await enHorario();
      if (tarjetas === 0) {
        await horario.locator('[data-testid="week-previous"]').click();
        await esperar(pagina, 1800);
        tarjetas = await enHorario();
      }
      if (tarjetas === 0) problemas.push('la tarjeta de Horario no dice «Salida automática»');
      console.log(
        `  salida automática    «${sola.texto.slice(0, 80)}» · Horario ${tarjetas} tarjeta(s)`,
      );
    }
    await contexto.close();
  }

  /* -------------------------------------------------------- 6: en un teléfono, cabe */
  {
    const contexto = await navegador.newContext({ viewport: { width: 360, height: 800 } });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await horasDeLaSemanaPasada(pagina);
    await pagina.locator('[data-testid="por-resolver"]').scrollIntoViewIfNeeded();
    const caja = await desborde(pagina, '[data-testid="por-resolver"]');
    if (caja.arrastre > 1 || caja.culpables.length > 0) {
      problemas.push(
        `a 360 px «Por resolver» se sale: ${caja.culpables.join(', ') || caja.arrastre}`,
      );
    }
    await pagina.locator('[data-testid="por-resolver"]').screenshot({
      path: 'capturas/casos-360.png',
    });
    const falta = (await casos(pagina)).find((c) => c.id.endsWith(':faltan_horas'));
    if (falta !== undefined) {
      await clic(pagina, `caso-${falta.id}-debe`);
      await pagina.locator('[data-testid="caso-falta-sheet"]').waitFor({ timeout: 8000 });
      await esperar(pagina, 500);
      const hoja = await desborde(pagina, '[data-testid="caso-falta-sheet"]');
      if (hoja.culpables.length > 0) {
        problemas.push(`a 360 px la hoja de «Le debe» se sale: ${hoja.culpables.join(', ')}`);
      }
      await pagina.screenshot({ path: 'capturas/casos-hoja-360.png' });
    }
    console.log(`  360 px               caja ${caja.culpables.length} desbordes`);
    await contexto.close();
  }

  /* -------------------------------------------- 5: el celular de la persona lo enseña */
  {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await contexto.newPage();
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
    await pagina.locator('[data-testid="sign-in-demo-vendedor"]').click();
    await pagina.locator('[data-testid="mi-horario-hola"]').waitFor({ timeout: 30000 });
    try {
      await pagina.locator('[data-testid="mi-horario-debes"]').waitFor({ timeout: 10000 });
      const total = await pagina.locator('[data-testid="mi-horario-debes-total"]').innerText();
      const texto = await pagina.locator('[data-testid="mi-horario-debes"]').innerText();
      // Como una duración, igual que el resto del celular (auditoría, 4-oct): no «02:30».
      if (total.trim() !== '2 h 30 min') {
        problemas.push(`su celular dice que debe «${total}», no «2 h 30 min»`);
      }
      if (!texto.includes('Cita médica')) problemas.push('su celular no enseña la nota');
      const caja = await desborde(pagina, '[data-testid="mi-horario-debes"]');
      if (caja.culpables.length > 0) {
        problemas.push(`«Horas que debes» se sale: ${caja.culpables.join(', ')}`);
      }
      await pagina.locator('[data-testid="mi-horario-debes"]').screenshot({
        path: 'capturas/casos-celular.png',
      });
      console.log(`  celular              debe ${total.trim()}`);
    } catch {
      problemas.push('su celular no enseña «Horas que debes»');
    }
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
console.log('\nOK: «Por resolver» y las horas que se deben, en Horas, Equipo y el celular.');
