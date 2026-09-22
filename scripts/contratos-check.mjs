/**
 * El cliente y las Cloud Functions se hablan por un objeto SIN TIPO COMPARTIDO.
 *
 * POR QUE EXISTE
 * El 21 y 22 de septiembre de 2026 aparecieron TRES desajustes del mismo tipo, todos en
 * produccion y todos invisibles para `tsc`:
 *
 *   1. `activateKiosk` leia `request.data?.code` y el cliente mandaba `activationCode`.
 *      Activar un reloj devolvia 400 SIEMPRE, y sin reloj nadie puede fichar.
 *   2. `submitTimeEditRequest` leia `proposedValue` y `targetDate`; el cliente manda
 *      `proposedAt`. Toda solicitud de «olvide marcar» se guardaba vacia: la Bandeja
 *      enseñaba una peticion sin hora que aprobar.
 *   3. `activateKiosk` devolvia `policies` DENTRO de `location` y el esquema del cliente
 *      lo espera en la raiz. El servidor creaba el reloj, quemaba el codigo... y el
 *      aparato veia un error, asi que se quedaba sin la credencial que acababa de pedir.
 *
 * Los tres compilan. El compilador no puede ayudar porque en medio hay una llamada de
 * red: de un lado se serializa un objeto y del otro se lee `request.data?.loQueSea`.
 * Nada obliga a que los dos nombres coincidan. Y NINGUNA prueba los cazaba, porque la
 * demostracion implementa su propia version de cada funcion —con la forma CORRECTA— asi
 * que en la demo todo funcionaba y en produccion no.
 *
 * QUE COMPRUEBA
 *   - IDA: una clave que una funcion lee y que ningun cliente le manda.
 *   - VUELTA: una clave que el esquema del cliente exige y que la funcion no devuelve.
 *
 * QUE NO COMPRUEBA, Y LO DICE EN VOZ ALTA
 * Lo que no sabe resolver estaticamente —un payload armado en una variable, un esquema
 * que no es un `z.object` literal— se lista como «sin comprobar» en vez de darse por
 * bueno. Un chequeo que calla lo que no entiende es un chequeo que miente, y este nacio
 * precisamente de tres fallos que nadie veia.
 *
 *   node scripts/contratos-check.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const RAIZ = process.cwd();
const problemas = [];
const sinComprobar = [];

function archivos(dir, extensiones, acumulado = []) {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === 'node_modules' || entrada === '__tests__') continue;
      archivos(ruta, extensiones, acumulado);
    } else if (extensiones.some((ext) => entrada.endsWith(ext))) acumulado.push(ruta);
  }
  return acumulado;
}

const relativa = (ruta) =>
  ruta
    .slice(RAIZ.length + 1)
    .split(sep)
    .join('/');

/**
 * El bloque `{...}` que empieza en `desde`, contando llaves.
 *
 * Se escribe a mano y no con una expresion regular porque los cuerpos llevan objetos
 * anidados, y una expresion regular no sabe contar.
 */
function bloque(texto, desde) {
  const inicio = texto.indexOf('{', desde);
  if (inicio === -1) return null;
  let nivel = 0;
  for (let i = inicio; i < texto.length; i += 1) {
    if (texto[i] === '{') nivel += 1;
    else if (texto[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return { inicio, fin: i, cuerpo: texto.slice(inicio + 1, i) };
    }
  }
  return null;
}

/** Las claves del PRIMER nivel de un cuerpo de objeto, ignorando lo anidado. */
function clavesDeNivel1(cuerpo) {
  const claves = [];
  let nivel = 0;
  let linea = '';
  const empujar = () => {
    // `nombre:` y tambien `nombre` a secas: `{ credential, deviceKey }` es la forma
    // ABREVIADA de JavaScript y sin esto el chequeo acusaba de no devolver lo que si
    // devolvia. Un chequeo con falsos positivos se acaba ignorando entero.
    const m = linea.match(/^\s*(?:\/\/.*)?\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)\s*([:?]|$)/);
    if (m !== null) claves.push(m[1]);
    linea = '';
  };
  for (const car of cuerpo) {
    if (car === '{' || car === '[' || car === '(') nivel += 1;
    else if (car === '}' || car === ']' || car === ')') nivel -= 1;
    if (nivel === 0 && (car === ',' || car === ';' || car === '\n')) empujar();
    else linea += car;
  }
  empujar();
  return [...new Set(claves)];
}

/** Cada clave de nivel 1 con TODO su valor, para poder mirarlo entero. */
function segmentosDeNivel1(cuerpo) {
  const salida = [];
  let nivel = 0;
  let trozo = '';
  const empujar = () => {
    const m = trozo.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (m !== null) salida.push({ clave: m[1], valor: trozo });
    trozo = '';
  };
  for (const car of cuerpo) {
    if (car === '{' || car === '[' || car === '(') nivel += 1;
    else if (car === '}' || car === ']' || car === ')') nivel -= 1;
    if (nivel === 0 && car === ',') empujar();
    else trozo += car;
  }
  empujar();
  return salida;
}

// ---------------------------------------------------------------------------
// 1. Lo que cada Cloud Function lee y devuelve
// ---------------------------------------------------------------------------

const funciones = new Map();

for (const ruta of archivos(join(RAIZ, 'functions', 'src'), ['.ts'])) {
  const texto = readFileSync(ruta, 'utf8');
  for (const m of texto.matchAll(/export const ([A-Za-z_$][\w$]*) = on(?:Call|Schedule)\(/g)) {
    const nombre = m[1];
    /*
     * El cuerpo es el bloque que sigue a la FLECHA, y no el primer `{` que aparezca.
     * Hay tres formas en este proyecto —`onCall(async ...)`, `onCall({opciones}, ...)` y
     * `onCall(OPCIONES_CON_SECRETO, ...)`— y solo la de en medio empieza por `{`. Buscar
     * el primer `{` daba las OPCIONES como cuerpo en un caso y una constante en el otro,
     * asi que `verifyPin` salia «no devuelve nada» cuando devuelve ocho cosas.
     */
    const flecha = texto.indexOf('=>', m.index);
    if (flecha === -1) continue;
    const real = bloque(texto, flecha);
    if (real === null) continue;

    const lee = [
      ...new Set(
        [...real.cuerpo.matchAll(/request\.data\?\.([A-Za-z_$][\w$]*)/g)].map((x) => x[1]),
      ),
    ];

    /*
     * Las claves de TODOS los `return {` del cuerpo, en union. Una funcion puede salir
     * por varios sitios, y exigir que una clave este en TODOS daria falsos positivos en
     * los returns de error temprano. Si una clave no esta en NINGUNO, en cambio, es que
     * no se devuelve nunca, y eso si es un fallo seguro.
     */
    const devuelve = new Set();
    for (const r of real.cuerpo.matchAll(/\breturn\s*\{/g)) {
      const b = bloque(real.cuerpo, r.index + r[0].length - 1);
      if (b !== null) for (const k of clavesDeNivel1(b.cuerpo)) devuelve.add(k);
    }

    /*
     * Sin ni un `return {` literal —`verifyPin` devuelve `buildEmployeeContext(...)`—
     * no se sabe que forma tiene la respuesta, y decir «no devuelve nada» seria mentir.
     * Se marca como no comprobable y se dice en voz alta.
     */
    if (devuelve.size === 0) sinComprobar.push(`${nombre}: no devuelve un objeto literal`);
    funciones.set(nombre, {
      lee,
      devuelve: devuelve.size === 0 ? null : devuelve,
      ruta: relativa(ruta),
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Lo que el cliente manda y lo que espera de vuelta
// ---------------------------------------------------------------------------

const FUENTES_CLIENTE = archivos(join(RAIZ, 'src'), ['.ts', '.tsx']).map((ruta) => ({
  ruta,
  texto: readFileSync(ruta, 'utf8'),
}));

const aCamel = (nombre) => nombre.replace(/[-_]([a-z])/g, (_, l) => l.toUpperCase());

/** Esquemas Zod declarados como `const X = z.object({...})`, por su nombre. */
const esquemas = new Map();
for (const { texto } of FUENTES_CLIENTE) {
  for (const m of texto.matchAll(/const ([A-Za-z_$][\w$]*)\s*=\s*z\.object\(/g)) {
    const b = bloque(texto, m.index + m[0].length - 1);
    if (b === null) continue;
    /*
     * SE MIRA EL VALOR ENTERO DE CADA CLAVE, no su primera linea. Un
     * `organization: z` … `.object({...})` … `.default({...})` repartido en cuatro
     * lineas es OPCIONAL, y buscando `.default(` solo en la linea de la clave salia
     * como obligatorio: el chequeo acusaba de no devolver algo que el cliente no exige.
     */
    const requeridas = segmentosDeNivel1(b.cuerpo)
      .filter(({ valor }) => !/\.optional\(\)|\.default\(/.test(valor))
      .map(({ clave }) => clave);
    esquemas.set(m[1], requeridas);
  }
}

/** El tipo `params: {...}` de la funcion del cliente que contiene esa posicion. */
function paramsDeLaFuncionQueContiene(texto, posicion) {
  let mejor = null;
  for (const m of texto.matchAll(/function [A-Za-z_$][\w$]*\(\s*params:\s*\{/g)) {
    if (m.index < posicion && (mejor === null || m.index > mejor.index)) mejor = m;
  }
  if (mejor === null) return null;
  const b = bloque(texto, mejor.index + mejor[0].length - 1);
  return b === null ? null : clavesDeNivel1(b.cuerpo);
}

const enviosPorFuncion = new Map();
const esperadoPorFuncion = new Map();

const PATRONES = [
  /\b(?:invoke|llamar|callFunction(?:<[^>]*>)?)\(\s*'([a-zA-Z-]+)'\s*,\s*/g,
  /\.rpc\(\s*RPC\.([A-Za-z_$][\w$]*)\s*,\s*/g,
];

for (const { ruta, texto } of FUENTES_CLIENTE) {
  const rel = relativa(ruta);
  // La demostracion implementa su PROPIA version de cada funcion: no es un cliente.
  if (rel.includes('/demo/') || rel.endsWith('firebase/query.ts')) continue;

  for (const patron of PATRONES) {
    for (const m of texto.matchAll(patron)) {
      const nombre = aCamel(m[1]);
      if (!funciones.has(nombre)) continue;

      const resto = texto.slice(m.index + m[0].length);

      if (resto.startsWith('{')) {
        const b = bloque(texto, m.index + m[0].length);
        if (b !== null) {
          const ya = enviosPorFuncion.get(nombre) ?? new Set();
          for (const k of clavesDeNivel1(b.cuerpo)) ya.add(k);
          enviosPorFuncion.set(nombre, ya);
        }
      } else if (/^params\b/.test(resto)) {
        const claves = paramsDeLaFuncionQueContiene(texto, m.index);
        if (claves === null) {
          sinComprobar.push(`${nombre}: manda \`params\` y no encontre su tipo (${rel})`);
        } else {
          const ya = enviosPorFuncion.get(nombre) ?? new Set();
          for (const k of claves) ya.add(k);
          enviosPorFuncion.set(nombre, ya);
        }
      } else {
        sinComprobar.push(`${nombre}: el payload no es literal ni \`params\` (${rel})`);
      }

      // El esquema de respuesta, si lo hay: el tercer argumento.
      const tercero = resto.match(/^[^,]*,\s*([A-Za-z_$][\w$]*)\s*\)/);
      if (tercero !== null && esquemas.has(tercero[1])) {
        esperadoPorFuncion.set(nombre, esquemas.get(tercero[1]));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Comparar
// ---------------------------------------------------------------------------

/*
 * Estas claves NO vienen del payload que escribe la pantalla: las añade el transporte
 * (`kioskAuth`) o las lee un ayudante directamente de `request.data` (`actionToken`).
 * Exigirselas al cliente daria un falso positivo en cada funcion del kiosco.
 */
const DEL_TRANSPORTE = new Set(['kioskAuth', 'actionToken']);

for (const [nombre, { lee, devuelve, ruta }] of funciones) {
  const manda = enviosPorFuncion.get(nombre);
  if (manda === undefined) continue; // nadie la llama: no hay contrato que romper

  for (const clave of lee) {
    if (DEL_TRANSPORTE.has(clave)) continue;
    if (!manda.has(clave)) {
      problemas.push(
        `IDA · ${nombre} lee \`request.data?.${clave}\` y el cliente NUNCA lo manda ` +
          `(manda: ${[...manda].join(', ')}) — ${ruta}`,
      );
    }
  }

  if (devuelve === null) continue;
  for (const clave of esperadoPorFuncion.get(nombre) ?? []) {
    if (!devuelve.has(clave)) {
      problemas.push(
        `VUELTA · el cliente exige \`${clave}\` en la respuesta de ${nombre} y la funcion ` +
          `no lo devuelve (devuelve: ${[...devuelve].join(', ')}) — ${ruta}`,
      );
    }
  }
}

console.log(`funciones: ${funciones.size}; con cliente que las llama: ${enviosPorFuncion.size}`);
if (sinComprobar.length > 0) {
  console.log(`\nSIN COMPROBAR (${sinComprobar.length}):`);
  for (const nota of [...new Set(sinComprobar)]) console.log(`  - ${nota}`);
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} desajuste(s) de contrato:`);
  for (const p of problemas) console.error(`  - ${p}`);
  console.error(
    '\nEl cliente y la funcion se hablan por un objeto sin tipo comun: un nombre mal\n' +
      'puesto compila, despliega y falla en ejecucion. Arregla el lado equivocado.',
  );
  process.exit(1);
}
console.log('\nCliente y funciones se hablan con los mismos nombres.');
