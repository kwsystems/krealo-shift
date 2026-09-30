import {
  addDaysToKey,
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  localDateTimeToInstant,
  weekDays,
  weekEnd,
  weekStartOfKey,
  type DateKey,
} from '@/features/schedules/week';

/**
 * EL PERIODO DE REPORTES: un día, una semana, un mes o los días que se elijan.
 *
 * Lo pidió Andree el 29-sep: «está bien por semana, pero también necesito algo por mes,
 * porque todo es por meses». El reporte entero se calcula sobre este periodo —totales,
 * personas, puntualidad, extras, pausas y lo que se comparte—, así que la pantalla solo
 * cambia de dónde saca sus fechas.
 *
 * El mes es el mes CIVIL en la zona de la sede —del día 1 al último—, no «las últimas
 * cuatro semanas»: es como se lleva una planilla y como se paga un bono de asistencia.
 */

export type TipoDePeriodo = 'dia' | 'semana' | 'mes' | 'dias';

/**
 * «POR DÍA O VARIOS DÍAS O CIERTOS DÍAS EN ESPECÍFICO» (Andree, 30-sep).
 *
 * `dia` es un día y se navega como la semana, de uno en uno. `dias` son los que se eligen
 * en el calendario, seguidos o sueltos: «los sábados de septiembre» es un periodo tan
 * legítimo como «del 1 al 15».
 *
 * Con días sueltos las consultas piden del primero al último —Firestore no pregunta por
 * una lista de fechas sueltas— y la pantalla se queda solo con las filas de los elegidos
 * (`soloLosDias`). Así todo el reporte —totales, ranking, puntualidad, pausas, extras,
 * correcciones y lo que se comparte— habla de esos días y de ninguno más.
 */

export type Periodo = {
  tipo: TipoDePeriodo;
  from: DateKey;
  to: DateKey;
  /** Los días del periodo, en orden. Con días sueltos, SOLO los elegidos. */
  dias: DateKey[];
  /** Si `dias` va sin huecos de `from` a `to`. Con huecos, hay que filtrar las filas. */
  seguidos: boolean;
  /** Instantes para las consultas: del primer día a las 00:00 al día siguiente del último. */
  fromISO: string;
  toISO: string;
};

function rango(from: DateKey, to: DateKey, timezone: string) {
  return {
    fromISO: localDateTimeToInstant(from, '00:00', timezone) ?? new Date(0).toISOString(),
    toISO:
      localDateTimeToInstant(addDaysToKey(to, 1), '00:00', timezone) ?? new Date(0).toISOString(),
  };
}

/** Último día de un mes: el día 0 del siguiente. */
function diasDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodoDe(params: {
  tipo: TipoDePeriodo;
  /** 0 es el actual; -1 el anterior. */
  offset: number;
  nowISO: string;
  weekStartsOn: number;
  timezone: string;
}): Periodo {
  const { tipo, offset, nowISO, weekStartsOn, timezone } = params;

  if (tipo === 'dia' || tipo === 'dias') {
    // Sin días elegidos, `dias` es un solo día: el de hoy más el desplazamiento.
    const dia = addDaysToKey(dateKeyOf(nowISO, timezone), offset);
    return { tipo, from: dia, to: dia, dias: [dia], seguidos: true, ...rango(dia, dia, timezone) };
  }

  if (tipo === 'semana') {
    const from = addWeeks(currentWeekStart(nowISO, weekStartsOn, timezone), offset);
    const to = weekEnd(from);
    return { tipo, from, to, dias: weekDays(from), seguidos: true, ...rango(from, to, timezone) };
  }

  const hoy = dateKeyOf(nowISO, timezone);
  const indice = Number(hoy.slice(0, 4)) * 12 + (Number(hoy.slice(5, 7)) - 1) + offset;
  const year = Math.floor(indice / 12);
  const month = (indice % 12) + 1;
  const mm = String(month).padStart(2, '0');
  const ultimo = diasDelMes(year, month);
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(ultimo).padStart(2, '0')}`;
  const dias = Array.from({ length: ultimo }, (_, i) => addDaysToKey(from, i));
  return { tipo, from, to, dias, seguidos: true, ...rango(from, to, timezone) };
}

/**
 * Lo más largo que puede abarcar una elección de días, del primero al último: tres meses.
 *
 * Las consultas piden del primero al último aunque se elijan tres días sueltos, así que lo
 * que cuesta es la distancia y no cuántos se marquen. Tres meses es un trimestre, lo más
 * largo que alguien compara en una tienda, y lo que la pantalla mueve sin esperar.
 */
export const DIAS_MAXIMOS = 93;

/** Cuántos días hay del primero al último, contando los dos. */
export function diasDeDistancia(desde: DateKey, hasta: DateKey): number {
  return (
    Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) +
    1
  );
}

/** El periodo de unos días elegidos en el calendario, seguidos o sueltos. */
export function periodoDeDias(elegidos: readonly DateKey[], timezone: string): Periodo | null {
  const dias = [...new Set(elegidos)].filter((dia) => /^\d{4}-\d{2}-\d{2}$/.test(dia)).sort();
  if (dias.length === 0) return null;
  const from = dias[0]!;
  const to = dias[dias.length - 1]!;
  return {
    tipo: 'dias',
    from,
    to,
    dias,
    seguidos: diasDeDistancia(from, to) === dias.length,
    ...rango(from, to, timezone),
  };
}

/** Todos los días de un tramo, los dos extremos incluidos y en cualquier orden. */
export function diasEntre(a: DateKey, b: DateKey): DateKey[] {
  const [desde, hasta] = a <= b ? [a, b] : [b, a];
  const n = diasDeDistancia(desde, hasta);
  return Array.from({ length: n }, (_, i) => addDaysToKey(desde, i));
}

export type SemanaDelMes = { inicio: DateKey; fin: DateKey; dias: DateKey[] };

/**
 * Las semanas de un mes, recortadas al mes. La primera y la última suelen ir a medias
 * —el 1 cae en miércoles—, y se recortan a propósito: sumar los días de agosto en la
 * semana del 1 de septiembre haría que el mes dijera horas que no son suyas.
 */
export function semanasDelMes(dias: readonly DateKey[], weekStartsOn: number): SemanaDelMes[] {
  const semanas = new Map<DateKey, DateKey[]>();
  for (const dia of dias) {
    const clave = weekStartOfKey(dia, weekStartsOn);
    semanas.set(clave, [...(semanas.get(clave) ?? []), dia]);
  }
  return [...semanas.values()].map((diasDeLaSemana) => ({
    inicio: diasDeLaSemana[0]!,
    fin: diasDeLaSemana[diasDeLaSemana.length - 1]!,
    dias: diasDeLaSemana,
  }));
}

/**
 * Las filas de los días elegidos. `dias` va como TEXTO —los días separados por comas, o
 * `null` si son seguidos y no hay nada que quitar— para que la pantalla lo pueda poner en
 * las dependencias de un `useMemo`: dos elecciones iguales son el mismo texto, y un `Set`
 * nuevo en cada render haría recalcular todo el tablero en cada render.
 */
export function soloLosDias<T>(
  filas: readonly T[],
  dias: string | null,
  diaDe: (fila: T) => DateKey,
): T[] {
  if (dias === null) return [...filas];
  const elegidos = new Set(dias.split(','));
  return filas.filter((fila) => elegidos.has(diaDe(fila)));
}
