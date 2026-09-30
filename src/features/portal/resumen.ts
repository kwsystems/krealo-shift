import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import { sesionDelTurno } from '@/features/reports/bono';
import type { WorkSession } from '@/features/timesheets/api';

/**
 * LO QUE VE EL VENDEDOR, día por día y en el mes, a partir de sus turnos y sus jornadas.
 *
 * «Tarde» es la MISMA marca que usa el resto de la app —`late_arrival`, pasada la tolerancia
 * de la sede—: si aquí se calculara por su cuenta, el vendedor vería «a tiempo» un día que
 * el panel marca como tarde, y la conversación sobre el bono empezaría con dos verdades.
 *
 * «Antes de hora» es lo único que se calcula aquí: el panel no lo marca porque no es un
 * problema, pero Andree pidió que cada uno vea si llegó temprano.
 *
 * LO QUE NO SE DICE: «faltó». Con solo sus propios datos no se sabe si ese día el reloj de
 * la tienda funcionaba —el bono lo mira comparando con el resto del equipo, que el vendedor
 * no ve—. Así que un turno pasado sin marca se dice como lo que es, «sin marca», y quien lo
 * explica es quien administra.
 */

export type EstadoDelDia =
  /** Sin turno ese día. */
  | 'libre'
  /** Turno que aún no llegó. */
  | 'porVenir'
  /** Hoy, dentro o antes del turno, sin haber marcado todavía. */
  | 'hoy'
  /** Marcó y entró a tiempo (o antes). */
  | 'aTiempo'
  /** Marcó con «Entrada tardía». */
  | 'tarde'
  /** Está trabajando ahora mismo. */
  | 'enCurso'
  /** Turno terminado sin ninguna jornada. */
  | 'sinMarca';

export type DiaDelVendedor = {
  dia: DateKey;
  turnos: ShiftRow[];
  jornadas: WorkSession[];
  estado: EstadoDelDia;
  /** Minutos que entró antes de la hora del turno, si fue antes. */
  minutosAntes: number | null;
  /** Minutos netos trabajados ese día, con lo que lleva si sigue dentro. */
  minutosNetos: number;
};

const MIN = 60 * 1000;

/** Minutos netos de una jornada; si sigue abierta, lo que lleva hasta ahora. */
export function minutosDeLaJornada(jornada: WorkSession, nowISO: string): number {
  if (jornada.ends_at !== null) return jornada.net_minutes ?? 0;
  const bruto = Math.max(0, Math.round((Date.parse(nowISO) - Date.parse(jornada.starts_at)) / MIN));
  return Math.max(0, bruto - (jornada.unpaid_break_minutes ?? 0));
}

export function diasDelVendedor(params: {
  dias: DateKey[];
  turnos: readonly ShiftRow[];
  jornadas: readonly WorkSession[];
  timezone: string;
  nowISO: string;
}): DiaDelVendedor[] {
  const { dias, turnos, jornadas, timezone, nowISO } = params;
  const ahora = Date.parse(nowISO);
  const hoy = dateKeyOf(nowISO, timezone);

  return dias.map((dia) => {
    const suyos = turnos
      .filter((t) => t.status === 'published' && dateKeyOf(t.starts_at, timezone) === dia)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const delDia = jornadas
      .filter((j) => dateKeyOf(j.starts_at, timezone) === dia)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const minutosNetos = delDia.reduce((suma, j) => suma + minutosDeLaJornada(j, nowISO), 0);

    const primerTurno = suyos[0];
    const primeraJornada =
      primerTurno === undefined ? delDia[0] : (sesionDelTurno(primerTurno, delDia) ?? delDia[0]);

    let minutosAntes: number | null = null;
    if (primerTurno !== undefined && primeraJornada !== undefined) {
      const antes = Math.round(
        (Date.parse(primerTurno.starts_at) - Date.parse(primeraJornada.starts_at)) / MIN,
      );
      minutosAntes = antes > 0 ? antes : null;
    }

    const estado = ((): EstadoDelDia => {
      if (delDia.some((j) => j.ends_at === null)) return 'enCurso';
      if (primeraJornada !== undefined) {
        return primeraJornada.flags.includes('late_arrival') ? 'tarde' : 'aTiempo';
      }
      if (primerTurno === undefined) return 'libre';
      if (Date.parse(primerTurno.ends_at) <= ahora) return 'sinMarca';
      return dia === hoy ? 'hoy' : 'porVenir';
    })();

    return { dia, turnos: suyos, jornadas: delDia, estado, minutosAntes, minutosNetos };
  });
}

export type ResumenDelMes = {
  minutosNetos: number;
  diasTrabajados: number;
  aTiempo: number;
  /** De los a tiempo, cuántos entró antes de la hora. */
  antesDeHora: number;
  tarde: number;
  sinMarca: number;
};

export function resumenDelMes(dias: readonly DiaDelVendedor[]): ResumenDelMes {
  return {
    minutosNetos: dias.reduce((suma, d) => suma + d.minutosNetos, 0),
    diasTrabajados: dias.filter((d) => d.jornadas.length > 0).length,
    aTiempo: dias.filter((d) => d.estado === 'aTiempo').length,
    antesDeHora: dias.filter((d) => d.estado === 'aTiempo' && d.minutosAntes !== null).length,
    tarde: dias.filter((d) => d.estado === 'tarde').length,
    sinMarca: dias.filter((d) => d.estado === 'sinMarca').length,
  };
}
