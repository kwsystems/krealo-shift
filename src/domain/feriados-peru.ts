/**
 * LOS FERIADOS NACIONALES DEL PERÚ, calculados para cualquier año (30-sep).
 *
 * POR QUÉ EXISTE. Andree: «reconoce también los feriados peruanos, porque es importante,
 * y siempre: para los vendedores cuando ven su horario y para nosotros en el panel». Lo
 * es por dos razones: quien arma el horario tiene que verlos al armarlo, y quien trabaja
 * un feriado cobra la jornada más un 100 % (D.L. 713), así que quien paga necesita saber
 * qué horas cayeron en uno.
 *
 * QUÉ LISTA. Los 16 del D.L. 713 con sus modificatorias, que son los que obligan también
 * al sector privado, comprobados contra el calendario oficial de 2026 (ver la prueba).
 * Catorce caen siempre en la misma fecha; Jueves y Viernes Santo se mueven con la Pascua,
 * y por eso se CALCULAN y no se copian de una tabla: una tabla habría que acordarse de
 * rellenarla cada año, y el año que nadie se acuerde los feriados desaparecen sin aviso.
 *
 * LO QUE NO ESTÁ, a propósito: los «días no laborables» que decreta el Ejecutivo (en 2026,
 * el 2 de enero y el 27 de julio). Son para el sector público; en una tienda los decide el
 * empleador, y se decretan de un año a otro sin fecha fija, así que una lista de ellos
 * estaría incompleta en cuanto saliera un decreto nuevo.
 *
 * SOLO PARA SEDES DEL PERÚ: se reconocen por su zona horaria. Una sede en otra zona no
 * tiene los feriados del Perú, y marcárselos sería peor que no marcar nada.
 */

export const FERIADOS_PERU = [
  'anioNuevo',
  'juevesSanto',
  'viernesSanto',
  'trabajo',
  'bandera',
  'sanPedro',
  'fuerzaAerea',
  'fiestasPatrias',
  'junin',
  'santaRosa',
  'angamos',
  'todosLosSantos',
  'inmaculada',
  'ayacucho',
  'navidad',
] as const;

export type ClaveDeFeriado = (typeof FERIADOS_PERU)[number];

/** [mes, día, feriado]. Fiestas Patrias son dos días con el mismo nombre. */
const FIJOS: readonly [number, number, ClaveDeFeriado][] = [
  [1, 1, 'anioNuevo'],
  [5, 1, 'trabajo'],
  [6, 7, 'bandera'],
  [6, 29, 'sanPedro'],
  [7, 23, 'fuerzaAerea'],
  [7, 28, 'fiestasPatrias'],
  [7, 29, 'fiestasPatrias'],
  [8, 6, 'junin'],
  [8, 30, 'santaRosa'],
  [10, 8, 'angamos'],
  [11, 1, 'todosLosSantos'],
  [12, 8, 'inmaculada'],
  [12, 9, 'ayacucho'],
  [12, 25, 'navidad'],
];

/** Las zonas horarias del Perú. Hoy solo hay una; se deja como lista por claridad. */
const ZONAS_DEL_PERU = new Set(['America/Lima']);

function clave(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Domingo de Pascua (algoritmo gregoriano anónimo, «de Meeus/Jones/Butcher»). */
export function domingoDePascua(anio: number): { mes: number; dia: number } {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

const porAnio = new Map<number, Map<string, ClaveDeFeriado>>();

/** Los feriados de un año: «2026-10-08» → 'angamos'. */
export function feriadosDelAnio(anio: number): Map<string, ClaveDeFeriado> {
  const guardado = porAnio.get(anio);
  if (guardado !== undefined) return guardado;

  const mapa = new Map<string, ClaveDeFeriado>();
  for (const [mes, dia, nombre] of FIJOS) mapa.set(clave(anio, mes, dia), nombre);

  // Jueves y Viernes Santo: tres y dos días antes del domingo de Pascua. En UTC y a
  // mediodía, para que ningún cambio de hora mueva el día.
  const pascua = domingoDePascua(anio);
  const domingo = Date.UTC(anio, pascua.mes - 1, pascua.dia, 12);
  for (const [antes, nombre] of [
    [3, 'juevesSanto'],
    [2, 'viernesSanto'],
  ] as const) {
    const fecha = new Date(domingo - antes * 86400000);
    mapa.set(clave(anio, fecha.getUTCMonth() + 1, fecha.getUTCDate()), nombre);
  }

  porAnio.set(anio, mapa);
  return mapa;
}

/**
 * El feriado de un día en una sede, o `null`. `dateKey` es el día del calendario de la
 * sede («2026-10-08»), el mismo que usan la rejilla y las hojas de horas.
 */
export function feriadoDe(dateKey: string, zona: string): ClaveDeFeriado | null {
  if (!ZONAS_DEL_PERU.has(zona)) return null;
  const anio = Number(dateKey.slice(0, 4));
  if (!Number.isInteger(anio)) return null;
  return feriadosDelAnio(anio).get(dateKey) ?? null;
}
