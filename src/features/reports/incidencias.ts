import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import type { WorkSession } from '@/features/timesheets/api';
import { estadoDeFalta, type EstadoDeFalta, type Falta } from '@/features/timesheets/faltas';
import type { HoraDebida } from '@/features/timesheets/horas-debidas';

/**
 * TODO LO QUE PASÓ EN EL PERIODO, Y CÓMO QUEDÓ (4-oct).
 *
 * Andree: «cuando yo ya arreglo las cosas de esta semana, esto se borra para la otra
 * semana, ¿no? Luego tiene que haber un resumen en Reportes de todo esto, de las faltas,
 * llegadas tarde y todo eso». Horas enseña lo de UNA semana y lo que está por arreglar; lo
 * arreglado deja de salir ahí, y con razón. Pero que se arregle no quiere decir que no
 * pasara: una falta justificada sigue siendo una falta del mes, y una tardanza corregida
 * sigue siendo una tardanza. Esto es el registro.
 *
 * CINCO CLASES, todas con la regla que ya usa el resto de la app, ninguna nueva:
 *
 *   - FALTA: `timesheets/faltas.ts`, con lo que se dijo de ella (`estadoDeFalta`). Las mismas
 *     que cuentan la casilla de Reportes, Horas, Horario y Equipo.
 *   - LLEGÓ TARDE / SALIÓ ANTES: las marcas `late_arrival` y `early_departure` que pone el
 *     servidor con la tolerancia de la sede (`functions/src/shared/marcas.ts`). Las veces
 *     son las marcas —las mismas que «A tiempo»—; los minutos, la distancia al turno, y solo
 *     si el turno está entre los del periodo.
 *   - CUMPLIDO: un turno dado por cumplido por un motivo especial (`credit_reason`): no es
 *     una falta, pero tampoco vino, y se dice.
 *   - DEBE: las horas que debe (`horas-debidas.ts`), con su estado: pendientes, compensadas
 *     o perdonadas.
 *
 * PURA, para poder probar cada clase sin pantalla delante.
 */

export type Incidencia =
  | {
      tipo: 'falta';
      id: string;
      employeeId: string;
      dia: DateKey;
      falta: Falta;
      estado: EstadoDeFalta;
    }
  | {
      tipo: 'tarde';
      id: string;
      employeeId: string;
      dia: DateKey;
      /** `null` cuando su turno no está entre los del periodo: se cuenta, pero sin minutos. */
      minutos: number | null;
      entrada: string;
      inicioDelTurno: string | null;
    }
  | {
      tipo: 'salioAntes';
      id: string;
      employeeId: string;
      dia: DateKey;
      minutos: number | null;
      salida: string;
      finDelTurno: string | null;
      motivo: string | null;
    }
  | {
      tipo: 'cumplido';
      id: string;
      employeeId: string;
      dia: DateKey;
      minutos: number;
      motivo: string | null;
      nota: string | null;
    }
  | {
      tipo: 'debe';
      id: string;
      employeeId: string;
      dia: DateKey;
      minutos: number;
      estado: HoraDebida['status'];
      nota: string | null;
    };

export type TipoDeIncidencia = Incidencia['tipo'];

/** El orden dentro de un día: lo que cuenta en contra, primero. */
const ORDEN: Record<TipoDeIncidencia, number> = {
  falta: 0,
  tarde: 1,
  salioAntes: 2,
  debe: 3,
  cumplido: 4,
};

const minutosEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(hasta) - Date.parse(desde)) / 60_000);

/** Cuánto antes de su turno puede entrar alguien y seguir siendo de ese turno. */
const ANTES_DEL_TURNO_MS = 2 * 60 * 60_000;

/**
 * EL TURNO DE UNA JORNADA, para medir cuánto llegó tarde o se fue antes. Por su id, que es
 * lo normal; y si no lo trae —o ese turno ya no está entre los del periodo—, el turno
 * publicado de esa persona en que cae su entrada. Sin esto, una tardanza se contaba sin
 * minutos y la fila decía «3 veces · 9 min» de tres tardanzas de las que solo se sabía una.
 */
function turnoDeLaSesion(
  sesion: WorkSession,
  porId: ReadonlyMap<string, ShiftRow>,
  porPersona: ReadonlyMap<string, readonly ShiftRow[]>,
): ShiftRow | undefined {
  const porSuId = sesion.shift_id === null ? undefined : porId.get(sesion.shift_id);
  if (porSuId !== undefined) return porSuId;
  const entrada = Date.parse(sesion.starts_at);
  return (porPersona.get(sesion.employee_id) ?? []).find(
    (turno) =>
      turno.status === 'published' &&
      Date.parse(turno.starts_at) - ANTES_DEL_TURNO_MS <= entrada &&
      entrada < Date.parse(turno.ends_at),
  );
}

export function incidenciasDelPeriodo(params: {
  /** Las faltas del periodo, ya con lo que se dijo de cada una. */
  faltas: readonly Falta[];
  sesiones: readonly WorkSession[];
  turnos: readonly ShiftRow[];
  debidas: readonly HoraDebida[];
  dias: readonly DateKey[];
  timezone: string;
}): Incidencia[] {
  const dias = new Set(params.dias);
  const turnoPorId = new Map(params.turnos.map((turno) => [turno.id, turno]));
  const turnosPorPersona = new Map<string, ShiftRow[]>();
  for (const turno of params.turnos) {
    turnosPorPersona.set(turno.employee_id, [
      ...(turnosPorPersona.get(turno.employee_id) ?? []),
      turno,
    ]);
  }
  const lista: Incidencia[] = [];

  for (const falta of params.faltas) {
    if (!dias.has(falta.dia)) continue;
    lista.push({
      tipo: 'falta',
      id: `falta:${falta.id}`,
      employeeId: falta.employeeId,
      dia: falta.dia,
      falta,
      estado: estadoDeFalta(falta),
    });
  }

  for (const sesion of params.sesiones) {
    const dia = dateKeyOf(sesion.starts_at, params.timezone);
    if (!dias.has(dia)) continue;

    if (sesion.credit_reason !== null) {
      lista.push({
        tipo: 'cumplido',
        id: `cumplido:${sesion.id}`,
        employeeId: sesion.employee_id,
        dia,
        minutos: sesion.net_minutes ?? 0,
        motivo: sesion.credit_reason,
        nota: sesion.credit_note,
      });
      // Su jornada es la del turno, de punta a punta: ni tarde ni antes.
      continue;
    }

    const turno = turnoDeLaSesion(sesion, turnoPorId, turnosPorPersona);
    if (sesion.flags.includes('late_arrival')) {
      const minutos = turno === undefined ? null : minutosEntre(turno.starts_at, sesion.starts_at);
      lista.push({
        tipo: 'tarde',
        id: `tarde:${sesion.id}`,
        employeeId: sesion.employee_id,
        dia,
        minutos: minutos === null ? null : Math.max(0, minutos),
        entrada: sesion.starts_at,
        inicioDelTurno: turno?.starts_at ?? null,
      });
    }
    if (sesion.flags.includes('early_departure') && sesion.ends_at !== null) {
      const minutos = turno === undefined ? null : minutosEntre(sesion.ends_at, turno.ends_at);
      lista.push({
        tipo: 'salioAntes',
        id: `antes:${sesion.id}`,
        employeeId: sesion.employee_id,
        dia,
        minutos: minutos === null ? null : Math.max(0, minutos),
        salida: sesion.ends_at,
        finDelTurno: turno?.ends_at ?? null,
        motivo: sesion.departure_reason,
      });
    }
  }

  for (const debida of params.debidas) {
    if (!dias.has(debida.work_date)) continue;
    lista.push({
      tipo: 'debe',
      id: `debe:${debida.id}`,
      employeeId: debida.employee_id,
      dia: debida.work_date,
      minutos: debida.minutes,
      estado: debida.status,
      nota: debida.note,
    });
  }

  // El día más reciente arriba; dentro del día, lo que cuenta en contra primero.
  return lista.sort(
    (a, b) =>
      b.dia.localeCompare(a.dia) ||
      ORDEN[a.tipo] - ORDEN[b.tipo] ||
      a.employeeId.localeCompare(b.employeeId),
  );
}

export type ResumenDeIncidencias = {
  employeeId: string;
  faltas: number;
  /** Sin revisar o sin justificar: las que cuentan en contra. */
  faltasEnContra: number;
  faltasJustificadas: number;
  tardanzas: number;
  minutosTarde: number;
  salidasAntes: number;
  minutosAntes: number;
  cumplidos: number;
  minutosCumplidos: number;
  debePendiente: number;
  debeCompensado: number;
  debePerdonado: number;
};

const vacio = (employeeId: string): ResumenDeIncidencias => ({
  employeeId,
  faltas: 0,
  faltasEnContra: 0,
  faltasJustificadas: 0,
  tardanzas: 0,
  minutosTarde: 0,
  salidasAntes: 0,
  minutosAntes: 0,
  cumplidos: 0,
  minutosCumplidos: 0,
  debePendiente: 0,
  debeCompensado: 0,
  debePerdonado: 0,
});

function sumar(resumen: ResumenDeIncidencias, incidencia: Incidencia): void {
  switch (incidencia.tipo) {
    case 'falta':
      resumen.faltas += 1;
      if (incidencia.estado === 'justificada') resumen.faltasJustificadas += 1;
      else resumen.faltasEnContra += 1;
      return;
    case 'tarde':
      resumen.tardanzas += 1;
      resumen.minutosTarde += incidencia.minutos ?? 0;
      return;
    case 'salioAntes':
      resumen.salidasAntes += 1;
      resumen.minutosAntes += incidencia.minutos ?? 0;
      return;
    case 'cumplido':
      resumen.cumplidos += 1;
      resumen.minutosCumplidos += incidencia.minutos;
      return;
    case 'debe':
      if (incidencia.estado === 'pending') resumen.debePendiente += incidencia.minutos;
      else if (incidencia.estado === 'compensated') resumen.debeCompensado += incidencia.minutos;
      else resumen.debePerdonado += incidencia.minutos;
      return;
  }
}

/**
 * El total y una fila por persona que tuvo algo. Primero quien tiene más en contra —faltas
 * sin justificar, luego tardanzas—: es a quien hay que mirar.
 */
export function resumirIncidencias(incidencias: readonly Incidencia[]): {
  total: ResumenDeIncidencias;
  porPersona: ResumenDeIncidencias[];
} {
  const total = vacio('');
  const porPersona = new Map<string, ResumenDeIncidencias>();
  for (const incidencia of incidencias) {
    sumar(total, incidencia);
    const fila = porPersona.get(incidencia.employeeId) ?? vacio(incidencia.employeeId);
    sumar(fila, incidencia);
    porPersona.set(incidencia.employeeId, fila);
  }
  return {
    total,
    porPersona: [...porPersona.values()].sort(
      (a, b) =>
        b.faltasEnContra - a.faltasEnContra ||
        b.tardanzas - a.tardanzas ||
        b.minutosTarde - a.minutosTarde ||
        b.salidasAntes - a.salidasAntes ||
        b.debePendiente - a.debePendiente ||
        a.employeeId.localeCompare(b.employeeId),
    ),
  };
}
