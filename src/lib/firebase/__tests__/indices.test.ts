import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * CADA CONSULTA QUE NECESITA ÍNDICE COMPUESTO LO TIENE DECLARADO.
 *
 * POR QUÉ EXISTE. El emulador de Firestore NO exige índices: una consulta sin su índice
 * funciona en todas las pruebas y en la demostración, y falla SOLO en producción, con
 * «The query requires an index». Así cayó Inicio en San Miguel el 29-sep: la vista de
 * «quién está dentro» ordenaba los eventos por `occurred_at` descendente, el índice que
 * hay en esa dirección lleva además `seq`, y Firestore no usa un índice con un campo de
 * orden de más. Solo fallaba con alguien dentro, así que en Asia —sin nadie— no pasaba.
 *
 * Y de paso se vio que producción tenía cinco índices que este archivo no declaraba:
 * alguien los creó a mano desde el enlace del error. Funcionaban, pero nada impedía que
 * un despliegue de índices los quitara.
 *
 * QUÉ HACE: lee las consultas del servidor (`.collection(...).where().orderBy()`) y del
 * cliente (`.from(TABLES.x).eq().gte().order()`), deduce el índice que pide cada una con
 * las reglas de Firestore, y lo busca en `firestore.indexes.json`. No es un analizador de
 * TypeScript: lee cadenas de métodos, que es como están escritas todas las consultas de
 * este proyecto. Una consulta armada en varios pasos (`q = q.where(...)`) no la vería.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');

type Campo = { campo: string; orden: 'ASCENDING' | 'DESCENDING' };
type Consulta = {
  archivo: string;
  linea: number;
  coleccion: string;
  iguales: string[];
  rangos: string[];
  orden: Campo[];
};

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '__tests__' || nombre === 'lib') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** `timeEvents: 'time_events'` → Map de nombre de constante a nombre de colección. */
function nombres(archivo: string, constante: string): Map<string, string> {
  const texto = readFileSync(join(RAIZ, archivo), 'utf8');
  const bloque = texto.slice(texto.indexOf(`export const ${constante}`));
  const fin = bloque.indexOf('}');
  const map = new Map<string, string>();
  for (const m of bloque.slice(0, fin).matchAll(/(\w+):\s*'([^']+)'/g)) map.set(m[1]!, m[2]!);
  return map;
}

/**
 * La cadena de métodos que empieza en la línea `i`: sigue mientras la línea siguiente
 * empiece por `.` o queden paréntesis abiertos (un `.select(` partido en varias líneas).
 */
function cadenaDesde(lineas: string[], i: number): string {
  let texto = '';
  let abiertos = 0;
  for (let j = i; j < lineas.length; j += 1) {
    const linea = lineas[j]!;
    if (j > i && abiertos === 0 && !linea.trim().startsWith('.')) break;
    texto += `${linea}\n`;
    for (const c of linea) {
      if (c === '(') abiertos += 1;
      if (c === ')') abiertos -= 1;
    }
  }
  return texto;
}

function consultas(): Consulta[] {
  const colecciones = nombres('functions/src/shared/admin.ts', 'COLLECTIONS');
  const tablas = nombres('src/lib/firebase/tables.ts', 'TABLES');
  const salida: Consulta[] = [];

  const fuentes = [...archivos(join(RAIZ, 'functions', 'src')), ...archivos(join(RAIZ, 'src'))];
  for (const ruta of fuentes) {
    const lineas = readFileSync(ruta, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      const servidor = /\.collection\(COLLECTIONS\.(\w+)\)/.exec(linea);
      const cliente = /\.from\(TABLES\.(\w+)\)/.exec(linea);
      if (servidor === null && cliente === null) return;
      const coleccion = servidor ? colecciones.get(servidor[1]!) : tablas.get(cliente![1]!);
      if (coleccion === undefined) return;

      const cadena = cadenaDesde(lineas, i);
      const iguales: string[] = [];
      const rangos: string[] = [];
      const orden: Campo[] = [];

      if (servidor) {
        for (const m of cadena.matchAll(/\.where\(\s*'(\w+)',\s*'([^']+)'/g)) {
          (['==', 'in', 'array-contains', 'array-contains-any'].includes(m[2]!)
            ? iguales
            : rangos
          ).push(m[1]!);
        }
        for (const m of cadena.matchAll(/\.orderBy\(\s*'(\w+)'(?:,\s*'(asc|desc)')?\s*\)/g)) {
          orden.push({ campo: m[1]!, orden: m[2] === 'desc' ? 'DESCENDING' : 'ASCENDING' });
        }
      } else {
        for (const m of cadena.matchAll(/\.(eq|in|neq|gt|gte|lt|lte)\(\s*'(\w+)'/g)) {
          (m[1] === 'eq' || m[1] === 'in' ? iguales : rangos).push(m[2]!);
        }
        for (const m of cadena.matchAll(
          /\.order\(\s*'(\w+)'(?:,\s*\{\s*ascending:\s*(true|false)\s*\})?/g,
        )) {
          orden.push({ campo: m[1]!, orden: m[2] === 'false' ? 'DESCENDING' : 'ASCENDING' });
        }
      }

      salida.push({
        archivo: relative(RAIZ, ruta),
        linea: i + 1,
        coleccion,
        iguales: [...new Set(iguales)],
        rangos: [...new Set(rangos)],
        orden,
      });
    });
  }
  return salida;
}

/**
 * El índice compuesto que pide una consulta, o `null` si le basta con los simples.
 *
 * Reglas de Firestore que aplica:
 *   - Solo igualdades: se sirven mezclando índices simples. No pide compuesto.
 *   - Un campo de rango sin `orderBy` ordena implícitamente por ese campo, ascendente.
 *   - Un solo campo en total (rango y orden sobre el mismo, sin igualdades): simple.
 *   - Lo demás: igualdades (en cualquier orden) y DESPUÉS los campos de orden, en su orden
 *     y con su dirección. Un índice con un campo de orden de más NO sirve.
 */
function indiceQuePide(c: Consulta): Campo[] | null {
  const orden =
    c.orden.length > 0
      ? c.orden
      : c.rangos.slice(0, 1).map((campo) => ({ campo, orden: 'ASCENDING' as const }));
  if (orden.length === 0) return null;
  const camposDeOrden = new Set([...orden.map((o) => o.campo), ...c.rangos]);
  if (c.iguales.length === 0 && camposDeOrden.size === 1) return null;
  const iguales = c.iguales.filter((campo) => !orden.some((o) => o.campo === campo));
  return [...iguales.map((campo) => ({ campo, orden: 'ASCENDING' as const })), ...orden];
}

type Declarado = { coleccion: string; campos: Campo[] };

function declarados(): Declarado[] {
  const json = JSON.parse(readFileSync(join(RAIZ, 'firestore.indexes.json'), 'utf8')) as {
    indexes: { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }[];
  };
  return json.indexes.map((i) => ({
    coleccion: i.collectionGroup,
    campos: i.fields
      .filter((f) => f.fieldPath !== '__name__' && f.order !== undefined)
      .map((f) => ({ campo: f.fieldPath, orden: f.order as Campo['orden'] })),
  }));
}

function cubre(indice: Declarado, coleccion: string, pedido: Campo[], numIguales: number): boolean {
  if (indice.coleccion !== coleccion || indice.campos.length !== pedido.length) return false;
  const iguales = new Set(pedido.slice(0, numIguales).map((c) => c.campo));
  const prefijo = indice.campos.slice(0, numIguales);
  if (!prefijo.every((c) => iguales.has(c.campo))) return false;
  return pedido.slice(numIguales).every((c, k) => {
    const d = indice.campos[numIguales + k];
    return d !== undefined && d.campo === c.campo && d.orden === c.orden;
  });
}

/**
 * Las consultas armadas en dos pasos, que la lectura de cadenas no ve enteras. Cada una
 * dice qué paso le falta ver y qué índice la cubre de verdad; la clave es archivo,
 * colección y el índice que la prueba cree que pide.
 */
const EXCEPCIONES = new Map<string, string>([
  [
    'src/hooks/use-manager-scope.tsx organization_memberships (status ASC, created_at ASC)',
    'añade `.eq(user_id)` en la línea siguiente; la cubre (user_id, status, created_at ASC)',
  ],
]);

describe('índices compuestos', () => {
  const todas = consultas();
  const indices = declarados();

  it('encuentra las consultas del servidor y del cliente (si no, esta prueba no mide nada)', () => {
    expect(todas.filter((c) => c.archivo.startsWith('functions')).length).toBeGreaterThan(20);
    expect(todas.filter((c) => c.archivo.startsWith('src')).length).toBeGreaterThan(20);
    // La que tumbó Inicio tiene que estar entre ellas.
    expect(
      todas.some((c) => c.archivo === 'functions/src/views.ts' && c.coleccion === 'time_events'),
    ).toBe(true);
  });

  it('cada consulta que pide índice compuesto lo tiene declarado', () => {
    const faltan = todas.flatMap((c) => {
      const pedido = indiceQuePide(c);
      if (pedido === null) return [];
      const numIguales = pedido.length - (c.orden.length > 0 ? c.orden.length : 1);
      const ok = indices.some((i) => cubre(i, c.coleccion, pedido, numIguales));
      const clave = `${c.archivo} ${c.coleccion} (${pedido
        .map((p) => `${p.campo} ${p.orden === 'ASCENDING' ? 'ASC' : 'DESC'}`)
        .join(', ')})`;
      return ok || EXCEPCIONES.has(clave)
        ? []
        : [
            `${c.archivo}:${c.linea} ${c.coleccion} pide (${pedido
              .map((p) => `${p.campo} ${p.orden === 'ASCENDING' ? 'ASC' : 'DESC'}`)
              .join(', ')})`,
          ];
    });
    expect(faltan).toEqual([]);
  });

  it('un índice con un campo de orden de más NO cuenta', () => {
    // La regla que se saltó la vista: (employee_id, occurred_at DESC, seq DESC) no sirve
    // para ordenar solo por occurred_at DESC.
    const pedido: Campo[] = [
      { campo: 'employee_id', orden: 'ASCENDING' },
      { campo: 'occurred_at', orden: 'DESCENDING' },
    ];
    const conSeq: Declarado = {
      coleccion: 'time_events',
      campos: [...pedido, { campo: 'seq', orden: 'DESCENDING' }],
    };
    expect(cubre(conSeq, 'time_events', pedido, 1)).toBe(false);
    expect(cubre({ coleccion: 'time_events', campos: pedido }, 'time_events', pedido, 1)).toBe(
      true,
    );
  });
});
