/**
 * ¿SE QUEDA ABIERTA LA SECCIÓN EN LA QUE ESTÁS TRABAJANDO?
 *
 * POR QUÉ EXISTE. En Ajustes, el selector de sede vive DENTRO de la tarjeta de
 * Ubicaciones. Esa tarjeta se monta con `key={location.id}` a propósito —al cambiar de
 * sede hay que rellenar sus once campos con los de la sede nueva, no arrastrar los de la
 * anterior— y el efecto secundario era que usar el selector DESMONTABA la tarjeta y
 * volvía cerrada. Configurar dos tiendas obligaba a reabrir la sección para cada una.
 *
 * Lo que fallaba no era la `key`: era de quién es cada estado. El del formulario es de la
 * sede y muere con ella; el de «está abierta» es de la pantalla y no tiene nada que ver
 * con qué sede miras.
 *
 * Y NO SE PODÍA CAZAR CON UNA PRUEBA UNITARIA. El desmontaje depende de dónde está la
 * `key` en el árbol real; un test que monte la tarjeta sola no reproduce el remontaje, y
 * uno que lo simule prueba la simulación. Hace falta el navegador, la pantalla entera y
 * un clic de verdad.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/plegables-check.mjs dist-demo
 */
import {
  servirExport,
  cargarPlaywright,
  esperarPantalla,
  sinGlifos,
  MARCADORES,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/plegables-check.mjs <export-demo>');
  process.exit(2);
}

const { base, cerrar } = await servirExport(DIR, 8281);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const problemas = [];

for (const [nombre, ancho, alto] of [
  ['portátil', 1280, 800],
  ['teléfono', 390, 844],
]) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const pagina = await ctx.newPage();
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
  await pagina.goto(base + '/settings', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADORES['/settings'], { asentar: 500 });

  const cabecera = pagina.locator('[data-testid="location-card-toggle"]');
  if ((await cabecera.count()) === 0) {
    problemas.push(`${nombre}: no encontré la cabecera de Ubicaciones`);
    await ctx.close();
    continue;
  }

  /*
   * SE MIDEN LAS DOS COSAS, y la segunda no es redundante: `aria-expanded` dice lo que la
   * app AFIRMA, y la visibilidad del cuerpo dice lo que de verdad ve quien mira. La
   * primera version de este arnés solo leía el atributo, y con eso reportó que la tarjeta
   * «no se abría» cuando sí se abría: el atributo no llegaba al DOM (react-native-web no
   * traduce `expanded`). Medir solo la afirmación habría mandado a arreglar lo que no
   * estaba roto; medir solo la vista habría dejado el atributo muerto sin que nadie lo
   * notara. Las dos, y tienen que coincidir.
   */
  const contenido = pagina.locator('[data-testid^="location-pick-"]').first();
  const desplegada = async () => {
    const afirma = (await cabecera.first().getAttribute('aria-expanded')) === 'true';
    const seVe = await contenido.isVisible().catch(() => false);
    if (afirma !== seVe) {
      problemas.push(
        `${nombre}: la cabecera dice aria-expanded=${afirma} y el contenido ` +
          `${seVe ? 'SÍ' : 'NO'} se ve. Una de las dos miente.`,
      );
    }
    return seVe;
  };

  if (await desplegada()) {
    problemas.push(`${nombre}: la tarjeta ya venía abierta, así que la prueba no medía nada`);
    await ctx.close();
    continue;
  }
  await cabecera.first().click();
  await pagina.waitForTimeout(300);
  if (!(await desplegada())) {
    problemas.push(`${nombre}: la tarjeta no se abrió al pulsar su cabecera`);
    await ctx.close();
    continue;
  }

  /*
   * EL CLIC QUE IMPORTA: cambiar de sede desde el selector que vive DENTRO de la tarjeta.
   *
   * Y HAY QUE ELEGIR LA SEDE QUE NO ESTA PUESTA, o esto no prueba nada: volver a pulsar la
   * actual no remonta la tarjeta y el arnes pasaria en verde sin haber cambiado de sede.
   * Me paso: la primera version leia `aria-selected` para saber cual estaba puesta, ese
   * atributo vale `null` —react-native-web no lo emite sobre un boton, donde ademas no
   * seria valido— asi que el bucle pulsaba siempre la primera, que era la ya seleccionada.
   * El arnes decia OK con el fallo dentro.
   *
   * Asi que no se pregunta al atributo: se lee el NOMBRE que la cabecera muestra, se pulsa
   * una sede distinta de ese, y se COMPRUEBA que el nombre de la cabecera cambio. Si no
   * cambio, no hubo cambio de sede y no se ha medido nada.
   */
  const nombreEnCabecera = async () => sinGlifos(await cabecera.first().textContent());
  const antes = await nombreEnCabecera();

  const opciones = pagina.locator('[data-testid^="location-pick-"]');
  const cuantas = await opciones.count();
  if (cuantas < 2) {
    problemas.push(`${nombre}: hacen falta 2 sedes para probar esto y hay ${cuantas}`);
    await ctx.close();
    continue;
  }
  let pulsada = false;
  for (let i = 0; i < cuantas; i += 1) {
    const opcion = opciones.nth(i);
    const etiqueta = sinGlifos(await opcion.textContent());
    if (etiqueta === '' || antes.includes(etiqueta)) continue;
    await opcion.click();
    pulsada = true;
    break;
  }
  if (!pulsada) {
    problemas.push(`${nombre}: no encontre una sede distinta de la puesta que pulsar`);
    await ctx.close();
    continue;
  }
  await pagina.waitForTimeout(800);

  const despues = await nombreEnCabecera();
  if (despues === antes) {
    problemas.push(
      `${nombre}: la cabecera sigue diciendo lo mismo tras pulsar otra sede, asi que NO ` +
        'se cambio de sede y esta prueba no ha medido nada',
    );
    await ctx.close();
    continue;
  }

  if (!(await desplegada())) {
    problemas.push(
      `${nombre}: al cambiar de sede la tarjeta de Ubicaciones SE CERRÓ, así que hay que ` +
        'volver a abrirla para configurar la otra tienda',
    );
  } else {
    console.log(`  ${String(ancho).padStart(4)} Ubicaciones: sigue abierta tras cambiar de sede`);
  }
  await ctx.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nSE CIERRA LO QUE NO DEBERÍA:');
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK: cambiar de sede no cierra la sección en la que estás trabajando.');
