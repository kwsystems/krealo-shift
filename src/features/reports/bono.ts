import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import type { WorkSession } from '@/features/timesheets/api';
import { estadoDeFalta, faltasDeLosTurnos } from '@/features/timesheets/faltas';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';

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
 * NI LOS DÍAS DE ANTES DEL RELOJ. Un turno de antes del día en que la sede empezó a usar
 * el reloj no se pudo fichar: contarlo como falta le quitaría el bono a todo el equipo por
 * algo que no hizo nadie. Se excluye, y la pantalla dice qué días. Así pasó con septiembre
 * de 2026: el reloj empezó el 29, y sin esto el lunes 28 habría dejado a todo el equipo
 * sin bono.
 *
 * LA FALTA ES LA DE TODA LA APP (1-oct), `timesheets/faltas.ts`: la misma que enseñan
 * Horario, Horas, Equipo y el celular. Antes el bono tenía la suya —«un día en que nadie
 * fichó no cuenta»—, y con una sola persona de turno eso borraba justo su falta: si no vino,
 * nadie fichó. Dos definiciones de falta acabarían dando el bono a quien Horario marca en
 * rojo.
 *
 * UNA FALTA JUSTIFICADA NO LO QUITA (2-oct). Andree pidió decir por qué faltó alguien
 * —médico, permiso avisado…—, y esa es justo la diferencia que el bono no veía: con un
 * descanso médico, faltar no es «no cumplir». Se aparta como un día sin reloj —ni a favor
 * ni en contra— y la tarjeta dice qué días. Sin justificar, o sin revisar todavía, cuenta
 * como falta: es lo que es mientras nadie diga otra cosa.
 *
 * Es UNA PROPUESTA para quien paga, no un pago: la pantalla lo dice. Quien decide el bono
 * puede tener en cuenta cosas que la app no ve.
 */

export type EstadoDelBono = 'gana' | 'enCamino' | 'pierde' | 'noAplica';

export type ResultadoDelBono = {
  employeeId: string;
  estado: EstadoDelBono;
  /** Turnos del mes que ya terminaron: los únicos que cuentan. */
  turnosContados: number;
  /** De esos, a los que fichó y llegó a tiempo. */
  cumplidos: number;
  /** Días (de la sede) de los turnos a los que no fichó, sin justificar. */
  faltas: DateKey[];
  /** Días de las faltas justificadas: no cuentan ni a favor ni en contra. */
  justificadas: DateKey[];
  /** Días de los turnos a los que llegó tarde. */
  tardanzas: DateKey[];
  /** Por qué no aplica, si no aplica. */
  motivoNoAplica: 'ingresoEnElMes' | 'bajaEnElMes' | 'sinTurnos' | null;
  /** Fecha de alta, si por ella no aplica. */
  ingreso: string | null;
  /** Último día, si se dio de baja dentro del mes y por eso no aplica. */
  baja: string | null;
};

export type EmpleadoDelBono = {
  id: string;
  status: string;
  hire_date: string | null;
  /** Su último día, si se dio de baja: ver `functions/src/baja-de-empleado.ts`. */
  end_date?: string | null;
};

/** Margen para asociar una jornada sin turno a un turno: quien entra un rato antes. */
const MARGEN_ANTES_MS = 2 * 60 * 60 * 1000;

export function sesionDelTurno(
  turno: ShiftRow,
  sesiones: readonly WorkSession[],
): WorkSession | null {
  /*
   * LA PRIMERA DEL TURNO (auditoría, 4-oct): con la salida a almorzar marcada en el reloj un
   * turno tiene dos jornadas, y la tardanza es la de la llegada, no la de la vuelta. La
   * regla de `puntualidad.ts`, explícita aquí aunque las jornadas lleguen en orden.
   */
  const enOrden = [...sesiones].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const porTurno = enOrden.find((s) => s.shift_id === turno.id);
  if (porTurno !== undefined) return porTurno;
  /*
   * SIN `shift_id`, POR HORA: el reloj no siempre sabe a qué turno pertenece una entrada
   * —porque se publicó después, o porque se fichó sin turno—. Una jornada de esa persona
   * que empieza dentro del turno, o poco antes, es la de ese turno.
   */
  const inicio = Date.parse(turno.starts_at) - MARGEN_ANTES_MS;
  const fin = Date.parse(turno.ends_at);
  return (
    enOrden.find((s) => {
      if (s.employee_id !== turno.employee_id || s.shift_id !== null) return false;
      const entrada = Date.parse(s.starts_at);
      return entrada >= inicio && entrada < fin;
    }) ?? null
  );
}

export type BonoDelMes = {
  resultados: ResultadoDelBono[];
  /** Días con turnos de antes de que la sede usara el reloj: no cuentan para nadie. */
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
  /** Desde qué día la sede usa el reloj; `null` si nunca, `undefined` si aún no se sabe. */
  relojDesde: DateKey | null | undefined;
  /** Lo que se dijo de cada falta: las justificadas no cuentan. */
  resoluciones?: readonly ResolucionDeFalta[];
}): BonoDelMes {
  const { turnos, sesiones, empleados, desde, finISO, nowISO, timezone, relojDesde } = params;
  const ahora = Date.parse(nowISO);
  const mesTerminado = ahora >= Date.parse(finISO);
  /** El último día del mes en la sede: una baja antes de él deja el mes incompleto. */
  const ultimoDia = dateKeyOf(new Date(Date.parse(finISO) - 1).toISOString(), timezone);

  const publicados = turnos.filter((t) => t.status === 'published');
  const faltas = new Map(
    faltasDeLosTurnos({
      turnos: publicados,
      jornadas: sesiones,
      relojDesde: () => relojDesde,
      ahoraISO: nowISO,
      timezone,
      resoluciones: params.resoluciones,
    }).map((falta) => [falta.id, estadoDeFalta(falta) === 'justificada']),
  );
  const diasSinReloj = new Set<DateKey>();
  const resultados: ResultadoDelBono[] = [];

  for (const empleado of empleados) {
    /*
     * SIN MIRAR SI HOY SIGUE ACTIVO (4-oct). Aquí se saltaba a todo el que no lo estuviera,
     * así que dar de baja a alguien la borraba del bono de los meses que SÍ trabajó:
     * septiembre perdía a quien se fue el 30. Lo que decide si sale es si tuvo turnos en el
     * mes, justo debajo; y los de después de irse ya no cuentan porque la baja los cancela
     * (ver `functions/src/baja-de-empleado.ts`).
     */
    const suyos = publicados
      .filter((t) => t.employee_id === empleado.id)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    // Sin turnos en el mes no hay bono que ganar ni que perder: no sale en la lista.
    if (suyos.length === 0) continue;

    const base = {
      employeeId: empleado.id,
      faltas: [] as DateKey[],
      justificadas: [] as DateKey[],
      tardanzas: [] as DateKey[],
      turnosContados: 0,
      cumplidos: 0,
      ingreso: null as string | null,
      baja: null as string | null,
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

    /*
     * EL MES COMPLETO TAMBIÉN AL FINAL (auditoría, 4-oct). Se exigía para el alta y no para
     * la baja: quien se fue el día 10 sin faltar «ganaba» un bono de un mes que no trabajó.
     */
    const finDeLaBaja = empleado.end_date ?? null;
    if (finDeLaBaja !== null && finDeLaBaja < ultimoDia) {
      resultados.push({
        ...base,
        estado: 'noAplica',
        motivoNoAplica: 'bajaEnElMes',
        baja: finDeLaBaja,
      });
      continue;
    }

    const suyasSesiones = sesiones.filter((s) => s.employee_id === empleado.id);
    for (const turno of suyos) {
      if (Date.parse(turno.ends_at) > ahora) continue; // aún no terminó: no cuenta
      const dia = dateKeyOf(turno.starts_at, timezone);
      if (relojDesde === null || relojDesde === undefined || dia < relojDesde) {
        diasSinReloj.add(dia); // de antes del reloj: ver arriba
        continue;
      }
      const justificada = faltas.get(turno.id);
      if (justificada === true) {
        base.justificadas.push(dia); // ni a favor ni en contra: ver arriba
        continue;
      }
      base.turnosContados += 1;
      if (justificada === false) {
        base.faltas.push(dia);
        continue;
      }
      const sesion = sesionDelTurno(turno, suyasSesiones);
      if (sesion?.flags.includes('late_arrival') === true) base.tardanzas.push(dia);
      else base.cumplidos += 1;
    }

    const limpio = base.faltas.length === 0 && base.tardanzas.length === 0;
    /*
     * SIN NINGÚN TURNO QUE CONTAR NO SE GANA (auditoría, 4-oct): una baja médica todo el mes,
     * o un mes entero de antes del reloj, daban «Gana» porque no había nada en contra. No
     * tener nada en contra no es haber cumplido.
     */
    if (limpio && mesTerminado && base.turnosContados === 0) {
      resultados.push({ ...base, estado: 'noAplica', motivoNoAplica: 'sinTurnos' });
      continue;
    }
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
