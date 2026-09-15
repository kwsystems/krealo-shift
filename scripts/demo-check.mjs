/**
 * ¿Se puede recorrer la app entera en un navegador, sin backend?
 *
 * Esto NO comprueba "que no haya errores en consola". Comprueba dos cosas que un
 * error nunca denuncia:
 *
 *   1. QUE CADA PANTALLA TENGA CONTENIDO. Una pantalla en blanco no lanza nada. La
 *      app entera se quedó una vez en «falta un permiso» —las cinco pestañas— porque
 *      a una fila de la semilla le faltaba una columna por la que la consulta filtra.
 *      Cero errores en consola, cero pantallas útiles.
 *
 *   2. QUE LAS PANTALLAS SEAN DISTINTAS ENTRE SÍ. Esta mitad existe por un fallo
 *      concreto: al dar el dispositivo por activado como kiosco, el arranque decidía
 *      por `isKioskDevice` antes que por el rol y las cinco rutas del panel
 *      redirigían a /kiosk. Las seis pantallas tenían contenido —el mismo— y la
 *      comprobación de arriba pasaba tan contenta. Sin esta segunda mitad, el panel
 *      administrativo era inalcanzable y el arnés decía que todo estaba bien.
 *
 * Uso:
 *   EXPO_PUBLIC_DEMO=1 npx expo export --platform web --output-dir <dir>
 *   node scripts/demo-check.mjs <dir>
 */
import { existsSync } from 'node:fs';

import { servirExport, cargarPlaywright } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
/** Opcional: un segundo export compilado con EXPO_PUBLIC_APP_ENV=production. */
const DIR_PROD = process.argv[3];
if (DIR === undefined) {
  console.error('Uso: node scripts/demo-check.mjs <export-demo> [export-produccion]');
  process.exit(2);
}

const RUTAS = [
  ['inicio', '/'],
  ['equipo', '/team'],
  ['horario', '/schedule'],
  ['horas', '/hours'],
  ['reportes', '/reports'],
  ['mas', '/more'],
  ['kiosco', '/kiosk'],
];

/** Un texto por debajo de esto es una pantalla que no dice nada. */
const MINIMO_CARACTERES = 120;

const { base, cerrar } = await servirExport(DIR, 8123);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const pagina = await contexto.newPage();

const problemas = [];
const vistas = new Map();

/**
 * Entra por la pantalla de acceso, como lo haria una persona.
 *
 * La demostracion ya NO entra sola: arranca en el login, porque antes esa pantalla no
 * se veia nunca y era justo lo que Andree echaba en falta. El arnes tiene que hacer lo
 * mismo que un humano, y de paso comprueba que el boton de entrar funciona: si dejara
 * de funcionar, las seis rutas mostrarian el login y este arnes lo cantaria por su
 * comprobacion de "todas distintas".
 */
async function entrarComoAdministrador(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1500);
  const boton = pagina.locator('[data-testid="sign-in-demo"]');
  if ((await boton.count()) === 0) {
    problemas.push('no aparece el boton de entrar como administrador en la demostracion');
    return;
  }
  await boton.click();
  await pagina.waitForTimeout(2500);
}

await entrarComoAdministrador(pagina);

for (const [nombre, ruta] of RUTAS) {
  const errores = [];
  pagina.removeAllListeners('pageerror');
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));

  await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2200);

  const texto = ((await pagina.evaluate(() => document.body.innerText)) || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (texto.length < MINIMO_CARACTERES) {
    problemas.push(`${nombre} (${ruta}): pantalla casi vacía, ${texto.length} caracteres`);
  }

  const gemela = vistas.get(texto);
  if (gemela !== undefined) {
    problemas.push(
      `${nombre} (${ruta}): muestra EXACTAMENTE lo mismo que ${gemela}. ` +
        'Una redirección se está comiendo la ruta.',
    );
  } else {
    vistas.set(texto, `${nombre} (${ruta})`);
  }

  if (errores.length > 0) problemas.push(`${nombre} (${ruta}): ${errores[0]}`);

  console.log(`  ${nombre.padEnd(9)} ${String(texto.length).padStart(5)} car.  ${ruta}`);
}

/*
 * En un build de PRODUCCIÓN web, el kiosco explica su límite en vez de reventar.
 *
 * Esta comprobación existe por el fallo más caro que ha tenido este proyecto en web:
 * `secure-storage.ts` lanzaba en cualquier acceso dentro de un build web de
 * producción, y como el arranque lee la credencial del kiosco para saber si el
 * dispositivo es un reloj, publicar la web servía UNA PÁGINA EN BLANCO. El panel
 * entero, inalcanzable. En desarrollo no pasaba nada, así que ningún arnés anterior lo
 * veía: la diferencia estaba justo en la variable que solo vale en el build publicado.
 *
 * Se intentó cubrirlo con una prueba unitaria y no salió: el módulo elige el almacén
 * al cargarse, así que un `beforeAll` llegaba tarde y la prueba acababa ejercitando el
 * almacén nativo mientras decía hablar de web —pasaba en verde sin comprobar nada—, y
 * rehacer el registro de módulos para adelantarse rompe la inicialización de
 * jest-expo. Esto se comprueba abriendo el build publicado, que además es como se
 * encontró.
 *
 * Solo corre si se le pasa un segundo directorio con el build de producción.
 */
if (DIR_PROD !== undefined) {
  if (!existsSync(DIR_PROD)) {
    console.error(`No existe "${DIR_PROD}". Compílalo antes con: npm run demo:export:prod`);
    process.exit(2);
  }
  const { base: baseProd, cerrar: cerrarProd } = await servirExport(DIR_PROD, 8124);
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pag = await ctx.newPage();
  const erroresProd = [];
  pag.on('pageerror', (e) => erroresProd.push(String(e).slice(0, 200)));

  /*
   * Tambien se entra aqui. Que la pantalla de acceso pinte ya demuestra que el build
   * publicado ARRANCA —que es el fallo que esta comprobacion vino a cazar—, pero
   * quedarse ahi dejaria el panel sin comprobar en el unico build que se publica.
   */
  {
    const url = baseProd + '/';
    await pag.goto(url, { waitUntil: 'networkidle' });
    await pag.waitForTimeout(1500);
    const boton = pag.locator('[data-testid="sign-in-demo"]');
    if ((await boton.count()) > 0) {
      await boton.click();
      await pag.waitForTimeout(2500);
    }
  }

  for (const [ruta, debeDecir] of [
    ['/', null],
    ['/kiosk', 'kiosk-unavailable-here'],
    ['/kiosk/setup', 'kiosk-unavailable-here'],
  ]) {
    await pag.goto(baseProd + ruta, { waitUntil: 'networkidle' });
    await pag.waitForTimeout(2200);
    const texto = ((await pag.evaluate(() => document.body.innerText)) || '').trim();

    if (texto.length < MINIMO_CARACTERES) {
      problemas.push(`producción ${ruta}: pantalla en blanco (${texto.length} caracteres)`);
    }
    if (debeDecir !== null) {
      const hay = (await pag.locator(`[data-testid="${debeDecir}"]`).count()) > 0;
      if (!hay) problemas.push(`producción ${ruta}: falta la explicación del kiosco`);
    }
    console.log(`  producción ${ruta.padEnd(13)} ${String(texto.length).padStart(5)} car.`);
  }

  if (erroresProd.length > 0) problemas.push(`producción: ${erroresProd[0]}`);
  await ctx.close();
  await cerrarProd();
}

/*
 * La cabecera de escritorio aparece en ancho y NO en teléfono.
 *
 * Las dos mitades importan. Que aparezca es lo que da identidad al panel en un
 * monitor; que NO aparezca en teléfono es lo que impide que robe alto de pantalla
 * donde el alto es el recurso escaso. Un `useSidebar` mal puesto rompe una de las dos
 * sin romper ninguna pantalla, así que nada más lo notaría.
 */
for (const [etiqueta, ancho, esperada] of [
  ['teléfono', 390, false],
  ['escritorio', 1440, true],
]) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: 900 } });
  const pag = await ctx.newPage();
  await entrarComoAdministrador(pag);
  await pag.goto(base + '/', { waitUntil: 'networkidle' });
  await pag.waitForTimeout(1800);
  const hay = (await pag.locator('[data-testid="desktop-header"]').count()) > 0;
  if (hay !== esperada) {
    problemas.push(
      `cabecera en ${etiqueta} (${ancho}px): ${hay ? 'aparece y no debería' : 'no aparece y debería'}`,
    );
  }
  console.log(
    `  cabecera  ${etiqueta.padEnd(11)} ${hay ? 'sí' : 'no'}  (se espera ${esperada ? 'sí' : 'no'})`,
  );
  await ctx.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA el recorrido de la demostración:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(`\nOK: ${RUTAS.length} pantallas con contenido y todas distintas entre sí.`);
