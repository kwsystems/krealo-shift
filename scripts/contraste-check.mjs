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
import { servirExport, cargarPlaywright, medirContraste } from './lib/arnes-web.mjs';

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
 * DEUDA DEL TEMA CLARO, NOMBRADA PARA QUE ESTE ARNÉS SIGA SIRVIENDO.
 *
 * Dos tintas del tema CLARO no llegan a 4,5:1 sobre su insignia, y llevan así desde
 * antes del modo oscuro:
 *
 *   #16845B — `success600`. «Trabajando», «a tiempo». 4,24 y 4,31:1.
 *   #B56B00 — `warning600`. «En pausa», el aviso de demostración. 3,86 y 4,14:1.
 *
 * Arreglarlas cambia las insignias de estado de TODA la app: es un cambio visible que
 * decide Andree, y está en la tarea nJTTpJRad37anvPtsAZc. Aquí se excusan por su valor
 * exacto y SOLO en claro. En oscuro no se excusa nada, porque el oscuro se diseñó
 * midiendo y no hereda nada que disculpar.
 *
 * Lo que NO se hace es bajar el mínimo. Eso deja un arnés que dice OK sin comprobar nada,
 * y la deuda deja de existir para quien lea la salida.
 */
const DEUDA_DE_CLARO = new Map([
  ['rgb(22, 132, 91)', 'success600 en claro (nJTTpJRad37anvPtsAZc)'],
  ['rgb(181, 107, 0)', 'warning600 en claro (nJTTpJRad37anvPtsAZc)'],
]);

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

    const revisar = async (nombre) => {
      const { fallos, medidos, saltados } = await medirContraste(pagina, {
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
    await pagina.goto(base + '/', { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(2000);
    await revisar('acceso');

    await pagina.locator('[data-testid="sign-in-demo"]').click();
    await pagina.waitForTimeout(2800);

    for (const [nombre, ruta] of RUTAS) {
      await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
      await pagina.waitForTimeout(2400);
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
