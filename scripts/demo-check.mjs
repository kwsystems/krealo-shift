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
import { servirExport, cargarPlaywright } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/demo-check.mjs <directorio-del-export>');
  process.exit(2);
}

const RUTAS = [
  ['inicio', '/'],
  ['equipo', '/team'],
  ['horario', '/schedule'],
  ['horas', '/hours'],
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

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA el recorrido de la demostración:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(`\nOK: ${RUTAS.length} pantallas con contenido y todas distintas entre sí.`);
