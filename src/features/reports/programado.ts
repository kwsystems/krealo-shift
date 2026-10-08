import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import { turnoEnPie } from '@/features/schedules/turno-en-pie';

/**
 * LO PROGRAMADO DEL PERIODO, para compararlo con lo trabajado (2-oct).
 *
 * Es lo primero que enseña Homebase en sus reportes —«scheduled vs actual hours at a
 * glance»— y lo que le faltaba a esta pantalla: «140 horas» no dice si es mucho o poco
 * hasta que se pone al lado de las 168 que se programaron. Y explica el primer día del
 * mes, el que se veía vacío: «00:00 trabajadas» asusta; «00:00 de 8:00 programadas hasta
 * ahora, 3 personas dentro» es lo que está pasando.
 *
 * QUÉ CUENTA COMO PROGRAMADO: los turnos PUBLICADOS del periodo —un borrador no se le dio a
 * nadie—, cada uno con su duración menos el refrigerio que lleva planificado. Es la misma
 * cuenta que «Faltan horas» en Horas (`casos.ts`): lo que se esperaba que trabajara.
 *
 * «HASTA AHORA» es la parte de lo programado que ya tendría que estar hecha: los turnos
 * que terminaron enteros, y del que está en curso la fracción que va pasando. Comparar lo
 * trabajado con lo programado del mes ENTERO el día 3 diría que todo el mundo va por el
 * 10 %, y es mentira: van al día.
 *
 * PURA, para poder probar cada caso sin pantalla delante.
 */

export type Programado = {
  /** Lo de todo el periodo. */
  total: number;
  /** Lo que ya debería estar trabajado a esta hora. */
  hastaAhora: number;
};

const MIN = 60_000;

/** Los minutos que se esperaban de un turno: su duración menos el refrigerio planificado. */
export function minutosDelTurno(
  turno: Pick<ShiftRow, 'starts_at' | 'ends_at' | 'planned_unpaid_break_minutes'>,
): number {
  const bruto = Math.round((Date.parse(turno.ends_at) - Date.parse(turno.starts_at)) / MIN);
  return Math.max(0, bruto - Math.max(0, turno.planned_unpaid_break_minutes));
}

/** De esos, los que ya tendrían que estar hechos a esta hora. */
export function minutosHastaAhora(
  turno: Pick<ShiftRow, 'starts_at' | 'ends_at' | 'planned_unpaid_break_minutes'>,
  ahora: number,
): number {
  const inicio = Date.parse(turno.starts_at);
  const fin = Date.parse(turno.ends_at);
  const total = minutosDelTurno(turno);
  if (ahora >= fin) return total;
  if (ahora <= inicio || fin <= inicio) return 0;
  // A medio turno: la parte que va pasando, con el refrigerio repartido por igual.
  return Math.round((total * (ahora - inicio)) / (fin - inicio));
}

export type ProgramadoDelPeriodo = Programado & {
  porDia: Map<DateKey, Programado>;
  porPersona: Map<string, Programado>;
};

export function programadoDelPeriodo(params: {
  turnos: readonly ShiftRow[];
  /** Los días que se miran: con «Elegir días», solo los elegidos. */
  dias: readonly DateKey[];
  ahoraISO: string;
  timezone: string;
}): ProgramadoDelPeriodo {
  const ahora = Date.parse(params.ahoraISO);
  const dias = new Set(params.dias);
  const resultado: ProgramadoDelPeriodo = {
    total: 0,
    hastaAhora: 0,
    porDia: new Map(),
    porPersona: new Map(),
  };
  const sumar = (mapa: Map<string, Programado>, clave: string, total: number, hasta: number) => {
    const antes = mapa.get(clave) ?? { total: 0, hastaAhora: 0 };
    mapa.set(clave, { total: antes.total + total, hastaAhora: antes.hastaAhora + hasta });
  };

  for (const turno of params.turnos) {
    if (!turnoEnPie(turno)) continue;
    const dia = dateKeyOf(turno.starts_at, params.timezone);
    if (!dias.has(dia)) continue;
    const total = minutosDelTurno(turno);
    const hasta = minutosHastaAhora(turno, ahora);
    resultado.total += total;
    resultado.hastaAhora += hasta;
    sumar(resultado.porDia, dia, total, hasta);
    sumar(resultado.porPersona, turno.employee_id, total, hasta);
  }
  return resultado;
}
