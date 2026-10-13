/**
 * «NO HA LLEGADO» SE RESUELVE EN EL MOMENTO (12-oct).
 *
 * Andree: «si no marca al comienzo cuenta ya como posibilidad de marcar como falta, no
 * esperar a todo el día… hoy no ha marcado porque se ha olvidado, ¿dónde lo arreglo? No
 * aparece en ningún lado». Y: «en Horario, en Horas, en Reportes, todo debería calzar».
 *
 * En la demostración, con dos personas que no han llegado (`?escenario=sinllegar`):
 *
 * 1. «VINO Y NO MARCÓ» desde Inicio: la hoja pide solo la entrada; al guardar, la persona
 *    sale de «Todavía no ha marcado», en la lista de ahora deja de decir «No ha llegado», su
 *    tarjeta de Horario también, y en Horas aparece su jornada en curso.
 * 2. «FALTÓ» desde Inicio: la hoja no ofrece «Cumplió su horario» (el turno no ha
 *    terminado); al guardar, es falta YA en todas las vistas: Inicio la cuenta como falta,
 *    Horario pinta la tarjeta de falta, Horas la lista en sus faltas, Equipo la cuenta y
 *    Reportes suma una más. Y no sale nada más de ese día en «Por resolver».
 * 3. «VINO Y NO MARCÓ» CON EL DÍA ENTERO (13-oct), en una falta de la semana pasada: la hoja
 *    trae el refrigerio de su turno, y al guardar no nace ningún caso en «Por resolver».
 * 4. Y CON 0 DE REFRIGERIO —de corrido—: sale UN caso, nunca «sin refrigerio» y «trabajó de
 *    más» a la vez, y una sola decisión lo cierra.
 * 5. EL CASO DE ANDREE (`?escenario=refrigerio`): un turno con 1 h de refrigerio trabajado
 *    entero sin marcarlo. Sale UN caso, el de la extra, que dice que incluye su refrigerio; y
 *    «No es extra» lo cierra —en Por resolver y en la hoja de la jornada— sin dejar el
 *    «sin refrigerio» detrás.
 *
 * Es la demostración en un navegador: no toca datos de nadie, y al cerrar no queda nada.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/sin-marcar-check.mjs dist-demo
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
  console.error('Uso: node scripts/sin-marcar-check.mjs <export-demo>');
  process.exit(2);
}

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8163);
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

async function entrar(pagina) {
  await pagina.goto(base + '/?escenario=sinllegar', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 1500 });
}

/** Por el menú y no recargando: en la demostración, recargar vuelve a los datos de partida. */
async function irPorElMenu(pagina, ruta) {
  await pagina.locator(`a[href$="${ruta}"]`).first().click();
  await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 1500 });
}

/** Las filas de «Todavía no ha marcado»: id del turno y texto. */
const filasSinMarcar = (pagina) =>
  delante(pagina, '[data-testid^="sin-marcar-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => n.getAttribute('data-testid') ?? '')
      .filter((id) => /^sin-marcar-[^-].*$/.test(id) && !/-(vino|falto)$/.test(id))
      .filter((id) => id !== 'sin-marcar-ahora' && id !== 'sin-marcar-hecho')
      .map((id) => id.slice('sin-marcar-'.length)),
  );

/** El nombre que dice la fila de ese turno en «Todavía no ha marcado». */
const nombreDeLaFila = async (pagina, turnoId) =>
  ((await texto(pagina, `[data-testid="sin-marcar-${turnoId}"]`)).split('\n')[0] ?? '').trim();

/**
 * Las filas de esa persona en «Ahora mismo» de Inicio: nombre, hora y estado. Puede tener
 * más de una —el turno de ahora y el siguiente—, y se devuelven todas juntas.
 */
async function filaDeAhora(pagina, nombre) {
  const lineas = (await texto(pagina, '[data-testid="right-now-list"]'))
    .split('\n')
    .map((l) => l.trim())
    // Solo las que dicen algo: la columna de tiempo vacía deja una línea sin letras.
    .filter((l) => /[\p{L}\p{N}]/u.test(l));
  const suyas = [];
  lineas.forEach((linea, i) => {
    if (linea === nombre) suyas.push(lineas.slice(i, i + 3).join(' · '));
  });
  return suyas.join(' || ');
}

/** Los ids de los casos de «Por resolver» que se ven. */
const idsDeCasos = (pagina) =>
  delante(pagina, '[data-testid^="caso-"]').evaluateAll((nodos) =>
    nodos
      .map((n) => (n.getAttribute('data-testid') ?? '').slice('caso-'.length))
      .filter((id) => /^[^\s]+:[a-z_]+$/.test(id)),
  );

const esperarHoja = (pagina, id) =>
  pagina.locator(`[data-testid="${id}"]`).first().waitFor({ timeout: 8000 });
const esperarQueSeCierre = (pagina, id, que) =>
  pagina
    .locator(`[data-testid="${id}"]`)
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => problemas.push(`${que}: la hoja no se cerró al guardar`));

try {
  /* -------------------------------------------------- 1. vino y no marcó */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(e.message));
    await entrar(pagina);

    const antes = await filasSinMarcar(pagina);
    console.log(`  Inicio               ${antes.length} sin marcar`);
    if (antes.length === 0) {
      problemas.push('Inicio no enseña «Todavía no ha marcado» con dos personas sin llegar');
    } else {
      const turno = antes[0];
      const nombre = await nombreDeLaFila(pagina, turno);
      await delante(pagina, `[data-testid="sin-marcar-${turno}-vino"]`).first().click();
      await esperarHoja(pagina, 'falta-vino-hoja');
      if ((await pagina.locator('[data-testid="falta-vino-salida"]').count()) > 0) {
        problemas.push('vino y no marcó: con el turno en curso pide también la salida');
      }
      await pagina.locator('[data-testid="falta-vino-motivo"]').fill('Se olvidó de marcar');
      await pagina.locator('[data-testid="falta-vino-guardar"]').click();
      await esperarQueSeCierre(pagina, 'falta-vino-hoja', 'vino y no marcó');
      await pagina.waitForTimeout(1500);

      const despues = await filasSinMarcar(pagina);
      if (despues.includes(turno)) {
        problemas.push('vino y no marcó: sigue en «Todavía no ha marcado» de Inicio');
      }
      const fila = await filaDeAhora(pagina, nombre);
      if (/No ha llegado|Falta/.test(fila)) {
        problemas.push(`vino y no marcó: Inicio sigue diciendo de ${nombre}: «${fila}»`);
      }
      console.log(
        `  tras «vino»          Inicio ${despues.length} sin marcar; ${nombre}: «${fila.replace(/\s+/g, ' ').slice(0, 60)}»`,
      );

      await irPorElMenu(pagina, '/schedule');
      const tarjeta = delante(pagina, `[data-testid="shift-${turno}-sin-llegar"]`);
      if ((await tarjeta.count()) > 0) {
        problemas.push('vino y no marcó: su tarjeta de Horario sigue diciendo «No ha llegado»');
      }

      await irPorElMenu(pagina, '/hours');
      const enHoras = await filasSinMarcar(pagina);
      if (enHoras.includes(turno)) {
        problemas.push('vino y no marcó: Horas la sigue teniendo en «Todavía no ha marcado»');
      }
      const enCurso = await texto(pagina, '[data-testid$="-en-curso"]');
      if (!enCurso.includes(nombre) && !(await texto(pagina, 'body')).includes(nombre)) {
        problemas.push(`vino y no marcó: Horas no enseña la jornada de ${nombre}`);
      }
      console.log(`  tras «vino»          Horas ${enHoras.length} sin marcar`);
    }
    if (errores.length > 0)
      problemas.push(`errores de la página: ${errores.slice(0, 3).join(' | ')}`);
    await contexto.close();
  }

  /* -------------------------------------------------------- 2. faltó */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(e.message));
    await entrar(pagina);

    // Lo que dicen Reportes y «Por resolver» antes de decidir nada.
    await irPorElMenu(pagina, '/reports');
    const faltasAntes = ultimaCifra(await texto(pagina, '[data-testid="report-absences"]'));
    await irPorElMenu(pagina, '/hours');
    const casosAntes = await idsDeCasos(pagina);
    await irPorElMenu(pagina, '/');

    const antes = await filasSinMarcar(pagina);
    if (antes.length === 0) {
      problemas.push('faltó: Inicio no enseña «Todavía no ha marcado»');
    } else {
      const turno = antes[0];
      const nombre = await nombreDeLaFila(pagina, turno);
      await delante(pagina, `[data-testid="sin-marcar-${turno}-falto"]`).first().click();
      await esperarHoja(pagina, 'justificar-falta-hoja');
      if ((await pagina.locator('[data-testid="justificar-falta-tipo-credit"]').count()) > 0) {
        problemas.push('faltó: con el turno en curso ofrece «Cumplió su horario»');
      }
      await pagina.locator('[data-testid="justificar-falta-tipo-unjustified"]').click();
      await pagina.locator('[data-testid="justificar-falta-no_notice"]').click();
      await pagina.locator('[data-testid="justificar-falta-guardar"]').click();
      await esperarQueSeCierre(pagina, 'justificar-falta-hoja', 'faltó');
      const error = await texto(pagina, '[data-testid="justificar-falta-error"]');
      if (error !== '') problemas.push(`faltó: el servidor lo rechazó — «${error}»`);
      await pagina.waitForTimeout(1500);

      // Inicio: fuera de «sin marcar», y en «Ahora mismo» como falta.
      const despues = await filasSinMarcar(pagina);
      if (despues.includes(turno)) {
        problemas.push('faltó: sigue en «Todavía no ha marcado» de Inicio');
      }
      const fila = await filaDeAhora(pagina, nombre);
      if (!/Falta/.test(fila) || /No ha llegado/.test(fila)) {
        problemas.push(
          `faltó: Inicio no lo da por falta — ${nombre}: «${fila.replace(/\s+/g, ' ')}»`,
        );
      }
      console.log(
        `  tras «faltó»         Inicio ${despues.length} sin marcar; ${nombre}: «${fila.replace(/\s+/g, ' ').slice(0, 60)}»`,
      );

      // Horario: la tarjeta es falta, no «no ha llegado».
      await irPorElMenu(pagina, '/schedule');
      const conFalta = await delante(pagina, `[data-testid="shift-${turno}-falta"]`).count();
      const sinLlegar = await delante(pagina, `[data-testid="shift-${turno}-sin-llegar"]`).count();
      if (conFalta === 0 || sinLlegar > 0) {
        problemas.push(
          `faltó: la tarjeta de Horario no dice falta (falta ${conFalta}, no ha llegado ${sinLlegar})`,
        );
      }
      console.log(`  tras «faltó»         Horario falta ${conFalta}, no ha llegado ${sinLlegar}`);

      // Horas: en las faltas de la semana, sin revisar no (ya se dijo), y nada en Por resolver.
      await irPorElMenu(pagina, '/hours');
      const enFaltas = await delante(pagina, `[data-testid="falta-${turno}"]`).count();
      if (enFaltas === 0) problemas.push('faltó: Horas no la lista en las faltas de la semana');
      const estado = await texto(pagina, `[data-testid="falta-${turno}-estado"]`);
      if (/Sin revisar/i.test(estado)) {
        problemas.push(`faltó: Horas la deja «Sin revisar» después de decirlo — «${estado}»`);
      }
      // Nada NUEVO en «Por resolver»: puede tener casos de otros días, pero no de este.
      const nuevos = (await idsDeCasos(pagina)).filter((id) => !casosAntes.includes(id));
      if (nuevos.length > 0) {
        problemas.push(`faltó: «Por resolver» saca casos nuevos de ese día: ${nuevos.join(', ')}`);
      }
      if ((await filasSinMarcar(pagina)).includes(turno)) {
        problemas.push('faltó: Horas la sigue teniendo en «Todavía no ha marcado»');
      }
      console.log(`  tras «faltó»         Horas: en faltas ${enFaltas}, estado «${estado.trim()}»`);

      // Equipo: su fila cuenta la falta.
      await irPorElMenu(pagina, '/team');
      const equipo = await texto(pagina, '[data-testid$="-faltas"][data-testid^="team-member-"]');
      if (!/\d/.test(equipo)) problemas.push('faltó: Equipo no cuenta ninguna falta esta semana');
      console.log(`  tras «faltó»         Equipo «${equipo.replace(/\s+/g, ' ').slice(0, 60)}»`);

      // Reportes: una más que antes.
      await irPorElMenu(pagina, '/reports');
      const faltasDespues = ultimaCifra(await texto(pagina, '[data-testid="report-absences"]'));
      if (faltasAntes === null || faltasDespues !== faltasAntes + 1) {
        problemas.push(
          `faltó: Reportes pasó de ${faltasAntes} a ${faltasDespues} faltas, no a una más`,
        );
      }
      console.log(`  tras «faltó»         Reportes ${faltasAntes} → ${faltasDespues} faltas`);
    }
    if (errores.length > 0)
      problemas.push(`errores de la página: ${errores.slice(0, 3).join(' | ')}`);
    await contexto.close();
  }
  /* ------------------------------ 3 y 4. el día entero, con y sin refrigerio */
  {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(e.message));
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
    await pagina.locator('[data-testid="sign-in-demo"]').click();
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 1500 });
    await irPorElMenu(pagina, '/hours');
    await delante(pagina, '[data-testid="week-previous"]').first().click();
    await pagina.waitForTimeout(1800);

    /** Los casos de «Por resolver», por id. */
    const casos = () =>
      delante(pagina, '[data-testid^="caso-"]').evaluateAll((nodos) =>
        nodos
          .map((n) => ({
            id: (n.getAttribute('data-testid') ?? '').slice('caso-'.length),
            texto: (n.innerText || '').replace(/\s+/g, ' ').trim(),
          }))
          .filter(({ id }) => /^[^\s]+:[a-z_]+$/.test(id)),
      );
    const faltas = () =>
      delante(pagina, '[data-testid$="-vino"][data-testid^="falta-"]').evaluateAll((nodos) =>
        nodos.map((n) => (n.getAttribute('data-testid') ?? '').slice(6, -5)),
      );
    async function registrar(turno, refrigerio, siNoLleva = null) {
      const nombre = (
        (await texto(pagina, `[data-testid="falta-${turno}"]`)).split('\n')[0] ?? ''
      ).trim();
      await delante(pagina, `[data-testid="falta-${turno}-vino"]`).first().click();
      await esperarHoja(pagina, 'falta-vino-hoja');
      const puesto = await pagina
        .locator('[data-testid="falta-vino-refrigerio"]')
        .inputValue()
        .catch(() => null);
      const poner = refrigerio ?? (puesto?.trim() === '0' ? siNoLleva : null);
      if (poner !== null) {
        await pagina.locator('[data-testid="falta-vino-refrigerio"]').fill(poner);
      }
      await pagina.locator('[data-testid="falta-vino-motivo"]').fill('Se olvidó de marcar');
      await pagina.locator('[data-testid="falta-vino-guardar"]').click();
      await esperarQueSeCierre(pagina, 'falta-vino-hoja', 'vino con el día entero');
      await pagina.waitForTimeout(1500);
      return { nombre, puesto };
    }

    // La semana pasada tiene una falta y esta otra: una para cada prueba.
    const deLaPasada = await faltas();
    if (deLaPasada.length === 0) {
      problemas.push('la semana pasada de la demo no tiene ninguna falta');
    } else {
      // 3. Con el refrigerio de su turno: ningún caso nuevo.
      const antes = await casos();
      /*
       * El campo trae el refrigerio de SU turno (lo comprueba la prueba de la hoja con uno de
       * 1 h). Si ese turno no lleva, se pone media hora a mano: lo que se mira aquí es que con
       * refrigerio registrado no nazca ningún caso.
       */
      const { nombre, puesto } = await registrar(deLaPasada[0], null, '30');
      if (puesto === null) {
        problemas.push('vino con el día entero: la hoja no tiene el campo del refrigerio');
      }
      const despues = await casos();
      const nuevos = despues.filter((c) => !antes.some((a) => a.id === c.id));
      if (nuevos.length > 0) {
        problemas.push(
          `vino con su refrigerio: nacen casos en Por resolver — ${nuevos.map((c) => `«${c.texto.slice(0, 90)}»`).join(' · ')}`,
        );
      }
      console.log(
        `  día entero           ${nombre}: refrigerio «${puesto}», ${nuevos.length} caso(s) nuevo(s)`,
      );
    }

    // 4. De corrido (0), en la falta de esta semana: un solo caso, que una decisión cierra.
    await delante(pagina, '[data-testid="week-next"]').first().click();
    await pagina.waitForTimeout(1800);
    const deEsta = await faltas();
    if (deEsta.length === 0) {
      problemas.push('esta semana de la demo no tiene ninguna falta');
    } else {
      const antes2 = await casos();
      const segundo = await registrar(deEsta[0], '0');
      const nuevos2 = (await casos()).filter((c) => !antes2.some((a) => a.id === c.id));
      if (nuevos2.length > 1) {
        problemas.push(
          `de corrido: ${nuevos2.length} casos por la misma hora — ${nuevos2.map((c) => `«${c.texto.slice(0, 80)}»`).join(' · ')}`,
        );
      }
      const tipos = nuevos2
        .map((c) => `${c.id.split(':')[1]}: «${c.texto.slice(0, 160)}»`)
        .join(', ');
      console.log(`  de corrido (0)       ${segundo.nombre}: ${nuevos2.length} caso(s) [${tipos}]`);
      const [caso] = nuevos2;
      if (caso !== undefined) {
        // La otra respuesta —«No es extra» o «Trabajó sin refrigerio»—: una sola decisión.
        const botones = delante(
          pagina,
          `[data-testid="caso-${caso.id}"] [role="button"]:not([data-testid$="-jornada"])`,
        );
        await ((await botones.count()) > 1 ? botones.nth(1) : botones.first()).click();
        await pagina
          .locator(`[data-testid="caso-${caso.id}"]`)
          .waitFor({ state: 'detached', timeout: 8000 })
          .catch(() => problemas.push('de corrido: una decisión no cierra el caso'));
        await pagina.waitForTimeout(1200);
        const quedan = (await casos()).filter((c) => !antes2.some((a) => a.id === c.id));
        if (quedan.length > 0) {
          problemas.push(
            `de corrido: decidido, sigue preguntando — ${quedan.map((c) => `«${c.texto.slice(0, 80)}»`).join(' · ')}`,
          );
        }
        console.log(`  una decisión         quedan ${quedan.length} caso(s) de ese día`);
      }
    }
    if (errores.length > 0)
      problemas.push(`errores de la página: ${errores.slice(0, 3).join(' | ')}`);
    await contexto.close();
  }
  /* ---------------------------------- 5. el caso de Andree, por los dos caminos */
  for (const camino of ['por resolver', 'hoja de la jornada']) {
    const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(e.message));
    await pagina.goto(base + '/?escenario=refrigerio', { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
    await pagina.locator('[data-testid="sign-in-demo"]').click();
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 1500 });
    await irPorElMenu(pagina, '/hours');
    await delante(pagina, '[data-testid="week-previous"]').first().click();
    await pagina.waitForTimeout(1800);

    const delDia = async () =>
      (await idsDeCasos(pagina)).filter((id) => id.startsWith('sin-refrigerio-'));
    const antes = await delDia();
    const texto5 =
      antes.length === 0 ? '' : await texto(pagina, `[data-testid="caso-${antes[0]}"]`);
    if (antes.length !== 1) {
      problemas.push(
        `${camino}: el día sin refrigerio saca ${antes.length} casos, no 1: ${antes.join(', ')}`,
      );
    } else if (!antes[0].endsWith(':fuera_de_turno') || !/Incluye su refrigerio/.test(texto5)) {
      problemas.push(
        `${camino}: el caso no es la extra con su refrigerio — «${texto5.replace(/\s+/g, ' ').slice(0, 160)}»`,
      );
    }
    console.log(
      `  día sin refrigerio   ${camino}: ${antes.length} caso(s) «${texto5.replace(/\s+/g, ' ').slice(0, 110)}»`,
    );

    if (antes.length === 1) {
      const caso = antes[0];
      if (camino === 'por resolver') {
        await delante(pagina, `[data-testid="caso-${caso}-no-extra"]`).first().click();
      } else {
        await delante(pagina, `[data-testid="caso-${caso}-jornada"]`).first().click();
        await esperarHoja(pagina, 'session-detail-sheet');
        await pagina.locator('[data-testid="overtime-remove"]').first().click();
        await pagina
          .locator('[data-testid="session-detail-sheet"]')
          .waitFor({ state: 'detached', timeout: 8000 })
          .catch(() => problemas.push(`${camino}: «No es hora extra» no cierra la hoja`));
      }
      await pagina.waitForTimeout(1800);
      const despues = await delDia();
      const error = await texto(pagina, '[data-testid="por-resolver-error"]');
      if (despues.length > 0) {
        problemas.push(
          `${camino}: «No es extra» deja ${despues.join(', ')}${error ? ` · error «${error}»` : ''}`,
        );
      }
      console.log(`  «No es extra»        ${camino}: quedan ${despues.length} caso(s) de ese día`);
    }
    if (errores.length > 0)
      problemas.push(`errores de la página: ${errores.slice(0, 3).join(' | ')}`);
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
  '\nOK: «Vino y no marcó» y «Faltó» se resuelven en el momento y se ven igual en todas las vistas.',
);
