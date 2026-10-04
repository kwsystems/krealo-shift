import type { DiaDelVendedor } from './resumen';
import type { ShiftRow } from '@/features/schedules/api';
import type { WorkSession } from '@/features/timesheets/api';
import { cubreElTurno, turnoSinLlegar } from '@/features/timesheets/faltas';

/**
 * QUÉ LE PASA HOY A QUIEN MIRA SU CELULAR, en una sola respuesta.
 *
 * Vivía dentro de la tarjeta «Hoy» y fallaba en tres casos (auditoría, 4-oct):
 *
 * 1. PASADA LA MEDIANOCHE. A las 00:30 de un turno 18:00–01:00 la jornada abierta es de
 *    AYER, y la tarjeta solo miraba las de hoy: a quien estaba trabajando le decía «Hoy es
 *    tu día libre». Por eso la jornada abierta llega aparte, de cualquier día.
 * 2. TURNO PARTIDO. Solo miraba el primer turno: hecha la mañana, decía «Hoy trabajaste
 *    4 h» y callaba que a las 17:00 le tocaba volver, o que ya era la hora y no había
 *    marcado.
 * 3. LA TOLERANCIA. «No has marcado» salía en rojo desde el minuto 0, cuando Inicio y
 *    Horario esperan los minutos de tolerancia de la sede antes de decir «No ha llegado».
 *    Ahora es la misma regla, `turnoSinLlegar`, con la misma tolerancia.
 */
export type SituacionDeHoy =
  | { tipo: 'enDescanso'; jornada: WorkSession }
  | { tipo: 'trabajando'; jornada: WorkSession }
  /** Empezó un turno suyo, pasó la tolerancia y no ha marcado: el «No ha llegado» de Inicio. */
  | { tipo: 'sinLlegar'; turno: ShiftRow }
  /** Empezó hace menos que la tolerancia: todavía no es tarde. */
  | { tipo: 'empezando'; turno: ShiftRow }
  /** Trabajó y le queda otro turno hoy, que aún no empieza. */
  | { tipo: 'siguiente'; turno: ShiftRow }
  /** Trabajó y ya no le queda nada hoy. `faltas`: los turnos de hoy que no vino. */
  | { tipo: 'terminado'; faltas: ShiftRow[] }
  | { tipo: 'falta'; faltas: ShiftRow[]; justificada: boolean; siguiente: ShiftRow | null }
  /** Su turno ya terminó sin marca, y todavía no se sabe si es falta (antes del reloj). */
  | { tipo: 'sinMarca' }
  | { tipo: 'porConfirmar'; turno: ShiftRow }
  | { tipo: 'libre' }
  | { tipo: 'porVenir'; turno: ShiftRow };

export function situacionDeHoy(params: {
  dia: DiaDelVendedor;
  /** La jornada que tiene abierta ahora, sea del día que sea: ver el caso 1. */
  abierta: WorkSession | undefined;
  enDescanso: boolean;
  nowISO: string;
  /** La de su sede, la misma que usan Inicio y Horario. */
  toleranciaMin: number;
}): SituacionDeHoy {
  const { dia, abierta, enDescanso, nowISO, toleranciaMin } = params;
  if (abierta !== undefined) {
    return enDescanso
      ? { tipo: 'enDescanso', jornada: abierta }
      : { tipo: 'trabajando', jornada: abierta };
  }

  const ahora = Date.parse(nowISO);
  const turnos = dia.turnos;
  const siguiente = turnos.find((t) => Date.parse(t.starts_at) > ahora) ?? null;

  const sinLlegar = turnos.find((turno) =>
    turnoSinLlegar({ turno, jornadas: dia.jornadas, ahoraISO: nowISO, toleranciaMin }),
  );
  if (sinLlegar !== undefined) return { tipo: 'sinLlegar', turno: sinLlegar };

  /*
   * EMPEZÓ, PERO AÚN DENTRO DE LA TOLERANCIA, y sin marca que lo cubra. Se mira el turno en
   * curso y no el primero: en un turno partido, la mañana ya trabajada no cubre la tarde.
   */
  const empezando =
    turnos.find(
      (t) =>
        Date.parse(t.starts_at) <= ahora &&
        ahora < Date.parse(t.ends_at) &&
        !cubreElTurno(t, dia.jornadas, ahora),
    ) ?? null;

  if (dia.jornadas.length > 0) {
    if (empezando !== null) return { tipo: 'empezando', turno: empezando };
    if (siguiente !== null) return { tipo: 'siguiente', turno: siguiente };
    return { tipo: 'terminado', faltas: dia.faltas };
  }

  if (turnos.length === 0) {
    const cambiando = dia.porConfirmar[0];
    return cambiando === undefined ? { tipo: 'libre' } : { tipo: 'porConfirmar', turno: cambiando };
  }

  if (dia.faltas.length > 0) {
    return {
      tipo: 'falta',
      faltas: dia.faltas,
      justificada: dia.estado === 'faltaJustificada',
      siguiente: empezando ?? siguiente,
    };
  }
  if (empezando !== null) return { tipo: 'empezando', turno: empezando };
  if (siguiente === null) return { tipo: 'sinMarca' };
  return { tipo: 'porVenir', turno: siguiente };
}
