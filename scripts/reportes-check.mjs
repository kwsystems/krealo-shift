/**
 * Reportes: ¿dice lo mismo que Horas, y cabe la sexta pestaña?
 *
 * Son las dos cosas que este módulo podía romper y que ninguna prueba unitaria ve.
 *
 * 1. QUE LOS NÚMEROS CUADREN CON HORAS. Es la promesa entera del módulo. Las pruebas
 *    unitarias ya comparan las funciones de agregación con `computeTotals`, pero eso
 *    compara CUENTAS, no PANTALLAS: entre la cuenta y lo que se lee hay un filtro de
 *    semana, una zona horaria, una sede elegida y un formateo. Este arnés abre las dos
 *    pestañas en el mismo navegador y en la misma semana y exige el mismo texto. Si
 *    una de las dos miente sobre las horas de gente real, esto lo dice.
 *
 * 2. QUE LAS SEIS ETIQUETAS QUEPAN A 390 px. Añadir Reportes subió la barra de cinco
 *    pestañas a seis. En un iPhone estrecho, la sexta es justo la que hace que las
 *    etiquetas se corten a media palabra. Se mide el DOM —`scrollWidth` contra
 *    `clientWidth` de cada etiqueta—, no se mira una captura: un corte de dos píxeles
 *    no se ve en una captura y sí se ve en el teléfono de quien la usa.
 *
 * 3. QUE LOS GRÁFICOS TENGAN BARRAS. Un gráfico sin marcas no lanza ningún error: es
 *    una tarjeta con un título. Se cuentan las barras y se mide que la más larga sea
 *    más larga que la más corta, que es lo que distingue un gráfico de una lista.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/reportes-check.mjs dist-demo
 */
import { servirExport, cargarPlaywright } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/reportes-check.mjs <export-demo>');
  process.exit(2);
}

/** Etiquetas de las seis pestañas, en el orden en que las pinta el layout. */
const PESTANAS = ['Inicio', 'Equipo', 'Horario', 'Horas', 'Reportes', 'Más'];

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8125);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1500);
  const boton = pagina.locator('[data-testid="sign-in-demo"]');
  if ((await boton.count()) === 0)
    throw new Error('no aparece el botón de entrar en la demostración');
  await boton.click();
  await pagina.waitForTimeout(2500);
}

/** El texto de una casilla de total, tal y como lo lee una persona. */
async function leerCasilla(pagina, testId) {
  const casilla = pagina.locator(`[data-testid="${testId}"]`);
  if ((await casilla.count()) === 0) return null;
  return ((await casilla.first().innerText()) || '').replace(/\s+/g, ' ').trim();
}

/** El número HH:MM de una casilla, sin su etiqueta. */
function soloHoras(texto) {
  const encontrado = /(\d{1,4}:\d{2})/.exec(texto ?? '');
  return encontrado?.[1] ?? null;
}

// ------------------------------------------------- 1. Reportes contra Horas
{
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await entrar(pagina);

  await pagina.goto(base + '/hours', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2500);
  const horasNeto = soloHoras(await leerCasilla(pagina, 'total-net'));
  const horasExtra = soloHoras(await leerCasilla(pagina, 'total-overtime'));

  await pagina.goto(base + '/reports', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2500);
  const reporteNeto = soloHoras(await leerCasilla(pagina, 'report-total'));
  const reporteExtra = soloHoras(await leerCasilla(pagina, 'report-overtime'));

  console.log(`  Horas    neto ${horasNeto}  extra ${horasExtra}`);
  console.log(`  Reportes neto ${reporteNeto}  extra ${reporteExtra}`);

  if (horasNeto === null || reporteNeto === null) {
    problemas.push(`no se pudo leer el total neto (Horas ${horasNeto}, Reportes ${reporteNeto})`);
  } else if (horasNeto !== reporteNeto) {
    problemas.push(
      `las dos pantallas NO cuadran en horas netas: Horas dice ${horasNeto} y Reportes ${reporteNeto}. Una de las dos miente.`,
    );
  }
  if (horasExtra !== reporteExtra) {
    problemas.push(
      `las dos pantallas NO cuadran en horas extra: Horas dice ${horasExtra} y Reportes ${reporteExtra}.`,
    );
  }

  // ------------------------------------------ 3. los gráficos tienen marcas
  /*
   * Se mide la dimensión QUE VARÍA en cada forma, y esto no es un detalle: la primera
   * versión medía el ancho en las tres. En las columnas de la semana el ancho es fijo
   * por diseño —24 px de grosor de marca— así que salían «todas iguales» y el arnés
   * denunciaba un fallo que no existía mientras dejaba sin mirar el alto, que es donde
   * ahí vive el dato. Un arnés que mide lo que no varía no comprueba nada.
   */
  for (const [nombre, testId, eje] of [
    ['quién más horas', 'ranking-hours', 'width'],
    ['motivos de pausa', 'ranking-reasons', 'width'],
    // Dos series apiladas. Solo sale si hay horas extra de verdad en los datos, y por
    // eso la demostración tiene a alguien que cierra la tienda: comprobar el estado
    // vacío de este gráfico no comprueba el gráfico.
    ['horas extra', 'ranking-overtime', 'width'],
    ['semana por días', 'week-columns', 'height'],
  ]) {
    const tarjeta = pagina.locator(`[data-testid="${testId}"]`);
    if ((await tarjeta.count()) === 0) {
      problemas.push(`el gráfico «${nombre}» no se pintó`);
      continue;
    }
    const medidas = await tarjeta.first().evaluate((raiz, cual) => {
      // Una marca es un div de color SIN hijos: las barras y las columnas son hojas.
      // Los contenedores también tienen fondo a veces, y contarlos falsearía la cuenta.
      return (
        [...raiz.querySelectorAll('div')]
          .filter((el) => {
            const fondo = getComputedStyle(el).backgroundColor;
            const caja = el.getBoundingClientRect();
            return (
              fondo !== 'rgba(0, 0, 0, 0)' &&
              fondo !== 'transparent' &&
              caja.width >= 1 &&
              caja.height >= 1 &&
              el.children.length === 0
            );
          })
          .map((el) => {
            const caja = el.getBoundingClientRect();
            return Math.round(cual === 'width' ? caja.width : caja.height);
          })
          // La línea base y la rejilla miden 1 px: son cromo, no dato.
          .filter((medida) => medida > 1)
      );
    }, eje);
    const marcas = medidas;
    if (marcas.length < 2) {
      problemas.push(`el gráfico «${nombre}» tiene ${marcas.length} marcas: no compara nada`);
    } else if (Math.max(...marcas) === Math.min(...marcas)) {
      problemas.push(
        `el gráfico «${nombre}»: todas las marcas miden lo mismo (${marcas[0]}px). La escala no se está aplicando.`,
      );
    }
    console.log(
      `  ${nombre.padEnd(18)} ${marcas.length} marcas, ${eje} de ${Math.min(...marcas)} a ${Math.max(...marcas)} px`,
    );
  }

  if (errores.length > 0) problemas.push(`Reportes lanzó: ${errores[0]}`);
  await contexto.close();
}

// ------------------------------------- 2. las seis pestañas en un teléfono
{
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2000);

  for (const etiqueta of PESTANAS) {
    const nodo = pagina.getByText(etiqueta, { exact: true }).last();
    if ((await nodo.count()) === 0) {
      problemas.push(`la pestaña «${etiqueta}» no aparece en la barra a 390 px`);
      continue;
    }
    const medida = await nodo.evaluate((el) => ({
      scroll: el.scrollWidth,
      cliente: el.clientWidth,
      texto: el.textContent,
    }));
    // Un solo píxel de diferencia YA es una palabra cortada con puntos suspensivos.
    const cortada = medida.scroll > medida.cliente;
    if (cortada) {
      problemas.push(
        `la etiqueta «${etiqueta}» se corta a 390 px: necesita ${medida.scroll}px y tiene ${medida.cliente}px`,
      );
    }
    console.log(
      `  pestaña ${etiqueta.padEnd(9)} ${medida.cliente}px de ${medida.scroll}px  ${cortada ? 'CORTADA' : 'ok'}`,
    );
  }

  /*
   * Las etiquetas del eje de días, con la MISMA medida que las pestañas.
   *
   * La primera versión de este arnés solo miraba la barra de pestañas, y en la captura
   * del teléfono se veía «mar…», «mié…», «do…»: siete etiquetas «lun 14» no caben en
   * 390 px. Lo vio el ojo y no el arnés, así que el arnés estaba incompleto: un corte
   * es un corte esté donde esté, y aquí hay siete oportunidades de que ocurra.
   */
  await pagina.goto(base + '/reports', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(3000);
  const ejes = await pagina
    .locator('[data-testid="week-columns"]')
    .first()
    .evaluate((raiz) =>
      [...raiz.querySelectorAll('div')]
        .map((el) => el.firstElementChild)
        .filter((hijo) => hijo !== null && hijo.tagName === 'DIV' && hijo.children.length === 0)
        .map((hijo) => ({
          texto: (hijo.textContent ?? '').trim(),
          scroll: hijo.scrollWidth,
          cliente: hijo.clientWidth,
        }))
        .filter((medida) => medida.texto.length > 0 && !medida.texto.includes(':')),
    );
  for (const eje of ejes) {
    if (eje.scroll > eje.cliente) {
      problemas.push(
        `la etiqueta de día «${eje.texto}» se corta a 390 px: necesita ${eje.scroll}px y tiene ${eje.cliente}px`,
      );
    }
  }
  console.log(
    `  eje de días  ${ejes.length} etiquetas: ${ejes.map((e) => e.texto).join(' ')}  ${
      ejes.some((e) => e.scroll > e.cliente) ? 'ALGUNA CORTADA' : 'ok'
    }`,
  );
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(2000);

  // Y que se pueda llegar a Reportes tocándola, no solo escribiendo la URL.
  await pagina.getByText('Reportes', { exact: true }).last().click();
  await pagina.waitForTimeout(2500);
  if ((await pagina.locator('[data-testid="manager-reports"]').count()) === 0) {
    problemas.push('tocar la pestaña Reportes no lleva a Reportes');
  }
  await contexto.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA la comprobación de Reportes:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  '\nOK: Reportes cuadra con Horas, los gráficos tienen escala y las seis pestañas caben.',
);
