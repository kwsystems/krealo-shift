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
   * LA FRANJA DEL DÍA SE PINTA DE VERDAD, no solo existe en el código.
   *
   * Esta comprobación está aquí por el historial de este proyecto: SEIS veces un campo
   * existía en el servidor, existía en el cliente, compilaba, y no se pintaba nunca
   * —`flags`, `shiftEndsAt`, `openBreak`, `jobRoleName`, `paidBreakReasons` y las
   * políticas del kiosco—. La franja es lo mismo en potencia: UI nueva sobre un dato
   * nuevo (`dashboard.franjas`). Si ese dato volviera vacío, Inicio diría «hoy no hay
   * turnos ni fichajes» con toda la calma del mundo y nadie lo notaría.
   *
   * Se mide lo que de verdad importa: que haya filas y que dentro haya algo PINTADO. Un
   * carril sin ancho es una franja que existe y no dice nada, que es el fallo que se
   * vigila.
   */
  const franjaDelDia = await pagina.evaluate(() => {
    const filas = [...document.querySelectorAll('[data-testid^="band-row-"]')];
    const conPlan = filas.filter((f) => f.querySelector('[data-testid$="-plan"]') !== null);
    const conReal = filas.filter((f) => f.querySelector('[data-testid$="-real"]') !== null);
    return {
      filas: filas.length,
      conPlan: conPlan.length,
      /* Turno sin fichaje: el carril vacío. Es el caso que la franja existe para enseñar. */
      planSinReal: conPlan.filter((f) => f.querySelector('[data-testid$="-real"]') === null).length,
      conReal: conReal.length,
      vacio: document.querySelector('[data-testid="band-empty"]') !== null,
      /*
       * LA REGLA DE HORAS. La franja codifica la hora del dia como POSICION, asi que sin
       * rotulos enseña la forma y esconde el dato: se ve que una persona empezo mas tarde
       * que otra, no a que hora empezo ninguna. Se mide que haya al menos dos marcas,
       * porque con una sola no hay escala: una referencia suelta no dice cuanto mide nada.
       */
      marcasDeHora: [...document.querySelectorAll('[data-testid="band-list-eje"] *')]
        .map((e) => (e.children.length === 0 ? (e.textContent ?? '').trim() : ''))
        .filter((t) => /^\d{1,2}:\d{2}( ?[ap]\.? ?m\.?)?$/i.test(t)).length,
      /*
       * Y «ahora», que es la linea contra la que se juzga todo lo demas. Puede no existir
       * —si la jornada sembrada termino antes de la hora actual, el momento cae fuera de
       * la ventana— asi que no se exige: se exige que si existe, este DENTRO de la pista.
       * Una linea de «ahora» en el borde o fuera senalaria a una hora que no es.
       */
      ahora: (() => {
        const linea = document.querySelector('[data-testid="band-list-ahora"]');
        if (linea === null) return null;
        const pista = linea.parentElement.getBoundingClientRect();
        const caja = linea.getBoundingClientRect();
        if (pista.width <= 0) return { fraccion: null };
        return { fraccion: (caja.left + caja.width / 2 - pista.left) / pista.width };
      })(),
    };
  });

  /*
   * NO SE ACEPTA EL ESTADO VACÍO COMO APROBADO, y la primera versión de esta comprobación
   * sí lo hacía: probé a dejar `franjasDeHoy` en `[]` —el fallo exacto que se vigila— y el
   * arnés siguió en verde, porque la pantalla enseñaba «hoy no hay turnos» y yo lo había
   * dado por bueno. En la demostración SIEMPRE hay turnos sembrados, así que un vacío es
   * un fallo del dato, no un día tranquilo.
   */
  if (franjaDelDia.filas === 0) {
    problemas.push(
      `escenario «${escenario.nombre}»: la franja del día no tiene ni una fila` +
        (franjaDelDia.vacio
          ? ' y enseña su estado vacío, pero la demostración siembra turnos todos los días:' +
            ' el dato llegó vacío y la pantalla lo dijo como si fuera normal.'
          : '. O falta la tarjeta, o no se montó.'),
    );
  } else if (franjaDelDia.conPlan === 0 && franjaDelDia.conReal === 0) {
    problemas.push(
      `escenario «${escenario.nombre}»: hay ${franjaDelDia.filas} fila(s) y ningún tramo ` +
        'pintado. Una franja que existe y no dice nada es el fallo de campo muerto.',
    );
  }

  /*
   * LA ESCALA NO ES OPCIONAL. Una franja sin rotulos de hora es un grafico con el eje sin
   * rotular: la unica cosa que hace —colocar el tiempo en el espacio— queda sin decir.
   * Estuvo asi hasta el 2026-09-24 y no se veia mirando, porque la pantalla se lee como si
   * tuviera sentido; salio midiendo la posicion de cada barra contra la hora escrita bajo
   * el nombre y despejando la ventana a mano.
   */
  if (franjaDelDia.filas > 0 && franjaDelDia.marcasDeHora < 2) {
    problemas.push(
      `escenario «${escenario.nombre}»: la franja tiene ${franjaDelDia.filas} fila(s) y ` +
        `${franjaDelDia.marcasDeHora} rotulo(s) de hora. Sin escala, la posicion de cada ` +
        'barra no dice a que hora fue nada.',
    );
  }

  if (franjaDelDia.ahora !== null) {
    const f = franjaDelDia.ahora.fraccion;
    if (f === null || !(f >= 0 && f <= 1)) {
      problemas.push(
        `escenario «${escenario.nombre}»: la linea de «ahora» esta en ${f} de la pista, o ` +
          'sea fuera. Estaria señalando una hora que no es la que marca.',
      );
    }
  }

  /*
   * Y EN EL DÍA CON AUSENTES, el carril vacío tiene que verse. Es la razón de ser de la
   * franja: «tenía turno y no ha fichado» sin leer una sola hora.
   */
  if (escenario.nombre === 'ausentes' && franjaDelDia.filas > 0 && franjaDelDia.planSinReal === 0) {
    problemas.push(
      'escenario «ausentes»: ninguna fila enseña turno SIN fichaje, que es justo lo que ' +
        'este día tiene que hacer visible. O el dato de las ausencias no llega a la ' +
        'franja, o el carril se está pintando con relleno.',
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
