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
 * EL PERIODO DE REPORTES: una semana o un mes.
 *
 * Lo pidió Andree el 29-sep: «está bien por semana, pero también necesito algo por mes,
 * porque todo es por meses». El reporte entero se calcula sobre este periodo —totales,
 * personas, puntualidad, extras, pausas y lo que se comparte—, así que la pantalla solo
 * cambia de dónde saca sus fechas.
 *
 * El mes es el mes CIVIL en la zona de la sede —del día 1 al último—, no «las últimas
 * cuatro semanas»: es como se lleva una planilla y como se paga un bono de asistencia.
 */

export type TipoDePeriodo = 'semana' | 'mes';

export type Periodo = {
  tipo: TipoDePeriodo;
  from: DateKey;
  to: DateKey;
  /** Todos los días del periodo, en orden. */
  dias: DateKey[];
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

  if (tipo === 'semana') {
    const from = addWeeks(currentWeekStart(nowISO, weekStartsOn, timezone), offset);
    const to = weekEnd(from);
    return { tipo, from, to, dias: weekDays(from), ...rango(from, to, timezone) };
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
  return { tipo, from, to, dias, ...rango(from, to, timezone) };
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
