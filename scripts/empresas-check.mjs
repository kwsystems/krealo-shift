#!/usr/bin/env node
/**
 * ¿SE PUEDE TENER DOS EMPRESAS Y CAMBIAR DE UNA A OTRA?
 *
 * POR QUÉ EXISTE ESTE ARNÉS. Andree tiene dos negocios —Universo Tutu en Perú y Univers
 * Toutou en Canadá— y preguntó cómo se manejarían hoy. La respuesta era que no se podía,
 * por dos bloqueos que NINGUNA prueba habría notado:
 *
 *   1. No había forma de crear la segunda empresa. La regla de Firestore dice «solo
 *      servidor» y en el servidor no había ninguna función: la que existe se escribió a
 *      mano en la consola de Firebase.
 *   2. Y aunque existiera, el panel leía tus membresías con `.limit(1)` ordenado por
 *      fecha: se quedaba con la MÁS VIEJA y tiraba el resto en silencio. La segunda
 *      empresa era invisible. Ni un error, ni una pista.
 *
 * Las pruebas con emulador cubren el servidor y las de unidad la regla de dos líneas que
 * elige. Lo que ninguna de las dos puede ver es el fallo propio de este proyecto: que las
 * dos mitades funcionen y el selector no aparezca en la pantalla, o aparezca y no cambie
 * nada. Ya pasó seis veces con campos que existían en los dos extremos y estaban muertos
 * en medio.
 *
 * Así que aquí se crea una empresa DE VERDAD en un navegador, se comprueba que el
 * selector aparece —no estaba antes, con una sola empresa no debe estar— que cambia el
 * panel, y lo que de verdad decía la tarea: QUE LA ELECCIÓN SOBREVIVA A UNA RECARGA,
 * porque «si cada recarga vuelve a la primera, el selector no sirve de nada».
 *
 * USO
 *   npm run demo:export
 *   node scripts/empresas-check.mjs dist-demo
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { cargarPlaywright, entrarComoDemo, irA, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8216;
const CAPTURAS = process.env.EMPRESAS_SHOTS ?? '/tmp/ks-empresas';

/** La que se crea en la demostración. El nombre real del segundo negocio de Andree. */
const NUEVA = 'Univers Toutou';
const SEDE_NUEVA = 'Montreal Centre';
const ZONA_NUEVA = 'America/Toronto';

/** Deja solo letras, números y espacios simples: los textos pintados traen basura invisible. */
const normalizar = (texto) =>
  texto
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/ +/g, ' ')
    .trim();

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

await mkdir(CAPTURAS, { recursive: true });

const { base, cerrar } = await servirExport(RAIZ, PUERTO);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const foto = (pagina, nombre) => pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`) });

/** Abre Ajustes con la tarjeta de organización desplegada. */
async function enAjustes(pagina) {
  await irA(pagina, base, '/settings');
  /*
   * LAS TARJETAS SON PLEGABLES y arrancan cerradas: sin abrirla, los campos están fuera
   * del árbol y buscarlos da «no existe», que se lee como «la pantalla está mal» cuando
   * lo único que pasa es que no se ha tocado el título.
   */
  const titulo = pagina.getByText('Organización', { exact: true }).first();
  if (await titulo.isVisible().catch(() => false)) await titulo.click();
  await pagina.locator('[data-testid="org-name"]').waitFor({ timeout: 20000 });
}

const contexto = await navegador.newContext({ viewport: { width: 1280, height: 1600 } });
const pagina = await contexto.newPage();

try {
  await entrarComoDemo(pagina, base);
  await enAjustes(pagina);
  await foto(pagina, '1-ajustes');

  /* ------------------------------------------------------------------ */
  const caso1 = 'con una sola empresa NO hay selector';
  /*
   * La mitad que se olvida. Un desplegable de un solo elemento sugiere que hay algo que
   * elegir donde no lo hay, y además este arnés necesita saber que el selector que verá
   * después apareció por la empresa nueva y no porque esté siempre.
   */
  const selectorAntes = await pagina.locator('[data-testid="organization-pick"]').count();
  if (selectorAntes !== 0) {
    fallar(caso1, `el selector de empresa ya estaba con una sola empresa (${selectorAntes})`);
  } else {
    pasa(caso1, 'ningún desplegable de un elemento');
  }

  /* ------------------------------------------------------------------ */
  const caso2 = 'el formulario de alta de empresa existe y está a la vista';
  const hayFormulario = await pagina.locator('[data-testid="org-new-name"]').count();
  if (hayFormulario === 0) {
    const texto = (await pagina.innerText('body')).replace(/\s+/g, ' ');
    fallar(caso2, `no hay formulario de alta en Ajustes. Pantalla: ${texto.slice(0, 260)}`);
  } else {
    pasa(caso2, 'nombre, zona, primera sede, idioma e inicio de semana');
  }

  /* ------------------------------------------------------------------ */
  const caso3 = 'crear la empresa la deja elegible';
  await pagina.locator('[data-testid="org-new-name"]').fill(NUEVA);
  await pagina.locator('[data-testid="org-new-timezone"]').fill(ZONA_NUEVA);
  await pagina.locator('[data-testid="org-new-location"]').fill(SEDE_NUEVA);
  await foto(pagina, '2-formulario-lleno');

  await pagina.locator('[data-testid="org-new-submit"]').click();

  /*
   * Se espera a que el SELECTOR aparezca, no a un texto de éxito: el aviso de «creada»
   * podría salir sin que la empresa fuera alcanzable, que es exactamente el fallo que
   * este arnés vigila. El selector apareciendo significa que la lista de empresas volvió
   * del servidor con dos.
   */
  let selector = pagina.locator('[data-testid="organization-pick"]');
  try {
    await selector.waitFor({ timeout: 25000 });
    pasa(caso3, 'el selector de empresa apareció al haber dos');
  } catch {
    const texto = (await pagina.innerText('body')).replace(/\s+/g, ' ');
    fallar(
      caso3,
      'creé la empresa y el selector no apareció: la segunda empresa sigue siendo ' +
        `inalcanzable. Pantalla: ${texto.slice(0, 260)}`,
    );
  }
  await foto(pagina, '3-selector');

  /* ------------------------------------------------------------------ */
  const caso4 = 'cambiar de empresa cambia el panel';
  /*
   * SE MIRA LA CABECERA DEL PANEL, no el propio selector. Un selector que se mueve
   * mientras la pantalla sigue enseñando la otra empresa es el fallo de toda esta
   * semana, y mirando solo el selector es indistinguible del correcto. La cabecera dice
   * «empresa · sede», o sea las dos cosas que tenían que cambiar a la vez.
   *
   * Y NO se mira el campo «Nombre» de la tarjeta de organización, que fue el primer
   * intento: al cambiar de empresa la consulta se repite, la tarjeta plegable vuelve a
   * nacer cerrada y ese campo sale del árbol. El arnés se quedó esperándolo y dio por
   * fallado un cambio que en la captura se veía perfecto.
   */
  const cabecera = () =>
    pagina
      .locator('[data-testid="desktop-header"]')
      .innerText()
      .then((t) => t.replace(/\s+/g, ' ').trim());

  const antes = await cabecera();

  const fichaNueva = pagina
    .locator('[data-testid^="organization-pick-"]')
    .filter({ hasText: NUEVA })
    .first();

  if ((await pagina.locator('[data-testid="organization-pick"]').count()) > 0) {
    await fichaNueva.click();
    await pagina
      .waitForFunction(
        (n) =>
          (document.querySelector('[data-testid="desktop-header"]')?.innerText ?? '').includes(n),
        NUEVA,
        { timeout: 25000 },
      )
      .catch(() => undefined);

    const despues = await cabecera();
    if (!despues.includes(NUEVA)) {
      fallar(
        caso4,
        `elegí «${NUEVA}» en el selector y la cabecera sigue diciendo «${despues}»: ` +
          'el selector se mueve y la pantalla no',
      );
    } else if (!despues.includes(SEDE_NUEVA)) {
      /*
       * La otra mitad: al cambiar de empresa hay que OLVIDAR la sede elegida. Si no, la
       * sede de la empresa anterior seguiría seleccionada aunque no esté en la lista
       * nueva, y la pantalla pediría datos de una sede que ya no se puede leer.
       */
      fallar(
        caso4,
        `la empresa cambió pero la sede no: «${despues}» no menciona «${SEDE_NUEVA}», ` +
          'la única sede de la empresa nueva',
      );
    } else {
      pasa(caso4, `«${antes}» → «${despues}»`);
    }
  } else {
    fallar(caso4, 'no llegué a tener selector que cambiar');
  }
  await foto(pagina, '4-cambiada');

  /* ------------------------------------------------------------------ */
  const casoBarra = 'se cambia de sede DESDE LA BARRA DE ARRIBA, sin pasar por Ajustes';
  /*
   * LA MITAD QUE FALTABA. Todo lo de arriba se hace dentro de Ajustes, y ese era el
   * problema que señaló Andree: «es bien difícil buscarlo para una persona que no conoce
   * la app». Desde el 2026-09-24 la barra de arriba es el conmutador, así que hay que
   * comprobar el camino que de verdad va a usar la gente, no solo el que existía.
   *
   * Se comprueba con la SEDE y no con la empresa porque en la demostración la empresa
   * nueva desaparece al recargar —los datos se siembran en memoria— y este caso va después
   * de la recarga del caso 5. Las sedes sembradas están siempre, y el mecanismo que se
   * ejercita es el mismo: abrir la hoja, elegir, y que la pantalla cambie.
   */
  await irA(pagina, base, '/');
  const abridor = pagina.locator('[data-testid="scope-open"]');
  if ((await abridor.count()) === 0) {
    fallar(casoBarra, 'la barra de arriba no se puede pulsar: no hay conmutador');
  } else {
    const cabeceraAntes = await cabecera();
    await abridor.click();
    await pagina.locator('[data-testid="scope-sheet"]').waitFor({ timeout: 20000 });
    const opciones = pagina.locator('[data-testid^="scope-loc-"]');
    const cuantas = await opciones.count();
    if (cuantas < 2) {
      fallar(casoBarra, `la hoja ofrece ${cuantas} sede(s): no hay a dónde cambiar`);
    } else {
      /*
       * SE ELIGE LA QUE NO ESTÁ PUESTA. Pulsar la que ya está seleccionada cerraría la hoja
       * sin cambiar nada y el arnés lo daría por bueno: pasaría comprobando que un botón
       * cierra una hoja, que no es lo que aquí importa.
       */
      /*
       * SE LEE LA ETIQUETA ACCESIBLE Y NO EL TEXTO PINTADO. El texto de la opción llega con
       * un salto de línea delante que ni `replace(/\s+/g,' ')` ni `trim()` quitaban —el
       * mensaje de error del primer intento salía con el espacio dentro—, así que la
       * comparación daba siempre falsa y el arnés elegía la sede que YA estaba puesta.
       * La etiqueta accesible la escribe el componente, es una cadena limpia, y de paso
       * comprobar por ella es comprobar lo que oye un lector de pantalla.
       */
      const nombreActual = normalizar(cabeceraAntes);
      let elegida = null;
      for (let i = 0; i < cuantas; i += 1) {
        const bruta = (await opciones.nth(i).getAttribute('aria-label')) ?? '';
        const texto = bruta.split('.')[0]?.trim() ?? '';
        if (texto !== '' && !nombreActual.includes(normalizar(texto))) {
          elegida = { i, texto };
          break;
        }
      }
      if (elegida === null) {
        fallar(casoBarra, 'todas las sedes de la hoja son la que ya está puesta');
      } else {
        await opciones.nth(elegida.i).click();
        await pagina
          .waitForFunction(
            (n) =>
              (document.querySelector('[data-testid="desktop-header"]')?.innerText ?? '').includes(
                n,
              ),
            elegida.texto,
            { timeout: 25000 },
          )
          .catch(() => undefined);
        const cabeceraDespues = await cabecera();
        if (!cabeceraDespues.includes(elegida.texto)) {
          fallar(
            casoBarra,
            `elegí «${elegida.texto}» en la hoja de la barra y la cabecera sigue diciendo ` +
              `«${cabeceraDespues}»: la hoja se cierra y la pantalla no cambia`,
          );
        } else {
          pasa(casoBarra, `«${cabeceraAntes}» → «${cabeceraDespues}»`);
        }
      }
    }
  }
  await foto(pagina, '6-desde-la-barra');

  /* ------------------------------------------------------------------ */
  const casoAlta = 'desde la barra se LLEGA al alta, con el formulario ya abierto';
  /*
   * El conmutador no duplica el formulario de alta: lleva a Ajustes con la tarjeta ya
   * abierta. Eso hay que comprobarlo entero, porque media solución —llevar a Ajustes y
   * dejar ocho tarjetas cerradas— deja el problema igual que estaba: el formulario existía
   * y no se encontraba.
   */
  await irA(pagina, base, '/');
  await pagina.locator('[data-testid="scope-open"]').click();
  await pagina.locator('[data-testid="scope-sheet"]').waitFor({ timeout: 20000 });
  await pagina.locator('[data-testid="scope-nueva-empresa"]').click();
  const llego = await pagina
    .locator('[data-testid="org-new-name"]')
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!llego) {
    const texto = (await pagina.innerText('body')).replace(/\s+/g, ' ');
    fallar(
      casoAlta,
      `no llegué al formulario de alta de empresa. Pantalla: ${texto.slice(0, 220)}`,
    );
  } else {
    pasa(casoAlta, 'la tarjeta de organización llega abierta');
  }
  await foto(pagina, '7-alta-desde-la-barra');

  /* ------------------------------------------------------------------ */
  const caso5 = 'la empresa elegida SOBREVIVE a una recarga';
  /*
   * El caso que la tarea pedía con estas palabras: «que recuerde cuál elegiste: si cada
   * recarga vuelve a la primera, el selector no sirve de nada». Y en web «recarga» es
   * además cada pestaña nueva, o sea todos los días.
   *
   * Se recarga la página entera y se vuelve a Ajustes, como quien cierra el navegador y
   * vuelve mañana. La demostración siembra sus datos en memoria en cada arranque, así que
   * la empresa creada desaparece al recargar —eso es de la demostración, no de la app— y
   * lo que se comprueba es lo que SÍ se puede comprobar aquí: que la elección quedó
   * guardada en el dispositivo. Si vuelve a `null`, el selector no sirve.
   */
  const guardada = await pagina.evaluate(() => {
    const crudo = window.localStorage.getItem('krealo-shift.dev.app.preferences');
    if (crudo === null) return { estado: 'sin-preferencias' };
    try {
      return { estado: 'ok', valor: JSON.parse(crudo).managerOrganizationId ?? null };
    } catch {
      return { estado: 'ilegible', valor: crudo.slice(0, 80) };
    }
  });

  if (guardada.estado !== 'ok') {
    fallar(caso5, `no hay preferencias guardadas en el dispositivo (${guardada.estado})`);
  } else if (guardada.valor === null) {
    fallar(
      caso5,
      'la empresa elegida no quedó guardada: al recargar se volvería a la primera, ' +
        'que es justo lo que la tarea decía que no puede pasar',
    );
  } else {
    await pagina.reload({ waitUntil: 'networkidle' });
    const sigue = await pagina.evaluate(() => {
      const crudo = window.localStorage.getItem('krealo-shift.dev.app.preferences');
      return crudo === null ? null : (JSON.parse(crudo).managerOrganizationId ?? null);
    });
    if (sigue === guardada.valor) {
      pasa(caso5, `recordada tras recargar (${String(sigue).slice(0, 20)}…)`);
    } else {
      fallar(caso5, `antes de recargar era «${guardada.valor}» y después «${sigue}»`);
    }
  }
  await foto(pagina, '5-tras-recargar');
} catch (error) {
  fallar('el arnés no llegó al final', error.message);
  await foto(pagina, 'error').catch(() => undefined);
}

await contexto.close();
await navegador.close();
await cerrar();

console.log(`\nCapturas en ${CAPTURAS}\n`);
if (problemas.length > 0) {
  console.log(`${problemas.length} problema(s):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Se puede crear la segunda empresa, cambiar a ella, y la elección se recuerda.');
