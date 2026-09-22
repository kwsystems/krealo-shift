/**
 * Inicio: ¿de verdad cambia según el día?
 *
 * Esta comprobación es la condición que la propia tarea se puso: capturas del mismo
 * Inicio en tres situaciones sembradas a propósito, y que se vea claramente distinto en
 * las tres. Si sale igual, la priorización no está haciendo nada.
 *
 * Y NO ES UNA FORMALIDAD. Una priorización se puede escribir entera, con sus pruebas
 * unitarias en verde, y seguir enseñándolo todo del mismo tamaño porque la pantalla no
 * llegó a usarla —la lista sale ordenada y luego se pinta en una fila de casillas
 * iguales—. Las cuentas y el aspecto son dos cosas, y esto mira la segunda: qué
 * TITULAR se pinta en cada escenario y que los tres sean distintos entre sí.
 *
 * Deja además las tres capturas en disco, que es lo que se mira para decidir si además
 * de distinto está bien.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/inicio-check.mjs dist-demo [directorio-de-capturas]
 */
import { mkdirSync } from 'node:fs';

import { servirExport, cargarPlaywright, entrarComoDemo } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
const CAPTURAS = process.argv[3] ?? '/tmp/krealo-inicio';
if (DIR === undefined) {
  console.error('Uso: node scripts/inicio-check.mjs <export-demo> [dir-capturas]');
  process.exit(2);
}
mkdirSync(CAPTURAS, { recursive: true });

/** Qué se espera de cada día sembrado, y qué titular tiene que ganar. */
const ESCENARIOS = [
  { nombre: 'tranquilo', titular: null, marca: 'hoy-todo-en-orden', minimo: 0 },
  { nombre: 'ausentes', titular: 'absent', marca: 'hoy-titular-absent', minimo: 3 },
  { nombre: 'solicitudes', titular: 'requests', marca: 'hoy-titular-requests', minimo: 6 },
];

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8127);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const textos = new Map();

for (const escenario of ESCENARIOS) {
  const contexto = await navegador.newContext({ viewport: { width: 1100, height: 1400 } });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));

  // Se entra ESPERANDO POR LA PANTALLA y no por el reloj: antes eran 1.500 ms y 3.000 ms
  // afinados en una máquina, y en un runner más lento se quedan cortos y el arnés mide
  // una pantalla a medio montar. Ver `entrarComoDemo`.
  await entrarComoDemo(pagina, base, { ruta: `/?escenario=${escenario.nombre}` });

  const marca = await pagina.locator(`[data-testid="${escenario.marca}"]`).count();
  if (marca === 0) {
    problemas.push(
      `escenario «${escenario.nombre}»: no se pintó «${escenario.marca}». ` +
        (escenario.titular === null
          ? 'Un día sin nada pendiente tiene que decirlo, no enseñar ceros.'
          : `Lo que decide el día debería ser «${escenario.titular}».`),
    );
  }

  /*
   * Y que el escenario entregue LO QUE PROMETE SU NOMBRE. El titular correcto no basta:
   * un «día con ausentes» que enseña «1 ausente» tiene el titular bien y el escenario
   * mal, y así pasó —dos de las tres personas sembradas ya habían fichado, y las seis
   * solicitudes caían la mitad en la otra sede—. La cifra es la que lo denuncia.
   */
  // Solo si la marca existe: pedir el texto de un locator vacío cuelga el arnés 30 s y
  // lo tumba con un timeout, escondiendo el problema real que ya se acaba de anotar.
  if (escenario.minimo > 0 && marca > 0) {
    // Los dígitos, con una expresión regular y no con `parseInt` de todo el bloque: el
    // texto del titular empieza por el icono, así que `parseInt` devolvía NaN y el
    // arnés acusaba a la app de un fallo que era del propio arnés.
    const texto =
      (await pagina.locator(`[data-testid="${escenario.marca}"]`).first().innerText()) || '';
    const cifra = Number.parseInt((/\d+/.exec(texto) ?? ['0'])[0], 10);
    if (!Number.isFinite(cifra) || cifra < escenario.minimo) {
      problemas.push(
        `escenario «${escenario.nombre}»: el titular dice ${cifra} y el escenario siembra ${escenario.minimo}.`,
      );
    }
  }

  /*
   * Y que NINGÚN OTRO titular se haya colado. Un día con ausentes que además pintara el
   * titular de solicitudes tendría dos titulares, que es lo mismo que no tener ninguno.
   */
  const titulares = await pagina.locator('[data-testid^="hoy-titular-"]').count();
  if (escenario.titular !== null && titulares !== 1) {
    problemas.push(`escenario «${escenario.nombre}»: hay ${titulares} titulares y debe haber 1`);
  }

  if (marca === 0) {
    const loQuePinta = await pagina.locator('[data-testid^="hoy-"]').allTextContents();
    console.log(`     (pintó en su lugar: ${JSON.stringify(loQuePinta).slice(0, 180)})`);
  }

  const texto = ((await pagina.evaluate(() => document.body.innerText)) || '')
    .replace(/\s+/g, ' ')
    .trim();
  const gemelo = [...textos.entries()].find(([, valor]) => valor === texto);
  if (gemelo !== undefined) {
    problemas.push(
      `los escenarios «${escenario.nombre}» y «${gemelo[0]}» pintan EXACTAMENTE lo mismo. ` +
        'La priorización no está cambiando nada.',
    );
  }
  textos.set(escenario.nombre, texto);

  await pagina.screenshot({
    path: `${CAPTURAS}/inicio-${escenario.nombre}.png`,
    fullPage: true,
  });

  // La primera línea de lo destacado, que es lo que una persona lee al abrir la app.
  const franja = pagina.locator(
    '[data-testid="hoy-lo-importante"], [data-testid="hoy-todo-en-orden"]',
  );
  const resumen =
    (await franja.count()) > 0
      ? ((await franja.first().innerText()) || '').replace(/\s+/g, ' ').trim().slice(0, 96)
      : '(nada)';
  console.log(`  ${escenario.nombre.padEnd(12)} ${resumen}`);

  if (errores.length > 0) problemas.push(`escenario «${escenario.nombre}»: ${errores[0]}`);
  await contexto.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nFALLA la comprobación de Inicio:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(`\nOK: los tres días se ven distintos. Capturas en ${CAPTURAS}/`);
