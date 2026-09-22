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
import { readFileSync } from 'node:fs';

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
  console.error('Uso: node scripts/reportes-check.mjs <export-demo>');
  process.exit(2);
}

/**
 * Etiquetas de las SIETE pestañas, en el orden en que las pinta el layout.
 *
 * Eran seis con «Más»; al partirlo en Bandeja y Ajustes son siete, y en un teléfono
 * de 390 px tocan a ~55 px cada una. El layout encoge la etiqueta a 10 px justo por
 * eso, y esta lista es lo que comprueba que ninguna se corta. Si alguien añade una
 * octava, esto es lo que se lo va a decir.
 */
const PESTANAS = ['Inicio', 'Equipo', 'Horario', 'Horas', 'Reportes', 'Bandeja', 'Ajustes'];

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8125);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

// Todas las esperas de navegación son POR LA PANTALLA y no por el reloj: los números
// fijos que había —entre 1.500 y 3.000 ms— estaban afinados en una máquina, y en un
// runner compartido más lento se quedan cortos y el arnés lee una pantalla a medio
// montar: totales a cero, gráficos sin barras. Ver `irA` y `esperarPantalla`.
async function entrar(pagina) {
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 0 });
  const boton = pagina.locator('[data-testid="sign-in-demo"]');
  if ((await boton.count()) === 0)
    throw new Error('no aparece el botón de entrar en la demostración');
  await boton.click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
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
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await entrar(pagina);

  await irA(pagina, base, '/hours', { asentar: 600 });
  const horasNeto = soloHoras(await leerCasilla(pagina, 'total-net'));
  const horasExtra = soloHoras(await leerCasilla(pagina, 'total-overtime'));

  await irA(pagina, base, '/reports', { asentar: 600 });
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
  /*
   * SE MIDE LA SEMANA ANTERIOR, no la actual, y no es por comodidad.
   *
   * La actual depende del día: un lunes tiene un solo día de datos, así que «semana
   * por días» tiene una columna, nadie ha hecho horas extra y no hay pausas que
   * repartir por motivo. Los tres gráficos salían «vacíos» y el arnés acusaba a la app
   * de un fallo que era del calendario. Se vio el lunes 2026-09-21.
   *
   * Lo que este bloque comprueba es que LOS GRÁFICOS TIENEN ESCALA —que pintan marcas
   * y que no miden todas lo mismo—, y eso es una propiedad del código del gráfico, no
   * de la semana. Cualquier semana con datos lo demuestra, y la anterior siempre los
   * tiene: la semilla la siembra entera. De paso, es el único sitio que pulsa
   * «Semana anterior», que antes no ejercitaba nadie.
   *
   * El bloque 1 (Reportes contra Horas) se queda en la semana actual a propósito: ahí
   * lo que importa es que las DOS pantallas digan lo mismo, y las dos abren en hoy.
   */
  await pagina.locator('[data-testid="week-previous"]').click();
  await pagina.waitForTimeout(2000);

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

  /*
   * ----------------------------------------- 4. lo que se comparte es lo que se ve
   *
   * Un botón de compartir que no descarga nada no lanza ningún error: la hoja se abre,
   * se toca, y no pasa nada. Y en la web eso era literalmente el caso —`expo-sharing`
   * no existe en un navegador— así que «Exportar CSV» en Horas llevaba roto desde que
   * la web pasó a ser la forma principal de usar la app.
   *
   * No basta con que descargue: se SUMA la columna decimal del CSV y se exige que dé
   * el mismo total que la pantalla. Así se cubre de una vez que el archivo llega, que
   * no va vacío, que el decimal de nómina no está escrito como el reloj (1.30 en vez
   * de 1.50) y que lo exportado es el mismo periodo que lo mirado.
   */
  await pagina.locator('[data-testid="report-share-open"]').click();
  await pagina.waitForTimeout(900);

  const queSeComparte = (
    (await pagina.locator('[data-testid="report-share-what"]').innerText()) || ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\d/.test(queSeComparte)) {
    problemas.push('la hoja de compartir no dice cuántas personas ni de qué periodo');
  }
  console.log(`  compartir dice: ${queSeComparte}`);

  const esperaCsv = pagina.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await pagina.locator('[data-testid="report-share-csv"]').click();
  const bajada = await esperaCsv;

  if (bajada === null) {
    problemas.push('compartir el CSV no descargó ningún archivo en el navegador');
  } else {
    const ruta = '/tmp/krealo-reporte-check.csv';
    await bajada.saveAs(ruta);
    const texto = readFileSync(ruta, 'utf8');
    const lineas = texto.trim().split(/\r?\n/);
    /*
     * El decimal es la 4ª de nueve columnas, y se cuenta DESDE EL FINAL: un apellido con
     * coma va entrecomillado y `split(',')` lo parte igual, así que contar desde el
     * principio se desplazaría justo en las filas que importan. Desde el final, las seis
     * últimas columnas nunca se mueven.
     *
     * Contándolo desde el principio la primera versión leía la columna del reloj y
     * `parseFloat('11:21')` daba 11: sumaba 45 h donde hay 48.85, y el arnés acusaba a
     * la app de un error que era suyo.
     */
    const suma = lineas
      .slice(1)
      .map((linea) => Number.parseFloat(linea.split(',').slice(-6)[0] ?? '0'))
      .reduce((a, b) => a + b, 0);
    /*
     * EL TOTAL SE LEE AHORA, no se reutiliza el del bloque 1. Aquel se tomó en la
     * semana actual; el bloque 3 navegó a la anterior, y el CSV exporta LA SEMANA QUE
     * SE VE. La primera versión de este cambio comparaba el CSV de la semana anterior
     * (189,70 h) con el total viejo de la actual (17,23 h) y acusaba a la app de no
     * cuadrar, cuando la app había hecho justo lo correcto.
     *
     * Leerlo aquí convierte la comparación en lo que el comentario de arriba promete
     * —«lo exportado es el mismo periodo que lo mirado»— y de paso comprueba algo que
     * antes nadie comprobaba: que exportar desde otra semana exporta ESA semana y no la
     * de hoy. Si alguien vuelve a colgar el exportador de `thisWeekStart` en vez de
     * `weekStart`, esto lo caza.
     */
    const netoEnPantalla = soloHoras(await leerCasilla(pagina, 'report-total'));
    const [hh = '0', mm = '0'] = (netoEnPantalla ?? '0:0').split(':');
    const pantalla = Number.parseInt(hh, 10) + Number.parseInt(mm, 10) / 60;
    const desvio = Math.abs(suma - pantalla);
    console.log(
      `  CSV ${bajada.suggestedFilename()}: ${lineas.length - 1} filas, suma ${suma.toFixed(2)} h contra ${pantalla.toFixed(2)} h en pantalla`,
    );
    if (lineas.length < 2) {
      problemas.push('el CSV compartido no tiene ni una fila de datos');
    }
    // Tolerancia de un minuto por fila: cada fila redondea a dos decimales.
    if (desvio > (lineas.length - 1) * 0.017 + 0.01) {
      problemas.push(
        `el CSV NO suma lo que enseña la pantalla: ${suma.toFixed(2)} h contra ${pantalla.toFixed(2)} h.`,
      );
    }
    if (!texto.startsWith('\uFEFF')) {
      problemas.push('al CSV le falta la marca de orden de bytes: Excel abrirá los acentos mal');
    }
  }

  if (errores.length > 0) problemas.push(`Reportes lanzó: ${errores[0]}`);
  await contexto.close();
}

// ------------------------------------ 2. las siete pestañas en un teléfono
{
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  await entrar(pagina);
  await irA(pagina, base, '/', { asentar: 600 });

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
  await irA(pagina, base, '/reports', { asentar: 800 });
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
  await irA(pagina, base, '/', { asentar: 600 });

  // Y que se pueda llegar a Reportes tocándola, no solo escribiendo la URL.
  await pagina.getByText('Reportes', { exact: true }).last().click();
  await esperarPantalla(pagina, MARCADORES['/reports'], { asentar: 600 });
  if ((await pagina.locator('[data-testid="manager-reports"]').count()) === 0) {
    problemas.push('tocar la pestaña Reportes no lleva a Reportes');
  }
  await contexto.close();
}

/*
 * ---------------------------------------------------------------------------
 * NINGUNA MARCA DE GRÁFICO PUEDE VALER LO MISMO EN LOS DOS TEMAS
 * ---------------------------------------------------------------------------
 *
 * EL FALLO QUE CAZA, Y QUE PASÓ.
 * `day-columns.tsx` se quedó importando el alias `colors` del tema claro. En oscuro,
 * las siete columnas de la semana y las dos líneas de su rejilla seguían pintándose con
 * los valores del claro. Compilaba, no lanzaba nada, y en la captura se veía un morado
 * que pasaba por bueno porque el morado del claro y el del oscuro se parecen. Lo
 * encontró medir los colores de verdad; leer el código no.
 *
 * CÓMO SE MIDE, Y POR QUÉ ASÍ.
 * No se comparan los colores contra una lista: copiar aquí las dos paletas sería tener
 * los tokens en dos sitios, y el día que cambien, este arnés miente. Se usa la FIRMA del
 * fallo: un color de gráfico que sale IGUAL en claro y en oscuro está congelado, porque
 * los dos juegos no comparten ni un solo valor de dato.
 *
 * Así el arnés no sabe nada de qué morado toca —ni falta— y sigue valiendo cuando la
 * paleta cambie. Si algún día un color de dato tiene que ser el mismo en los dos temas,
 * esto falla y habrá que justificarlo aquí, que es exactamente lo que debe pasar.
 */
{
  const colorDeMarcas = async (tema) => {
    const contexto = await navegador.newContext({
      viewport: { width: 1280, height: 1000 },
      colorScheme: tema,
    });
    const pagina = await contexto.newPage();
    await entrar(pagina);
    await irA(pagina, base, '/reports', { asentar: 800 });

    const encontrado = await pagina.evaluate(() => {
      const marcas = new Set();
      const lineas = new Set();
      // Los cinco gráficos. `ranking-late` es el único que usa `attention`, así que sin
      // él ese color se quedaría sin mirar.
      for (const id of [
        'ranking-hours',
        'ranking-reasons',
        'ranking-overtime',
        'ranking-late',
        'week-columns',
      ]) {
        const raiz = document.querySelector(`[data-testid="${id}"]`);
        if (raiz === null) continue;
        for (const el of raiz.querySelectorAll('div')) {
          if (el.children.length > 0) continue;
          const fondo = getComputedStyle(el).backgroundColor;
          if (fondo === 'rgba(0, 0, 0, 0)' || fondo === 'transparent') continue;
          const caja = el.getBoundingClientRect();
          if (caja.width < 1 || caja.height < 1) continue;
          // Rejilla y línea base miden 1 px de alto: son cromo, y también se les mira
          // el color, porque el mismo fallo las alcanzó.
          if (caja.height <= 2 && caja.width > 50) lineas.add(fondo);
          else if (caja.width > 2 && caja.height > 2) marcas.add(fondo);
        }
      }
      return { marcas: [...marcas], lineas: [...lineas] };
    });
    await contexto.close();
    return encontrado;
  };

  const claro = await colorDeMarcas('light');
  const oscuro = await colorDeMarcas('dark');

  for (const [qué, enClaro, enOscuro] of [
    ['marcas de datos', claro.marcas, oscuro.marcas],
    ['rejilla y línea base', claro.lineas, oscuro.lineas],
  ]) {
    if (enClaro.length === 0 || enOscuro.length === 0) {
      problemas.push(`no se midió ningún color de ${qué}: el arnés no está viendo los gráficos`);
      continue;
    }
    const congelados = enClaro.filter((c) => enOscuro.includes(c));
    if (congelados.length > 0) {
      problemas.push(
        `${qué}: ${congelados.join(', ')} sale igual en los dos temas. Está congelado: ` +
          'ese color no se pidió al tema activo.',
      );
    }
    console.log(
      `  ${qué.padEnd(20)} ${enClaro.length} en claro, ${enOscuro.length} en oscuro, ` +
        `${congelados.length === 0 ? 'ninguno repetido' : `${congelados.length} CONGELADO(S)`}`,
    );
  }
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA la comprobación de Reportes:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  '\nOK: Reportes cuadra con Horas, los gráficos tienen escala y las siete pestañas caben.',
);
