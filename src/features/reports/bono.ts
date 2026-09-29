import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import type { WorkSession } from '@/features/timesheets/api';

/**
 * EL BONO DE ASISTENCIA DEL MES.
 *
 * Lo pidió Andree el 29-sep: «la gente que llega temprano y nunca falta todo el mes gana
 * el bono de asistencia; que funcione siempre que tengan todo un mes completo y bien».
 *
 * LA REGLA, dicha en la pantalla con estas mismas palabras:
 *   - Lo GANA quien, en TODOS sus turnos publicados del mes, fichó (no faltó) y entró a
 *     tiempo. «A tiempo» es la misma marca que usa toda la app —«Entrada tardía» sale
 *     pasada la tolerancia de la sede—: dos definiciones de tarde acabarían dando el bono
 *     a quien Horas marca como tarde.
 *   - Solo con el MES COMPLETO: quien entró a trabajar después del día 1 no aplica ese mes.
 *   - Mientras el mes no termina, nadie lo ha ganado todavía: «va por el bono». Un turno
 *     que aún no acabó no cuenta ni a favor ni en contra.
 *
 * Los días de descanso no son turnos y no cuentan; los turnos cancelados o sin publicar,
 * tampoco: nadie falta a un turno que no se le llegó a dar.
 *
 * NI LOS DÍAS EN QUE NADIE FICHÓ EN LA TIENDA. Un día con turnos y sin un solo fichaje de
 * nadie casi nunca es que faltaron todos: es que el reloj no se usó —antes de empezar a
 * usar la app, un iPad averiado, la tienda cerrada—. Contarlo como falta le quitaría el
 * bono a todo el equipo por algo que no hizo nadie. Se excluye, y la pantalla dice qué
 * días. Así pasó con septiembre de 2026: el reloj empezó el 29, y sin esto el lunes 28
 * habría dejado a todo el equipo sin bono.
 *
 * Es UNA PROPUESTA para quien paga, no un pago: la pantalla lo dice. Quien decide el bono
 * puede tener en cuenta cosas que la app no ve —un permiso avisado, un médico—.
 */

export type EstadoDelBono = 'gana' | 'enCamino' | 'pierde' | 'noAplica';

export type ResultadoDelBono = {
  employeeId: string;
  estado: EstadoDelBono;
  /** Turnos del mes que ya terminaron: los únicos que cuentan. */
  turnosContados: number;
  /** De esos, a los que fichó y llegó a tiempo. */
  cumplidos: number;
  /** Días (de la sede) de los turnos a los que no fichó. */
  faltas: DateKey[];
  /** Días de los turnos a los que llegó tarde. */
  tardanzas: DateKey[];
  /** Por qué no aplica, si no aplica. */
  motivoNoAplica: 'ingresoEnElMes' | null;
  /** Fecha de alta, si por ella no aplica. */
  ingreso: string | null;
};

export type EmpleadoDelBono = {
  id: string;
  status: string;
  hire_date: string | null;
};

/** Margen para asociar una jornada sin turno a un turno: quien entra un rato antes. */
const MARGEN_ANTES_MS = 2 * 60 * 60 * 1000;

function sesionDelTurno(turno: ShiftRow, sesiones: readonly WorkSession[]): WorkSession | null {
  const porTurno = sesiones.find((s) => s.shift_id === turno.id);
  if (porTurno !== undefined) return porTurno;
  /*
   * SIN `shift_id`, POR HORA: el reloj no siempre sabe a qué turno pertenece una entrada
   * —porque se publicó después, o porque se fichó sin turno—. Una jornada de esa persona
   * que empieza dentro del turno, o poco antes, es la de ese turno.
   */
  const inicio = Date.parse(turno.starts_at) - MARGEN_ANTES_MS;
  const fin = Date.parse(turno.ends_at);
  return (
    sesiones.find((s) => {
      if (s.employee_id !== turno.employee_id || s.shift_id !== null) return false;
      const entrada = Date.parse(s.starts_at);
      return entrada >= inicio && entrada < fin;
    }) ?? null
  );
}

export type BonoDelMes = {
  resultados: ResultadoDelBono[];
  /** Días con turnos en que nadie fichó en la tienda: no cuentan para nadie. */
  diasSinReloj: DateKey[];
};

export function bonoDeAsistencia(params: {
  turnos: readonly ShiftRow[];
  sesiones: readonly WorkSession[];
  empleados: readonly EmpleadoDelBono[];
  /** Primer día del mes (`YYYY-MM-01`) e instante en que termina. */
  desde: DateKey;
  finISO: string;
  nowISO: string;
  timezone: string;
}): BonoDelMes {
  const { turnos, sesiones, empleados, desde, finISO, nowISO, timezone } = params;
  const ahora = Date.parse(nowISO);
  const mesTerminado = ahora >= Date.parse(finISO);

  const publicados = turnos.filter((t) => t.status === 'published');
  const diasConFichaje = new Set(sesiones.map((s) => dateKeyOf(s.starts_at, timezone)));
  const diasSinReloj = new Set<DateKey>();
  const resultados: ResultadoDelBono[] = [];

  for (const empleado of empleados) {
    if (empleado.status !== 'active') continue;
    const suyos = publicados
      .filter((t) => t.employee_id === empleado.id)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    // Sin turnos en el mes no hay bono que ganar ni que perder: no sale en la lista.
    if (suyos.length === 0) continue;

    const base = {
      employeeId: empleado.id,
      faltas: [] as DateKey[],
      tardanzas: [] as DateKey[],
      turnosContados: 0,
      cumplidos: 0,
      ingreso: null as string | null,
      motivoNoAplica: null as ResultadoDelBono['motivoNoAplica'],
    };

    if (empleado.hire_date !== null && empleado.hire_date > desde) {
      resultados.push({
        ...base,
        estado: 'noAplica',
        motivoNoAplica: 'ingresoEnElMes',
        ingreso: empleado.hire_date,
      });
      continue;
    }

    const suyasSesiones = sesiones.filter((s) => s.employee_id === empleado.id);
    for (const turno of suyos) {
      if (Date.parse(turno.ends_at) > ahora) continue; // aún no terminó: no cuenta
      const dia = dateKeyOf(turno.starts_at, timezone);
      if (!diasConFichaje.has(dia)) {
        diasSinReloj.add(dia); // nadie fichó en la tienda ese día: ver arriba
        continue;
      }
      base.turnosContados += 1;
      const sesion = sesionDelTurno(turno, suyasSesiones);
      if (sesion === null) base.faltas.push(dia);
      else if (sesion.flags.includes('late_arrival')) base.tardanzas.push(dia);
      else base.cumplidos += 1;
    }

    const limpio = base.faltas.length === 0 && base.tardanzas.length === 0;
    resultados.push({
      ...base,
      estado: !limpio ? 'pierde' : mesTerminado ? 'gana' : 'enCamino',
    });
  }

  const orden: Record<EstadoDelBono, number> = { gana: 0, enCamino: 1, pierde: 2, noAplica: 3 };
  return {
    resultados: resultados.sort((a, b) => orden[a.estado] - orden[b.estado]),
    diasSinReloj: [...diasSinReloj].sort(),
  };
}
