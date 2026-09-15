/**
 * ¿Cabe el teclado del reloj de fichaje en la pantalla?
 *
 * POR QUÉ EXISTE
 * En una pantalla de 360×640 la última fila del teclado —"Borrar", "0" y el borrado de
 * dígito— quedaba CORTADA por abajo. Un empleado con ese teléfono no podía terminar de
 * teclear su PIN: la función entera de la aplicación, rota, sin un solo error en
 * consola y con la pantalla pintándose perfecta. Ningún chequeo anterior lo veía porque
 * todos miraban si había contenido, no DÓNDE terminaba.
 *
 * Esto mide la posición real del último botón contra el alto de la ventana. Es la única
 * forma de comprobarlo: el tamaño de fuente que decide el layout se calcula en tiempo de
 * ejecución a partir de las dimensiones, así que no hay nada que un test de unidad pueda
 * inspeccionar sin reimplementar el cálculo —y entonces se estaría comprobando la copia,
 * no el original—.
 *
 * Se prueban tamaños REALES, de menor a mayor, incluido un iPhone SE de primera
 * generación: si funciona ahí, funciona en cualquier teléfono que alguien ponga en el
 * mostrador.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/kiosco-check.mjs dist-demo
 */
import { servirExport, cargarPlaywright } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/kiosco-check.mjs <directorio-del-export>');
  process.exit(2);
}

const TAMANOS = [
  ['iPhone SE 1ª gen', 320, 568],
  ['teléfono pequeño', 360, 640],
  ['teléfono normal', 390, 844],
  ['teléfono grande', 414, 896],
  ['iPad vertical', 834, 1112],
  ['iPad horizontal', 1112, 834],
];

/** §25: por debajo de esto un botón deja de ser un objetivo táctil usable. */
const MINIMO_TACTIL = 44;

/**
 * Holgura mínima por debajo del teclado, en píxeles.
 *
 * NO es cero a propósito. La primera versión de este arnés pasaba con el teclado
 * acabando en 567 de 568: cabía por un píxel. Eso no es "cabe", es "todavía no se ha
 * roto": basta una traducción más larga, un aviso extra o una fuente que redondee
 * distinto para volver al fallo, y el arnés habría dicho que todo estaba bien.
 */
const HOLGURA_MINIMA = 8;

const { base, cerrar } = await servirExport(DIR, 8210);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();
const problemas = [];

for (const [etiqueta, ancho, alto] of TAMANOS) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const pagina = await ctx.newPage();

  // Se activa el reloj por su propia pantalla, como lo haría una persona.
  await pagina.goto(base + '/kiosk/setup', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1500);
  const campos = pagina.locator('input');
  if ((await campos.count()) >= 2) {
    await campos.nth(0).fill('123456');
    await campos.nth(1).fill('Reloj tienda');
    await pagina.getByRole('button').first().click();
    await pagina.waitForTimeout(3000);
  }

  await pagina.goto(base + '/kiosk', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1800);

  const medida = await pagina.evaluate(() => {
    const textos = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && (el.textContent || '').trim() === '0',
    );
    const cero = textos[textos.length - 1];
    if (cero === undefined) return null;
    // El botón es el ancestro que de verdad tiene tamaño de botón.
    let boton = cero;
    while (boton.parentElement !== null && boton.getBoundingClientRect().height < 40) {
      boton = boton.parentElement;
    }
    const r = boton.getBoundingClientRect();
    return { abajo: Math.round(r.bottom), alto: Math.round(r.height), ventana: window.innerHeight };
  });

  if (medida === null) {
    problemas.push(`${etiqueta} (${ancho}×${alto}): no se encontró el teclado`);
    console.log(`  ${etiqueta.padEnd(17)} SIN TECLADO`);
    await ctx.close();
    continue;
  }

  const holgura = medida.ventana - medida.abajo;
  const cabe = holgura >= HOLGURA_MINIMA;
  const tactil = medida.alto >= MINIMO_TACTIL;

  if (!cabe) {
    problemas.push(
      holgura < 0
        ? `${etiqueta} (${ancho}×${alto}): el teclado se SALE ${-holgura}px por abajo`
        : `${etiqueta} (${ancho}×${alto}): solo ${holgura}px de holgura, hacen falta ${HOLGURA_MINIMA}`,
    );
  }
  if (!tactil) {
    problemas.push(
      `${etiqueta} (${ancho}×${alto}): botón de ${medida.alto}px, por debajo del mínimo táctil de ${MINIMO_TACTIL}`,
    );
  }

  console.log(
    `  ${etiqueta.padEnd(17)} ${String(ancho).padStart(4)}×${String(alto).padEnd(4)} ` +
      `holgura ${String(holgura).padStart(4)}px  ` +
      `botón ${medida.alto}px  ${cabe && tactil ? 'OK' : 'FALLA'}`,
  );

  await ctx.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nEL RELOJ NO ES USABLE EN:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(`\nOK: el teclado entero cabe y es tocable en los ${TAMANOS.length} tamaños.`);
