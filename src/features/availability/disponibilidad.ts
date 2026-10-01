import { z } from 'zod';

import { dayOfWeek, type DateKey } from '@/features/schedules/week';

/**
 * LA DISPONIBILIDAD DE CADA PERSONA (1-oct), como en Homebase: qué días no puede trabajar,
 * qué horas prefiere, o un comentario sobre un día. Ver `functions/src/disponibilidad.ts`.
 *
 * PURA: qué fila aplica a qué día, cómo se dice y si choca con un turno. Sin red delante,
 * para poder probarla.
 */

export const TIPOS_DE_DISPONIBILIDAD = ['unavailable', 'preferred', 'note'] as const;
export type TipoDeDisponibilidad = (typeof TIPOS_DE_DISPONIBILIDAD)[number];

export const disponibilidadSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  kind: z.enum(['weekly', 'date']),
  /** 1 = lunes … 7 = domingo, solo en las de cada semana. */
  weekday: z.number().int().min(1).max(7).nullable().default(null),
  /** Solo en las de un día. */
  date: z.string().nullable().default(null),
  type: z.enum(TIPOS_DE_DISPONIBILIDAD),
  from_time: z.string().nullable().default(null),
  to_time: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
  status: z.enum(['new', 'seen']).catch('seen'),
  source: z.enum(['employee', 'manager']).catch('employee'),
  updated_at: z.string().nullable().default(null),
});
export type Disponibilidad = z.infer<typeof disponibilidadSchema>;

/** El día de la semana ISO de un día: 1 = lunes … 7 = domingo. */
export function diaDeSemanaIso(dia: DateKey): number {
  const domingoCero = dayOfWeek(dia);
  return domingoCero === 0 ? 7 : domingoCero;
}

/** ¿Esta fila dice algo de ese día? */
export function aplicaAlDia(fila: Disponibilidad, dia: DateKey): boolean {
  return fila.kind === 'date' ? fila.date === dia : fila.weekday === diaDeSemanaIso(dia);
}

/**
 * Lo que una persona dijo de un día: primero lo de ese día concreto, que manda sobre lo de
 * cada semana, y dentro de cada uno, lo que impide trabajar antes que lo que solo informa.
 */
export function disponibilidadDelDia(
  filas: readonly Disponibilidad[],
  employeeId: string,
  dia: DateKey,
): Disponibilidad[] {
  const peso = { unavailable: 0, preferred: 1, note: 2 } as const;
  return filas
    .filter((fila) => fila.employee_id === employeeId && aplicaAlDia(fila, dia))
    .sort(
      (a, b) =>
        (a.kind === 'date' ? 0 : 1) - (b.kind === 'date' ? 0 : 1) || peso[a.type] - peso[b.type],
    );
}

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * ¿Choca con un turno de ese día? Solo lo que impide trabajar: todo el día, o una franja
 * que se pisa con el turno. Lo que prefiere y las notas no chocan con nada: informan.
 * Las horas del turno van en minutos del día local («09:00» → 540).
 */
export function chocaConElTurno(
  fila: Disponibilidad,
  turno: { desde: number; hasta: number },
): boolean {
  if (fila.type !== 'unavailable') return false;
  if (fila.from_time === null || fila.to_time === null) return true;
  const hasta = turno.hasta <= turno.desde ? turno.hasta + 24 * 60 : turno.hasta;
  return minutos(fila.from_time) < hasta && minutos(fila.to_time) > turno.desde;
}

export function esTodoElDia(fila: Disponibilidad): boolean {
  return fila.from_time === null || fila.to_time === null;
}
