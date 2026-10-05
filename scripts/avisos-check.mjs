/**
 * LOS AVISOS DEL PANEL (5-oct). Andree: «cuando alguien marca, cuando alguien va a comer, a
 * mí me debe salir una notificación arriba a la derecha avisándome esto y también un popup
 * pero solo en la parte de arriba. Esto es solo para gerentes, administradores. Que se vea
 * bien también en mobile, y que esté en cualquier vista».
 *
 * En la demostración, con `?escenario=avisos`: el panel ya abierto, Ana sale a comer, Bruno
 * vuelve de su descanso y, a la vez, Diego entra y Elena sale. Se comprueba:
 *
 *   1. LA CAMPANA está arriba a la derecha y tiene número.
 *   2. CADA MARCA NUEVA SALE ARRIBA con su frase, debajo de la cabecera, dentro de la
 *      pantalla; como mucho tres, y «y 1 aviso más» con la cuarta.
 *   3. AL ABRIR LA CAMPANA están las cuatro, la más nueva arriba, marcadas como nuevas; al
 *      cerrarla el número se va, y recargar no lo trae de vuelta. Con todas las del día el
 *      panel sigue pequeño (la lista se desplaza), dice cuántas hay, que se vacía cada día y
 *      que el historial está en Horas, adonde lleva su enlace (6-oct).
 *   4. EN TODAS LAS VISTAS DEL PANEL está la campana.
 *   5. EN EL TELÉFONO (390 y 320 px): campana de 44 px, la empresa y la sede no se cortan a
 *      390, los avisos de borde a borde, el panel dentro de la pantalla, nada se sale. En
 *      oscuro también, y el texto del aviso se lee (contraste).
 *   6. APAGAR EL EMERGENTE: llegan marcas, sube el número y no sale nada arriba.
 *   7. SOLO QUIEN GESTIONA: ni el celular de la vendedora ni el reloj tienen campana.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/avisos-check.mjs dist-demo
 */
import {
  cargarPlaywright,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
  medirContraste,
  servirExport,
} from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8241;

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

const FRASES = [
  'Ana salió a comer',
  'Bruno Salazar Nieto volvió a trabajar',
  'Diego Paredes Vega marcó su entrada',
  'Ele marcó su salida',
];

const { base, cerrar } = await servirExport(RAIZ, PUERTO);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const desborde = (pagina) =>
  pagina.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
const caja = (pagina, selector) =>
  pagina
    .locator(selector)
    .first()
    .evaluate((n) => {
      const r = n.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        ancho: r.width,
        alto: r.height,
        derecha: r.right,
        abajo: r.bottom,
      };
    });

async function abrirPanel(
  ancho,
  esquema,
  { escenario = 'avisos', contexto = null, yaDentro = false } = {},
) {
  const ctx =
    contexto ??
    (await navegador.newContext({ viewport: { width: ancho, height: 900 }, colorScheme: esquema }));
  const pagina = await ctx.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  await pagina.goto(`${base}/?escenario=${escenario}`, { waitUntil: 'networkidle' });
  // En un contexto que ya entró, la sesión sigue: se llega directo al panel.
  if (!yaDentro) {
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
    await pagina.locator('[data-testid="sign-in-demo"]').click();
  }
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 300 });
  return { ctx, pagina, errores };
}

/** Los emergentes a la vista, de arriba abajo, con su texto y su caja. */
const emergentes = (pagina) =>
  pagina.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="aviso-emergente-"]')]
      .filter((n) => !n.getAttribute('data-testid').startsWith('aviso-emergente-cerrar-'))
      .map((n) => {
        const r = n.getBoundingClientRect();
        // La primera línea es el glifo del icono: el texto es la que lleva letras.
        const texto = n.innerText
          .split('\n')
          .filter((l) => /[a-z]/i.test(l))
          .join(' · ');
        return { texto, y: r.top, x: r.left, derecha: r.right, abajo: r.bottom };
      })
      .sort((a, b) => a.y - b.y),
  );

try {
  /* ------------------------------------------------- 1-4. escritorio, claro y oscuro */
  for (const esquema of ['light', 'dark']) {
    const etiqueta = `1440px ${esquema}`;
    const { ctx, pagina, errores } = await abrirPanel(1440, esquema);

    // 1. La campana, arriba a la derecha.
    const cabecera = await caja(pagina, '[data-testid="desktop-header"]');
    const campana = await caja(pagina, '[data-testid="avisos-campana"]');
    if (campana.derecha < 1440 - 40 || campana.y > cabecera.abajo)
      fallar(`${etiqueta} campana`, `no está arriba a la derecha (x ${campana.x}, y ${campana.y})`);
    else if (campana.ancho < 44 || campana.alto < 44)
      fallar(`${etiqueta} campana`, `mide ${campana.ancho}×${campana.alto}, menos de 44 px`);
    else pasa(`${etiqueta} campana`, `arriba a la derecha, ${campana.ancho}×${campana.alto}`);

    // 2. El primer aviso.
    await pagina.getByText(FRASES[0]).first().waitFor({ timeout: 20000 });
    const primeros = await emergentes(pagina);
    const primero = primeros[0];
    if (primero === undefined) fallar(`${etiqueta} emergente`, 'no salió ningún aviso arriba');
    else if (primero.y < cabecera.abajo - 1)
      fallar(
        `${etiqueta} emergente`,
        `tapa la cabecera: empieza en ${primero.y}, la cabecera acaba en ${cabecera.abajo}`,
      );
    else if (primero.y > cabecera.abajo + 40)
      fallar(`${etiqueta} emergente`, `no está arriba: empieza en ${primero.y}`);
    else if (primero.derecha > 1440 || primero.derecha < 1440 - 60)
      fallar(`${etiqueta} emergente`, `no cuelga a la derecha: acaba en ${primero.derecha}`);
    else pasa(`${etiqueta} emergente`, `«${primero.texto}» arriba a la derecha`);

    const numero = await pagina
      .locator('[data-testid="avisos-contador"]')
      .innerText()
      .catch(() => null);
    if (numero === null)
      fallar(`${etiqueta} número`, 'la campana no tiene número con avisos sin ver');
    else pasa(`${etiqueta} número`, numero);

    // 2b. Tres como mucho, y «y 1 aviso más».
    await pagina.locator('[data-testid="avisos-mas"]').waitFor({ timeout: 20000 });
    const tanda = await emergentes(pagina);
    const mas = await pagina.locator('[data-testid="avisos-mas"]').innerText();
    if (tanda.length !== 3) fallar(`${etiqueta} tanda`, `${tanda.length} avisos a la vez, no 3`);
    else if (!/y 1 aviso más/.test(mas)) fallar(`${etiqueta} tanda`, `dice «${mas}»`);
    else if (!tanda[0].texto.includes('Ele') && !tanda[0].texto.includes('Diego'))
      fallar(`${etiqueta} tanda`, `arriba no está el más nuevo: «${tanda[0].texto}»`);
    else pasa(`${etiqueta} tanda`, `3 a la vista, el más nuevo arriba, y «${mas}»`);

    // Contraste del aviso, con los tres a la vista.
    const contraste = await medirContraste(pagina, {
      minimo: 4.5,
      minimoGrande: 3,
      tamanoGrande: 24,
    });
    const enAvisos = contraste.fallos.filter(
      (f) =>
        FRASES.some((frase) => String(f.texto ?? f).includes(frase.slice(0, 10))) ||
        /aviso más|avisos más/.test(String(f.texto ?? f)),
    );
    if (enAvisos.length > 0) fallar(`${etiqueta} contraste`, JSON.stringify(enAvisos.slice(0, 2)));
    else pasa(`${etiqueta} contraste`, `${contraste.medidos} textos medidos`);

    // 3. Tocar un aviso abre la campana; están las cuatro, la más nueva arriba.
    await pagina
      .locator('[data-testid^="aviso-emergente-"]')
      .first()
      .click({ position: { x: 60, y: 20 } });
    await pagina.locator('[data-testid="avisos-panel"]').waitFor({ timeout: 5000 });
    const quedan = (await emergentes(pagina)).length;
    const filas = await pagina.locator('[data-testid^="aviso-fila-"]').allInnerTexts();
    const orden = FRASES.map((frase) => filas.findIndex((f) => f.includes(frase)));
    if (orden.some((i) => i < 0))
      fallar(`${etiqueta} campana abierta`, `faltan avisos: ${JSON.stringify(orden)}`);
    else if (!(orden[0] > orden[1] && orden[1] > orden[2] && orden[1] > orden[3]))
      fallar(
        `${etiqueta} campana abierta`,
        `no van de la más nueva a la más vieja: ${JSON.stringify(orden)}`,
      );
    else if (quedan > 0)
      fallar(`${etiqueta} campana abierta`, `quedan ${quedan} emergentes encima`);
    else
      pasa(
        `${etiqueta} campana abierta`,
        `${filas.length} marcas de hoy, las cuatro nuevas arriba`,
      );
    const nuevas = await pagina.locator('[data-testid="aviso-sin-ver"]').count();
    if (nuevas < 4) fallar(`${etiqueta} sin ver`, `solo ${nuevas} marcadas como nuevas`);

    const panel = await caja(pagina, '[data-testid="avisos-panel"]');
    if (panel.derecha > 1440 || panel.abajo > 900 || panel.y < cabecera.y)
      fallar(`${etiqueta} panel`, `se sale de la pantalla: ${JSON.stringify(panel)}`);
    else pasa(`${etiqueta} panel`, `${Math.round(panel.ancho)} px, cuelga de la campana`);

    /*
     * PEQUEÑO AUNQUE HAYA MUCHAS (6-oct). Andree: «no quiero que sea grande y se vea todo».
     * Con todas las marcas del día sembradas, el panel no pasa de ~480 px y la lista se
     * desplaza dentro; arriba dice cuántas hay y al final, dónde está el historial.
     */
    const lista = await pagina
      .locator('[data-testid="avisos-lista"]')
      .evaluate((n) => ({ alto: n.clientHeight, contenido: n.scrollHeight }));
    const subtitulo = await pagina.locator('[data-testid="avisos-subtitulo"]').innerText();
    if (panel.alto > 480)
      fallar(
        `${etiqueta} tamaño`,
        `con ${filas.length} marcas el panel mide ${Math.round(panel.alto)} px`,
      );
    else if (lista.contenido <= lista.alto)
      fallar(
        `${etiqueta} tamaño`,
        `con ${filas.length} marcas la lista no se desplaza: ¿se ven todas?`,
      );
    else if (!subtitulo.includes(`${filas.length} marcas`))
      fallar(`${etiqueta} tamaño`, `arriba no dice cuántas hay hoy: «${subtitulo}»`);
    else
      pasa(
        `${etiqueta} tamaño`,
        `${Math.round(panel.alto)} px de alto con ${filas.length} marcas; la lista se desplaza; «${subtitulo}»`,
      );
    /*
     * CON LA RUEDA, como lo haría una persona: `scrollTo` desde fuera no movía la lista de
     * react-native-web y la nota del final se «leía» sin haberse visto nunca.
     */
    const cajaLista = await caja(pagina, '[data-testid="avisos-lista"]');
    await pagina.mouse.move(cajaLista.x + cajaLista.ancho / 2, cajaLista.y + cajaLista.alto / 2);
    await pagina.mouse.wheel(0, 3000);
    await pagina.waitForTimeout(400);
    const notaVisible = await pagina.evaluate(() => {
      const nota = document
        .querySelector('[data-testid="avisos-fin-del-dia"]')
        ?.getBoundingClientRect();
      const lista = document.querySelector('[data-testid="avisos-lista"]')?.getBoundingClientRect();
      return (
        nota !== undefined &&
        lista !== undefined &&
        nota.top >= lista.top - 1 &&
        nota.bottom <= lista.bottom + 1
      );
    });
    const fin = await pagina
      .locator('[data-testid="avisos-fin-del-dia"]')
      .innerText()
      .catch(() => '');
    if (!notaVisible)
      fallar(
        `${etiqueta} historial`,
        'desplazando la lista hasta el final no se llega a ver la nota',
      );
    else if (!/cada día/.test(fin) || !/Horas/.test(fin))
      fallar(
        `${etiqueta} historial`,
        `al final de la lista no dice que se vacía cada día ni dónde está lo de antes: «${fin}»`,
      );
    else pasa(`${etiqueta} historial`, fin);

    await pagina.locator('[data-testid="avisos-cerrar"]').click();
    await pagina.waitForTimeout(400);
    if ((await pagina.locator('[data-testid="avisos-contador"]').count()) > 0)
      fallar(`${etiqueta} visto`, 'al cerrar la campana el número sigue');
    else pasa(`${etiqueta} visto`, 'al cerrar, sin número');

    // 3c. «Historial en Horas» lleva a Horas.
    if (esquema === 'light') {
      await pagina.locator('[data-testid="avisos-campana"]').click();
      await pagina.locator('[data-testid="avisos-historial"]').click();
      const llego = await esperarPantalla(pagina, MARCADORES['/hours'], {
        asentar: 300,
        obligatorio: false,
      });
      const cerrado = (await pagina.locator('[data-testid="avisos-panel"]').count()) === 0;
      if (!llego || !cerrado)
        fallar(
          'historial',
          `«Historial en Horas» ${llego ? 'no cerró la campana' : 'no llevó a Horas'}`,
        );
      else pasa('historial', '«Historial en Horas» cierra la campana y abre Horas');
    }

    // 4. En todas las vistas del panel.
    if (esquema === 'light') {
      const sinCampana = [];
      for (const ruta of [
        '/team',
        '/availability',
        '/schedule',
        '/hours',
        '/reports',
        '/requests',
        '/settings',
        '/ayuda',
      ]) {
        await pagina.locator(`a[href$="${ruta}"]`).first().click();
        await esperarPantalla(pagina, MARCADORES[ruta], { asentar: 300 });
        if ((await pagina.locator('[data-testid="avisos-campana"]').count()) !== 1)
          sinCampana.push(ruta);
      }
      if (sinCampana.length > 0)
        fallar('todas las vistas', `sin campana en ${sinCampana.join(', ')}`);
      else
        pasa(
          'todas las vistas',
          'Equipo, Disponibilidad, Horario, Horas, Reportes, Bandeja, Ajustes y Manual',
        );
    }

    if (errores.length > 0) fallar(`${etiqueta} errores`, errores.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* --------------------------------------------------------------- 5. el teléfono */
  for (const [ancho, esquema] of [
    [390, 'light'],
    [390, 'dark'],
    [320, 'light'],
  ]) {
    const etiqueta = `${ancho}px ${esquema}`;
    const { ctx, pagina, errores } = await abrirPanel(ancho, esquema);
    const campana = await caja(pagina, '[data-testid="avisos-campana"]');
    if (campana.ancho < 44 || campana.alto < 44 || campana.derecha > ancho)
      fallar(
        `${etiqueta} campana`,
        `${campana.ancho}×${campana.alto}, acaba en ${campana.derecha}`,
      );
    else pasa(`${etiqueta} campana`, `${campana.ancho}×${campana.alto} a la derecha`);
    if (ancho >= 375) {
      const corte = await pagina
        .locator('[data-testid="scope-open"]')
        .evaluate((nodo) =>
          [...nodo.querySelectorAll('div[dir="auto"]')].some(
            (t) => t.scrollWidth > t.clientWidth + 1,
          ),
        );
      if (corte) fallar(`${etiqueta} cabecera`, 'con la campana, la empresa o la sede se cortan');
      else pasa(`${etiqueta} cabecera`, 'empresa y sede enteras junto a la campana');
    }

    await pagina.getByText(FRASES[0]).first().waitFor({ timeout: 20000 });
    const cabecera = await caja(pagina, '[data-testid="desktop-header"]');
    const [aviso] = await emergentes(pagina);
    if (aviso === undefined) fallar(`${etiqueta} emergente`, 'no salió');
    else if (aviso.x < 4 || aviso.derecha > ancho - 4 || aviso.x > 16)
      fallar(`${etiqueta} emergente`, `no va de borde a borde: ${aviso.x} a ${aviso.derecha}`);
    else if (aviso.y < cabecera.abajo - 1 || aviso.y > cabecera.abajo + 30)
      fallar(`${etiqueta} emergente`, `no está debajo de la cabecera: ${aviso.y}`);
    else
      pasa(
        `${etiqueta} emergente`,
        `de ${Math.round(aviso.x)} a ${Math.round(aviso.derecha)} px, arriba`,
      );
    const arrastre = await desborde(pagina);
    if (arrastre > 1)
      fallar(`${etiqueta} desborde`, `la página se sale ${arrastre} px con el aviso`);

    await pagina.locator('[data-testid="avisos-campana"]').click();
    await pagina.locator('[data-testid="avisos-panel"]').waitFor({ timeout: 5000 });
    await pagina.waitForTimeout(300);
    const panel = await caja(pagina, '[data-testid="avisos-panel"]');
    const pie = await pagina.evaluate(() =>
      ['avisos-interruptor', 'avisos-historial'].map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return r === undefined ? null : { izquierda: r.left, derecha: r.right, abajo: r.bottom };
      }),
    );
    const pieFuera = pie.some(
      (r) =>
        r === null ||
        r.izquierda < panel.x - 1 ||
        r.derecha > panel.derecha + 1 ||
        r.abajo > panel.abajo + 1,
    );
    if (panel.x < 0 || panel.derecha > ancho || panel.abajo > 900)
      fallar(`${etiqueta} panel`, `se sale: ${JSON.stringify(panel)}`);
    else if (pieFuera)
      fallar(`${etiqueta} panel`, `el pie no cabe en el panel: ${JSON.stringify(pie)}`);
    else
      pasa(
        `${etiqueta} panel`,
        `de ${Math.round(panel.x)} a ${Math.round(panel.derecha)} px, ${Math.round(panel.alto)} de alto, pie dentro`,
      );
    if (esquema === 'dark' || ancho === 320) {
      const contraste = await medirContraste(pagina, {
        minimo: 4.5,
        minimoGrande: 3,
        tamanoGrande: 24,
      });
      const enPanel = contraste.fallos.filter((f) =>
        /marcó|salió|volvió|Avisos|Aviso arriba|Historial|Hoy en|cada día/.test(
          String(f.texto ?? f),
        ),
      );
      if (enPanel.length > 0) fallar(`${etiqueta} contraste`, JSON.stringify(enPanel.slice(0, 2)));
      else
        pasa(`${etiqueta} contraste`, `${contraste.medidos} textos medidos con la campana abierta`);
    }
    if (errores.length > 0) fallar(`${etiqueta} errores`, errores.slice(0, 3).join(' | '));
    await ctx.close();
  }

  /* ------------------------------------- 3b y 6. lo visto se recuerda; el emergente se apaga */
  {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const { pagina } = await abrirPanel(1280, 'light', { escenario: 'normal', contexto: ctx });
    // Con el día sembrado hay marcas de hoy: se abren, se cierran, y se apaga el emergente.
    await pagina.locator('[data-testid="avisos-contador"]').waitFor({ timeout: 10000 });
    const antes = await pagina.locator('[data-testid="avisos-contador"]').innerText();
    await pagina.locator('[data-testid="avisos-campana"]').click();
    await pagina.locator('[data-testid="avisos-panel"]').waitFor({ timeout: 5000 });
    await pagina.locator('[data-testid="avisos-interruptor"]').click();
    await pagina.locator('[data-testid="avisos-cerrar"]').click();
    await pagina.close();

    /*
     * AL RECARGAR, COMO MUCHO 1, no 0, y es de la demostración, no de la app: la semilla se
     * calcula con la hora de CADA carga, así que la marca más nueva del día renace unos
     * segundos después de la que se vio. En la tienda las marcas no se mueven.
     */
    const { pagina: otra } = await abrirPanel(1280, 'light', { contexto: ctx, yaDentro: true });
    await otra.waitForTimeout(1500);
    const leer = async () =>
      (await otra.locator('[data-testid="avisos-contador"]').count()) === 0
        ? 0
        : Number.parseInt(await otra.locator('[data-testid="avisos-contador"]').innerText(), 10);
    const alEntrar = await leer();
    if (alEntrar > 1) fallar('recordado', `antes ${antes}; al recargar, ${alEntrar} sin ver`);
    else pasa('recordado', `antes ${antes}; al recargar, ${alEntrar}: lo visto no vuelve`);

    // Llegan las cuatro del escenario: sube el número y no sale nada arriba.
    await otra.waitForTimeout(10000);
    const arriba = (await emergentes(otra)).length;
    const despues = await leer();
    if (arriba > 0)
      fallar('emergente apagado', `con el emergente apagado salieron ${arriba} avisos`);
    else if (despues !== alEntrar + 4)
      fallar('emergente apagado', `el número pasó de ${alEntrar} a ${despues}, no sumó 4`);
    else pasa('emergente apagado', `llegaron 4 marcas: el número sube a ${despues} y nada arriba`);
    await ctx.close();
  }

  /* -------------------------------------------- 7. solo quien gestiona tiene campana */
  {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    const pagina = await ctx.newPage();
    await pagina.goto(`${base}/?escenario=avisos`, { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
    await pagina.locator('[data-testid="sign-in-demo-vendedor"]').click();
    await pagina.locator('[data-testid="mi-horario"]').first().waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(9000);
    const enCelular = await pagina
      .locator('[data-testid="avisos-campana"], [data-testid^="aviso-emergente-"]')
      .count();
    if (enCelular > 0) fallar('celular', 'el celular de la vendedora tiene avisos del panel');
    else pasa('celular', 'la vendedora no ve campana ni avisos');

    await pagina.goto(`${base}/kiosk`, { waitUntil: 'networkidle' });
    await pagina.locator('[data-testid="kiosk-not-set-up"]').first().waitFor({ timeout: 20000 });
    if ((await pagina.locator('[data-testid="avisos-campana"]').count()) > 0)
      fallar('reloj', 'el reloj tiene campana');
    else pasa('reloj', 'el reloj no tiene campana');
    await ctx.close();
  }
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.log(`\n${problemas.length} problema(s):`);
  for (const problema of problemas) console.log(`  - ${problema}`);
  process.exit(1);
}
console.log('\navisos-check: todo en orden.');
