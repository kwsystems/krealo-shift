import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';

import type { WorkSession } from './api';
import type { ResolucionDeFalta } from './justificaciones';

/**
 * LA FALTA, definida UNA vez para toda la app (1-oct).
 *
 * Andree: «cuando una persona no marca en todo el turno se toma como falta… aplícalo en
 * todas las vistas y en todos los lugares donde debería salir». Antes cada pantalla lo
 * decía a su manera, o no lo decía:
 *   - Inicio contaba como «no se presentó» un turno de HOY ya terminado sin jornada ese día;
 *   - el bono contaba la falta, pero sin contar los días en que nadie fichó en la tienda;
 *   - el celular del vendedor decía «sin marca», y Horario, Horas y Equipo no decían nada.
 * Cinco respuestas a la misma pregunta. Ahora todas preguntan aquí.
 *
 * ES FALTA un turno que cumple las cuatro cosas:
 *   1. PUBLICADO. Un borrador no se le llegó a dar a nadie.
 *   2. YA TERMINÓ. Mientras dura, la persona todavía puede llegar: eso es una tardanza, y
 *      lo dice Inicio.
 *   3. DE UN DÍA DESDE QUE LA SEDE USA EL RELOJ (`relojDesde`). Antes de ese día un turno
 *      sin marcas no es que nadie viniera: es que la app no existía. Es la misma frontera
 *      que usa «Registrar como cumplido» en el servidor (`horario-cumplido.ts`), así que
 *      las dos cosas no pueden discrepar: lo que esa función ofrece registrar nunca es una
 *      falta, y lo que es una falta nunca se ofrece registrar.
 *   4. SIN NINGUNA JORNADA DE ESA PERSONA DURANTE EL TURNO: ni una atada a ese turno, ni una
 *      que se cruce con su horario aunque no esté atada —quien entra a un turno partido y
 *      se queda las dos mitades tiene una sola jornada, atada a la primera—. Llegar tarde o
 *      salir antes NO es falta: es «Faltan horas», en Por resolver.
 *
 * Si `relojDesde` todavía no se sabe (`undefined`), no hay faltas: no se afirma una falta
 * con un dato que falta. Si la sede nunca ha usado el reloj (`null`), tampoco.
 *
 * Una falta deja de serlo sola en cuanto la persona tiene una jornada en ese turno —un
 * fichaje manual, un «olvidé marcar» aprobado—, porque esto se calcula de los datos de
 * siempre y no se guarda en ningún sitio. Por eso se corrige en una pantalla y se ve
 * corregida en todas.
 *
 * POR QUÉ FALTÓ (2-oct): cada falta lleva lo que quien gestiona dijo de ella
 * —justificada o no, y el motivo— si ya lo dijo. Se guarda aparte, por turno
 * (`justificaciones.ts`), y se pega aquí: la falta sigue saliendo de los datos de siempre, y
 * lo dicho deja de importar solo si deja de ser falta.
 *
 * PURA, para poder probar cada caso sin pantalla delante.
 */

export type EstadoDeFalta = 'sinRevisar' | 'justificada' | 'injustificada';

export type Falta = {
  /** El id del turno: hay a lo sumo una falta por turno. */
  id: string;
  turno: ShiftRow;
  employeeId: string;
  /** El día de la sede en que empezaba el turno. */
  dia: DateKey;
  /** Lo que se dijo de ella; `null` si nadie la ha revisado todavía. */
  resolucion: ResolucionDeFalta | null;
};

export type JornadaParaFaltas = Pick<
  WorkSession,
  'employee_id' | 'shift_id' | 'starts_at' | 'ends_at'
>;

/** Lo que dura una jornada; si sigue abierta, hasta ahora. */
function finDeLaJornada(jornada: JornadaParaFaltas, ahora: number): number {
  return jornada.ends_at === null ? ahora : Date.parse(jornada.ends_at);
}

/** Si la persona tiene alguna jornada en ese turno. */
export function cubreElTurno(
  turno: Pick<ShiftRow, 'id' | 'employee_id' | 'starts_at' | 'ends_at'>,
  jornadas: readonly JornadaParaFaltas[],
  ahora: number,
): boolean {
  const inicio = Date.parse(turno.starts_at);
  const fin = Date.parse(turno.ends_at);
  return jornadas.some(
    (jornada) =>
      jornada.employee_id === turno.employee_id &&
      (jornada.shift_id === turno.id ||
        (Date.parse(jornada.starts_at) < fin && finDeLaJornada(jornada, ahora) > inicio)),
  );
}

export function faltasDeLosTurnos(params: {
  turnos: readonly ShiftRow[];
  jornadas: readonly JornadaParaFaltas[];
  /** El primer día con reloj de cada sede: ver la regla 3. */
  relojDesde: (locationId: string) => DateKey | null | undefined;
  ahoraISO: string;
  timezone: string;
  /** Lo que se dijo de cada falta, por turno. */
  resoluciones?: readonly ResolucionDeFalta[];
}): Falta[] {
  const ahora = Date.parse(params.ahoraISO);
  const resolucionDe = new Map((params.resoluciones ?? []).map((r) => [r.shift_id, r]));
  const faltas: Falta[] = [];
  for (const turno of params.turnos) {
    if (turno.status !== 'published') continue;
    if (Date.parse(turno.ends_at) > ahora) continue;
    const desde = params.relojDesde(turno.location_id);
    if (desde === null || desde === undefined) continue;
    const dia = dateKeyOf(turno.starts_at, params.timezone);
    if (dia < desde) continue;
    if (cubreElTurno(turno, params.jornadas, ahora)) continue;
    faltas.push({
      id: turno.id,
      turno,
      employeeId: turno.employee_id,
      dia,
      resolucion: resolucionDe.get(turno.id) ?? null,
    });
  }
  return faltas.sort((a, b) => a.turno.starts_at.localeCompare(b.turno.starts_at));
}

/** Las faltas de cada persona, para las pantallas que cuentan por fila. */
export function faltasPorPersona(faltas: readonly Falta[]): Map<string, Falta[]> {
  const porPersona = new Map<string, Falta[]>();
  for (const falta of faltas) {
    const suyas = porPersona.get(falta.employeeId) ?? [];
    suyas.push(falta);
    porPersona.set(falta.employeeId, suyas);
  }
  return porPersona;
}

/** Sin revisar, justificada o sin justificar. */
export function estadoDeFalta(falta: Pick<Falta, 'resolucion'>): EstadoDeFalta {
  if (falta.resolucion === null) return 'sinRevisar';
  return falta.resolucion.kind === 'justified' ? 'justificada' : 'injustificada';
}

/** Cuántas de cada clase: lo que dicen las casillas y las filas. */
export function contarFaltas(faltas: readonly Pick<Falta, 'resolucion'>[]) {
  let justificadas = 0;
  let sinRevisar = 0;
  for (const falta of faltas) {
    const estado = estadoDeFalta(falta);
    if (estado === 'justificada') justificadas += 1;
    else if (estado === 'sinRevisar') sinRevisar += 1;
  }
  return {
    total: faltas.length,
    justificadas,
    sinRevisar,
    sinJustificar: faltas.length - justificadas,
  };
}
