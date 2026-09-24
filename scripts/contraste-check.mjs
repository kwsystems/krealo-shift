/**
 * ¿Se lee TODO, en los dos temas?
 *
 * EL FALLO QUE CAZA
 * El fallo característico del modo oscuro no es una pantalla que revienta. Es UN texto
 * gris sobre un fondo gris, en una esquina que nadie abrió al probar. No lanza, no sale
 * en consola, no rompe el layout. Se descubre el día que un empleado no puede leer su
 * propio nombre.
 *
 * POR QUÉ UN ARNÉS Y NO MIRARLAS
 * Son seis pantallas del panel más el acceso, en dos temas, con 54 archivos que ponen
 * color. Mirarlas todas a mano es exactamente el tipo de revisión que se hace bien la
 * primera vez y nunca más. Y mirar no sirve para un 4,3:1: el ojo dice «se ve» mucho
 * antes de que se lea con soltura.
 *
 * CÓMO SE MIDE
 * Se abre cada pantalla en los dos temas y se le pregunta al navegador el color REAL de
 * cada texto y el fondo REAL que tiene detrás. No se comparan tokens: un par que en la
 * paleta da 6:1 puede acabar en 2:1 en pantalla porque el texto cayó sobre otra
 * superficie. El cálculo vive en `lib/arnes-web.mjs` y lo comparte con `kiosco-check`.
 *
 * LO QUE ESTE ARNÉS NO VE, PARA QUE NADIE LO DÉ POR CUBIERTO
 * Solo mide lo que está pintado cuando pasa. Un diálogo que no se abre, un estado de
 * error que la demostración no puede provocar y una pantalla detrás de un permiso no se
 * miden aquí. Por eso imprime CUÁNTOS textos midió en cada parada: un cero es un fallo
 * del arnés, no una pantalla limpia, y se trata como error.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/contraste-check.mjs dist-demo
 */
import {
  servirExport,
  cargarPlaywright,
  medirContraste,
  esperarPantalla,
  MARCADOR_ACCESO,
  MARCADORES,
  irA,
  sembrarKiosco,
} from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/contraste-check.mjs <export-demo>');
  process.exit(2);
}

const TEMAS = ['light', 'dark'];

/**
 * 4,5:1 para texto normal, 3:1 para el grande, y GRANDE es >= 24 px y nada más.
 *
 * La regla de WCAG incluye «>= 18,7 px en negrita», pero en esta app el peso lo lleva la
 * FAMILIA —`Inter_600SemiBold`— y no el `font-weight`, que sigue diciendo 400. Preguntar
 * por el peso daría 400 en textos que son negrita de verdad, así que se aplica el umbral
 * estricto a todo lo que no llegue a 24 px. Equivocarse hacia el lado exigente es lo
 * correcto: como mucho se pide de más a un título.
 */
const MINIMO = 4.5;
const MINIMO_GRANDE = 3;
const TAMANO_GRANDE = 24;

/**
 * Las pantallas, y en qué anchos. No es capricho:
 *
 * En 1280 salen la barra lateral, las tablas anchas y la cabecera de escritorio. En 390
 * sale la barra de pestañas de abajo, los textos se envuelven y aparecen las variantes
 * compactas de media docena de componentes. Son DOS conjuntos de elementos distintos, no
 * el mismo más estrecho, así que medir solo uno deja el otro sin mirar.
 */
const ANCHOS = [
  ['escritorio', 1280, 900],
  ['teléfono', 390, 844],
];

const RUTAS = [
  ['inicio', '/'],
  ['equipo', '/team'],
  ['horario', '/schedule'],
  ['horas', '/hours'],
  ['reportes', '/reports'],
  ['solicitudes', '/requests'],
  ['ajustes', '/settings'],
];

/**
 * AJUSTES NO TIENE RUTA PROPIA, Y CASI SE QUEDA SIN MEDIR.
 *
 * «Más» abre en Solicitudes; Ajustes está detrás de la segunda pestaña de su control
 * segmentado. Con solo visitar `/more` se medían 27 textos y el panel de Ajustes entero
 * —el formulario más grande de la app, y donde vive el selector de apariencia que
 * añadió esta misma tarea— no lo miraba nadie.
 *
 * Es literalmente el fallo que este arnés existe para cazar: «una esquina que nadie
 * abrió al probar». La primera versión de este archivo lo tenía. Se vio comparando la
 * cuenta de textos de «mas» con la de las demás pantallas: 27 contra 277 no era que
 * «Más» fuera corta, era que estaba medio cerrada.
 */
// «Más» se partió en dos rutas propias, así que ya no hay segmentado que pulsar
// para llegar a Ajustes: es un destino de la barra.
const PESTANAS = [];

/**
 * LA DEUDA DEL TEMA CLARO SE PAGÓ EL 2026-09-22, y esta lista se queda vacía a propósito.
 *
 * Dos tintas del tema CLARO no llegaban a 4,5:1 sobre su insignia, y llevaban así desde
 * antes del modo oscuro: `success600` #16845B a 4,31:1 («Trabajando», «a tiempo») y
 * `warning600` #B56B00 a 3,86:1 («En pausa», el aviso de demostración). Se oscurecieron
 * lo justo —#157D56 y #A26000— y ahora dan 4,71 y 4,65.
 *
 * El mapa sigue aquí y vacío porque la forma de excusar una deuda tiene que seguir
 * existiendo: cuando aparezca la siguiente, se anota con su valor exacto y su tarea, y no
 * se baja el mínimo. Bajar el mínimo deja un arnés que dice OK sin comprobar nada, y la
 * deuda deja de existir para quien lea la salida.
 */
const DEUDA_DE_CLARO = new Map([]);

const problemas = [];
const deudaVista = new Set();
let totalMedidos = 0;

const { base, cerrar } = await servirExport(DIR, 8131);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

for (const tema of TEMAS) {
  for (const [nombreAncho, ancho, alto] of ANCHOS) {
    const contexto = await navegador.newContext({
      viewport: { width: ancho, height: alto },
      colorScheme: tema,
    });
    const pagina = await contexto.newPage();

    /*
     * `enPagina` como parametro y no leyendo la de fuera: el reloj se mide en SU PROPIO
     * contexto —necesita credencial de kiosco y entrar ahi deja la sesion del panel fuera
     * de juego— asi que `revisar` tiene que poder apuntar a otra pestaña sin que nadie
     * reasigne una variable a escondidas.
     */
    const revisar = async (nombre, enPagina = pagina) => {
      const { fallos, medidos, saltados } = await medirContraste(enPagina, {
        minimo: MINIMO,
        minimoGrande: MINIMO_GRANDE,
        tamanoGrande: TAMANO_GRANDE,
      });
      totalMedidos += medidos;
      let conocidos = 0;
      for (const f of fallos) {
        const deuda = tema === 'light' ? DEUDA_DE_CLARO.get(f.tinta) : undefined;
        if (deuda !== undefined) {
          conocidos += 1;
          deudaVista.add(deuda);
          continue;
        }
        problemas.push(
          `${tema}/${nombreAncho}, ${nombre}: «${f.texto}» a ${f.razon}:1 (hace falta ` +
            `${f.exigido}:1 con ${f.px}px) — ${f.tinta} sobre ${f.fondo}`,
        );
      }
      const nuevos = fallos.length - conocidos;
      console.log(
        `  ${tema.padEnd(5)} ${nombreAncho.padEnd(10)} ${nombre.padEnd(10)} ` +
          `${String(medidos).padStart(3)} textos, ` +
          `${nuevos === 0 ? 'todos legibles' : `${nuevos} ILEGIBLES`}` +
          `${conocidos > 0 ? ` (${conocidos} de deuda conocida)` : ''}` +
          `${saltados > 0 ? ` (${saltados} apagados, exentos)` : ''}`,
      );
      // Cero textos medidos no es una pantalla limpia: es el arnés mirando a otro lado.
      if (medidos === 0) {
        problemas.push(`${tema}/${nombreAncho}, ${nombre}: no se midió ni un texto`);
      }
    };

    // La pantalla de acceso, ANTES de entrar. Es la primera que ve cualquiera y la única
    // que se ve sin sesión, así que un texto ilegible ahí es el peor sitio posible.
    // Esperando POR LA PANTALLA y no por el reloj. Los números fijos que había aquí
    // estaban afinados en una máquina; en un runner más lento se quedan cortos y el
    // arnés mide una pantalla a medio montar. Ver `esperarPantalla`.
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, MARCADOR_ACCESO, { asentar: 400 });
    await revisar('acceso');

    await pagina.locator('[data-testid="sign-in-demo"]').click();
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 500 });

    for (const [nombre, ruta] of RUTAS) {
      await irA(pagina, base, ruta, { asentar: 500 });
      await revisar(nombre);
    }

    // Y lo que vive detrás de una pestaña, que no tiene URL a la que ir.
    for (const [nombre, testId] of PESTANAS) {
      const pestana = pagina.locator(`[data-testid="${testId}"]`);
      if ((await pestana.count()) === 0) {
        problemas.push(
          `${tema}/${nombreAncho}: no se encontró la pestaña «${nombre}» (${testId}), ` +
            'así que esa pantalla se quedó sin medir',
        );
        continue;
      }
      await pestana.first().click();
      await pagina.waitForTimeout(2800);
      await revisar(nombre);
    }

    /*
     * Y AHORA CON EL COLOR DE OTRA EMPRESA, que es lo que la marca blanca pone en juego.
     *
     * POR QUE HACE FALTA. Todos los numeros de arriba suponen el acento de fabrica. Desde
     * que una empresa puede elegir el suyo, ese supuesto deja de valer: el dia que una
     * pasteleria elija su amarillo, ninguna de las 3.124 medidas de arriba habla de la
     * pantalla que esa gente va a ver.
     *
     * SE PRUEBA CON UN AMARILLO PURO A PROPOSITO. Usado tal cual sobre blanco da 1,07:1
     * —ilegible— asi que es justo el caso que la derivacion tiene que salvar. Probar con
     * un azul oscuro no probaria nada: ese ya pasaria sin derivar.
     *
     * Solo en el tema y ancho que toque de la vuelta, y en dos pantallas: medir las ocho
     * otra vez por cada tema y ancho multiplicaria por dos un arnes que ya tarda, y lo que
     * se vigila —que la rampa derivada cumple— no depende de la pantalla.
     */
    const MARCA_DIFICIL = '#FFE500';
    /*
     * SE ENTRA DIRECTO AL PANEL, sin pasar por la pantalla de acceso: a estas alturas del
     * recorrido la sesión ya existe, así que esperar el rótulo de acceso se queda colgado
     * treinta segundos. Pasó a la primera ejecución.
     */
    await pagina.goto(`${base}/?marca=${encodeURIComponent(MARCA_DIFICIL)}`, {
      waitUntil: 'networkidle',
    });
    await esperarPantalla(pagina, MARCADORES['/'], { asentar: 600 });
    await revisar(`inicio con marca ${MARCA_DIFICIL}`);
    await irA(pagina, base, '/team', { asentar: 500 });
    await revisar(`equipo con marca ${MARCA_DIFICIL}`);

    /*
     * EL RELOJ DE FICHAJE, que nunca se habia medido.
     *
     * Este arnes recorria las siete pantallas del panel y se paraba ahi. O sea que la
     * pantalla que usa LA MAYORIA DE LA GENTE —la de la pared de la tienda, leida de pie,
     * a un metro y con la luz que haya— era la unica sin una sola medida de contraste.
     * El panel lo miran uno o dos encargados; el reloj lo miran todos, cuatro veces al
     * dia.
     *
     * Va al final y en su propio contexto porque necesita credencial de kiosco sembrada, y
     * porque entrar al reloj deja la sesion del panel fuera de juego: si fuera antes, las
     * pantallas de arriba se medirian sin sesion.
     */
    const contextoKiosco = await navegador.newContext({
      viewport: { width: ancho, height: alto },
      colorScheme: tema,
    });
    const paginaKiosco = await contextoKiosco.newPage();
    await sembrarKiosco(paginaKiosco);
    await paginaKiosco.goto(base + '/kiosk', { waitUntil: 'networkidle' });

    const teclado = paginaKiosco.locator('[data-testid="keypad-1"]:visible');
    try {
      await teclado.waitFor({ timeout: 30000 });
    } catch {
      problemas.push(
        `${tema}/${nombreAncho}: el reloj no llego a pintar su teclado, asi que se quedo ` +
          'sin medir. Es la pantalla que usa mas gente: no se da por buena sin medirla.',
      );
    }
    if ((await teclado.count()) > 0) await revisar('reloj', paginaKiosco);
    await contextoKiosco.close();

    await contexto.close();
  }
}

await navegador.close();
await cerrar();

for (const deuda of deudaVista) {
  console.log(`  deuda: se topó y se dejó pasar — ${deuda}`);
}

if (problemas.length > 0) {
  console.error('\nHAY TEXTO QUE NO SE LEE:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  `\nOK: ${totalMedidos} textos medidos en ${RUTAS.length + PESTANAS.length + 1} pantallas × ` +
    `${ANCHOS.length} anchos × ${TEMAS.length} temas, y todos llegan al contraste que ` +
    'pide su tamaño.',
);
