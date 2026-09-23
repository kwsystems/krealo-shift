#!/usr/bin/env node
/**
 * ¿HAY ALGÚN CAMPO QUE NADIE LLENA NUNCA?
 *
 * DE DÓNDE SALE. En una sola semana aparecieron SEIS campos que el servidor escribía con
 * un valor fijo mientras el cliente tenía pantalla esperándolos:
 *
 *   `flags: []`            la hoja de horas no marcaba ni una tardanza
 *   `shiftEndsAt: null`    el reloj no decía a qué hora terminas
 *   `openBreak: null`      no decía desde cuándo llevas en pausa
 *   `jobRoleName: null`    no decía tu puesto
 *   `paidBreakReasons`     la sede configuraba qué se paga y no llegaba nunca
 *   `binding.policies`     toda política nueva valía `undefined` en los relojes montados
 *
 * No es mala suerte, es un modo de fallo que nada vigilaba. TypeScript no lo ve —cliente
 * y funciones no comparten tipo, y `null` es válido—; el linter tampoco, porque no hay
 * nada mal escrito; `contratos-check` compara que los NOMBRES coincidan, no los valores;
 * y las pruebas no existían. El único filtro era que alguien mirara la pantalla y notara
 * que algo no sale nunca. Seis veces no lo notó nadie.
 *
 * QUÉ MIRA. Tres sitios donde nace un campo, en `functions/src`:
 *   - lo que devuelve una función invocable;
 *   - lo que devuelve cualquier ayudante del mismo paquete;
 *   - lo que se ESCRIBE en Firestore (`.set`, `.create`, `.update`, `.add`).
 * Y baja dos niveles dentro de los objetos, porque `summary: { shiftEndsAt: null }` fue
 * uno de los seis y con solo el nivel de arriba se escapa entero.
 *
 * CUÁNDO ACUSA. Cuando una clave aparece SIEMPRE con el mismo literal fijo —`null`, `[]`,
 * `false`, `true`, `0`, `''`, `{}`— y en ningún sitio con otra cosa. Que aparezca `false`
 * en una salida y `true` en otra NO es fijo: ahí el valor depende de algo, que es justo
 * lo que se quiere.
 *
 * LO QUE NO PUEDE HACER, dicho en voz alta: esto es lectura de texto, no un compilador.
 * Un campo que se llena a través de una variable intermedia con un valor siempre fijo se
 * le escapa. Caza el patrón concreto que ya nos mordió seis veces, que es para lo que
 * está.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();

/**
 * Los campos que SÍ son fijos a propósito, cada uno con su razón.
 *
 * Es la misma forma que la lista de deuda de contraste de `tema.test.ts`, y por lo mismo:
 * un chequeo sin forma de decir «este ya lo miré y está bien» se acaba apagando entero, y
 * entonces no vigila nada. Añadir una línea aquí obliga a escribir POR QUÉ, que es la
 * parte que hace pensar.
 */
const FIJOS_A_PROPOSITO = new Map([
  ['verifyPin.pin_failed_attempts', 'un contador de intentos fallidos nace en cero'],
  ['verifyPin.pin_locked_until', 'un PIN recién visto no está bloqueado'],
  ['syncOfflineEvents.pending', 'la cola se vacía entera en el lote: al responder no queda nada'],
  ['submitTimeEditRequest.reviewed_by', 'una solicitud nace sin revisar; la revisa un gerente'],
  ['submitTimeEditRequest.reviewed_at', 'lo mismo: no hay fecha de revisión hasta que se revisa'],
  ['submitTimeEditRequest.reviewer_comment', 'lo mismo'],
  ['setEmployeePin.failed_attempts', 'un PIN nuevo nace sin intentos fallidos'],
  ['setEmployeePin.locked_until', 'y sin bloqueo'],
  ['createKioskActivationCode.used_count', 'un código recién creado no se ha usado'],
  [
    'managerAddTimeEvent.work_session_id',
    'el ajuste apunta al EVENTO, no a una sesión: la sesión se recalcula después',
  ],
  [
    'managerAddTimeEvent.before_value',
    'un fichaje AÑADIDO no tenía valor anterior; por eso se distingue de una corrección',
  ],
  ['purgarUbicacion.photo_path', 'purgar ES poner la ruta a null: el valor fijo es el trabajo'],
  // El marcador de éxito de las funciones que no devuelven datos.
  ['attachPhoto.ok', 'marcador de éxito'],
  ['revokeAllSessions.ok', 'marcador de éxito'],
  ['setMemberRole.ok', 'marcador de éxito'],
  ['revokeMember.ok', 'marcador de éxito'],
  ['cancelInvitation.ok', 'marcador de éxito'],
]);

function archivos(dir, extensiones, acumulado = []) {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada !== '__tests__' && entrada !== 'node_modules') {
        archivos(ruta, extensiones, acumulado);
      }
    } else if (extensiones.some((ext) => ruta.endsWith(ext))) {
      acumulado.push(ruta);
    }
  }
  return acumulado;
}

/** El bloque `{...}` equilibrado que empieza en el primer `{` desde `desde`. */
function bloque(texto, desde) {
  const inicio = texto.indexOf('{', desde);
  if (inicio === -1) return null;
  let nivel = 0;
  for (let i = inicio; i < texto.length; i += 1) {
    if (texto[i] === '{') nivel += 1;
    else if (texto[i] === '}') {
      nivel -= 1;
      if (nivel === 0) return { cuerpo: texto.slice(inicio + 1, i) };
    }
  }
  return null;
}

const sinComentarios = (texto) => texto.replace(/^[ \t]*\/\/.*$/gm, '');

/** Los pares `clave: valor` del nivel de arriba, con el texto del valor. */
function segmentos(cuerpo) {
  const salida = [];
  let nivel = 0;
  let trozo = '';
  const empujar = () => {
    const m = sinComentarios(trozo).match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
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

/** `clave: null` y compañía, admitiendo comentarios delante y un `as T` detrás. */
const LITERAL_FIJO =
  /^\s*(?:\/\*[\s\S]*?\*\/|\/\/.*\n)*\s*[A-Za-z_$][\w$]*\s*:\s*(null|\[\]|false|true|0|''|""|\{\})\s*(?:as\s+[^,]+)?\s*$/;

const ABRE_OBJETO = /^\s*(?:\/\*[\s\S]*?\*\/|\/\/.*\n)*\s*[A-Za-z_$][\w$]*\s*:\s*\{/;

const hallazgos = [];
let unidadesMiradas = 0;

for (const ruta of archivos(join(RAIZ, 'functions', 'src'), ['.ts'])) {
  const texto = readFileSync(ruta, 'utf8');
  const unidades = [];

  for (const m of texto.matchAll(/export const ([A-Za-z_$][\w$]*) = on(?:Call|Schedule)\(/g)) {
    const flecha = texto.indexOf('=>', m.index);
    if (flecha !== -1) unidades.push([m[1], bloque(texto, flecha)]);
  }
  for (const m of texto.matchAll(/(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g)) {
    unidades.push([m[1], bloque(texto, texto.indexOf(')', m.index))]);
  }

  for (const [nombre, real] of unidades) {
    if (real === null) continue;
    unidadesMiradas += 1;

    const vistos = new Map();
    const recoger = (cuerpo, prefijo = '', profundidad = 0) => {
      for (const { clave, valor } of segmentos(cuerpo)) {
        if (ABRE_OBJETO.test(valor) && profundidad < 2) {
          const dentro = bloque(valor, valor.indexOf(':'));
          /*
           * UN OBJETO VACÍO NO SE BAJA, SE ANOTA. `paidBreakReasons: {}` —uno de los seis
           * campos muertos reales— entraba por aquí, se bajaba a un cuerpo sin nada, y
           * salía sin registrar: el chequeo lo dejaba pasar. Lo encontró el control, no
           * la lectura del código.
           */
          if (dentro !== null && segmentos(dentro.cuerpo).length > 0) {
            recoger(dentro.cuerpo, `${prefijo}${clave}.`, profundidad + 1);
            continue;
          }
        }
        const llave = prefijo + clave;
        const lista = vistos.get(llave) ?? [];
        lista.push(valor);
        vistos.set(llave, lista);
      }
    };

    for (const r of real.cuerpo.matchAll(/\breturn\s*\{/g)) {
      const b = bloque(real.cuerpo, r.index + r[0].length - 1);
      if (b !== null) recoger(b.cuerpo);
    }
    for (const r of real.cuerpo.matchAll(/\.(?:set|create|update|add)\(\s*\{/g)) {
      const b = bloque(real.cuerpo, r.index + r[0].length - 1);
      if (b !== null) recoger(b.cuerpo);
    }

    for (const [clave, valores] of vistos) {
      const literales = valores.map((v) => LITERAL_FIJO.exec(v)?.[1]);
      if (literales.some((l) => l === undefined)) continue;
      if (new Set(literales).size !== 1) continue;

      const id = `${nombre}.${clave}`;
      if (FIJOS_A_PROPOSITO.has(id)) continue;
      hallazgos.push({ id, literal: literales[0], archivo: ruta.split('/').slice(-1)[0] });
    }
  }
}

console.log(`unidades miradas: ${unidadesMiradas}`);
console.log(`fijos declarados a proposito: ${FIJOS_A_PROPOSITO.size}`);

if (hallazgos.length === 0) {
  console.log('\nNingun campo nuevo nace con un valor fijo sin explicacion.');
  process.exit(0);
}

console.log(`\n${hallazgos.length} campo(s) que siempre valen lo mismo:`);
for (const h of hallazgos) {
  console.log(`  - ${h.id} = ${h.literal}   (${h.archivo})`);
}
console.log(
  '\nO lo llena alguien y este chequeo tiene razon, o es fijo a proposito y hay que\n' +
    'anadirlo a FIJOS_A_PROPOSITO en scripts/campos-muertos-check.mjs CON SU RAZON.',
);
process.exit(1);
