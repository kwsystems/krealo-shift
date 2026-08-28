/**
 * Cosas declaradas que nadie usa, y controles que no hacen nada.
 *
 * POR QUE EXISTE
 * Las dos cosas que comprueba se encontraron A MANO, leyendo, despues de meses en el
 * repositorio:
 *
 *   - "Olvide mi contrasena" era `onPress={() => undefined}`: un boton que se veia, se
 *     pulsaba y no pasaba nada. Sobrevivio porque un boton muerto y un boton dentro de
 *     un `<Link asChild>` —donde el Link pone el onPress de verdad— SE ESCRIBEN IGUAL.
 *
 *   - 21 claves de i18n sin usar, y tres de ellas no eran texto sobrante: eran
 *     funciones que la especificacion pedia y que nunca se conectaron. El boton de
 *     copiar el diagnostico del kiosco (§31), "cerrar sesion en todos los
 *     dispositivos" (§8) y el aviso de sesion caducada existian traducidos, en los dos
 *     idiomas, sin una linea de codigo detras. La prueba de paridad no los veia: compara
 *     los dos idiomas ENTRE SI, y una clave muerta en los dos pasa limpia.
 *
 * Una clave de texto huerfana casi nunca es solo texto: es la huella de algo que se
 * penso, se tradujo y se quedo sin hacer. Por eso esto es una puerta y no un informe.
 *
 *   node scripts/coherencia-check.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();
const problemas = [];

function archivos(dir, extensiones, acumulado = []) {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivos(ruta, extensiones, acumulado);
    else if (extensiones.some((ext) => entrada.endsWith(ext))) acumulado.push(ruta);
  }
  return acumulado;
}

const RUTAS_FUENTE = [...archivos(join(RAIZ, 'src'), ['.ts', '.tsx']), ...archivos(join(RAIZ, 'app'), ['.ts', '.tsx'])]
  .filter((ruta) => !ruta.includes(`${'i18n'}/locales`));

const FUENTES = RUTAS_FUENTE.map((ruta) => ({ ruta, texto: readFileSync(ruta, 'utf8') }));
const TODO = FUENTES.map((f) => f.texto).join('\n');

// ---------------------------------------------------------------------------
// 1. Controles muertos
// ---------------------------------------------------------------------------
//
// `onPress={() => undefined}` esta PROHIBIDO, incluso donde es correcto: cuando el
// que navega es un `<Link asChild>` de encima, se escribe `onPress={pressHandledByLink}`,
// que dice lo que pasa. Sin esa distincion no hay forma de separar los dos casos con
// una comprobacion, y el caso equivocado es invisible.
{
  const PATRONES = [
    /onPress=\{\(\)\s*=>\s*(?:undefined|\{\s*\})\}/,
    /onPress=\{\(\)\s*=>\s*null\}/,
  ];

  // Se saltan los COMENTARIOS. Los tres primeros aciertos de esta comprobacion fueron
  // comentarios que CITAN el codigo muerto para explicar por que se quito: acusar a la
  // documentacion del arreglo es la forma mas rapida de que alguien borre la puerta.
  const esComentario = (linea) => /^\s*(\*|\/\/|\/\*)/.test(linea);

  for (const { ruta, texto } of FUENTES) {
    if (ruta.includes('__tests__')) continue;
    texto.split('\n').forEach((linea, indice) => {
      if (esComentario(linea)) return;
      if (PATRONES.some((patron) => patron.test(linea))) {
        problemas.push(
          `${ruta.replace(RAIZ + '/', '')}:${indice + 1} control muerto: ` +
            'usa `pressHandledByLink` si lo maneja un <Link>, o implementalo',
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Claves de i18n que nadie usa
// ---------------------------------------------------------------------------
{
  const hojas = (obj, prefijo = '', acumulado = []) => {
    for (const [clave, valor] of Object.entries(obj)) {
      const ruta = prefijo === '' ? clave : `${prefijo}.${clave}`;
      if (valor !== null && typeof valor === 'object') hojas(valor, ruta, acumulado);
      else acumulado.push(ruta);
    }
    return acumulado;
  };

  const claves = hojas(
    JSON.parse(readFileSync(join(RAIZ, 'src/i18n/locales/es-PE.json'), 'utf8')),
  );

  // Literales que parecen una clave, en cualquier posicion: `t('a.b')`, pero tambien
  // `message: 'errors.network'` y las tablas tipo `{clock_in: 'attendance.eventClockIn'}`.
  const literales = new Set();
  for (const m of TODO.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)['"`]/g)) {
    literales.add(m[1]);
  }

  // Claves armadas con plantilla. El hueco no siempre cae despues de un punto:
  // `roles.${role}` da el prefijo "roles." y `settings.weekDay${n}` da "settings.weekDay".
  const prefijos = new Set();
  for (const m of TODO.matchAll(/[`]([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9_.]*)\$\{/g)) {
    prefijos.add(m[1]);
  }
  for (const m of TODO.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)*\.)['"`]\s*\+/g)) {
    prefijos.add(m[1]);
  }

  // Sufijos de plural de i18next: el codigo pide `schedule.shiftsCount` y el JSON tiene
  // `shiftsCount_one` y `shiftsCount_other`.
  const PLURALES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
  const sinPlural = (clave) => {
    const sufijo = PLURALES.find((s) => clave.endsWith(s));
    return sufijo === undefined ? clave : clave.slice(0, -sufijo.length);
  };

  const huerfanas = claves.filter((clave) => {
    const base = sinPlural(clave);
    if (literales.has(clave) || literales.has(base)) return false;
    return ![...prefijos].some((p) => clave.startsWith(p) || base.startsWith(p));
  });

  console.log(
    `i18n: ${claves.length} claves, ${literales.size} literales vistos, ` +
      `${prefijos.size} prefijos de plantilla (${[...prefijos].join(', ')})`,
  );

  for (const clave of huerfanas) {
    problemas.push(
      `i18n huerfana: ${clave} — conectala o quitala de los DOS idiomas. ` +
        'Si se arma con plantilla, el prefijo tiene que verse en el codigo.',
    );
  }
}

console.log(`archivos revisados: ${FUENTES.length}`);

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s) de coherencia:`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log('\nNada declarado sin usar, y ningun control muerto.');
