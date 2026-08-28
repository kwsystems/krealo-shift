import { z } from 'zod';

/**
 * Qué cambió una corrección: valor anterior y valor nuevo, legibles (§11.4).
 *
 * §11.4 pide "ver historial de cambios" y §11.4 exige conservar valor anterior y
 * valor nuevo. Se conservaban —están en `time_adjustments.before_value` y
 * `after_value`, y la pantalla YA LOS TRAÍA— pero no se mostraban: el historial
 * enseñaba fecha, canal y motivo. Un motivo sin el cambio al lado no es un historial:
 * "corrección de hora de salida" no dice si fueron cinco minutos o cinco horas, que es
 * justo lo que se revisa en una auditoría.
 *
 * Los dos lados son `jsonb` y NO tienen la misma forma: una corrección de sesión trae
 * horas de entrada y salida, y un fichaje agregado a mano trae el tipo de evento —con
 * `{existed: false}` como lado anterior, que es la diferencia entre "se corrigió una
 * hora" y "se agregó un fichaje que no existía"—. Por eso esto devuelve una forma
 * discriminada y no una cadena: quien pinta decide cómo se lee en cada idioma, y un
 * `jsonb` con una forma que no conocemos se dice como tal en vez de reventar.
 */

const sessionSideSchema = z.object({
  startsAt: z.string().nullable().default(null),
  endsAt: z.string().nullable().default(null),
  netMinutes: z.number().nullable().default(null),
});

const eventSideSchema = z.object({
  eventType: z.string(),
  occurredAt: z.string().nullable().default(null),
  breakType: z.string().nullable().default(null),
});

const absentSideSchema = z.object({ existed: z.literal(false) });

export type AdjustmentSide =
  | { kind: 'session'; startsAt: string | null; endsAt: string | null; netMinutes: number | null }
  | { kind: 'event'; eventType: string; occurredAt: string | null; breakType: string | null }
  /** No había nada antes: el fichaje se agregó a mano. */
  | { kind: 'absent' }
  /** Una forma que este código no conoce. Se dice, no se adivina. */
  | { kind: 'unknown' };

export function readAdjustmentSide(valor: unknown): AdjustmentSide {
  const ausente = absentSideSchema.safeParse(valor);
  if (ausente.success) return { kind: 'absent' };

  const evento = eventSideSchema.safeParse(valor);
  if (evento.success) {
    return {
      kind: 'event',
      eventType: evento.data.eventType,
      occurredAt: evento.data.occurredAt,
      breakType: evento.data.breakType,
    };
  }

  const sesion = sessionSideSchema.safeParse(valor);
  // Una sesión sin ninguno de los tres datos no aporta nada y se trata como
  // desconocida: `{}` pasa el esquema porque los tres campos tienen valor por
  // defecto, y pintar "— → —" sería peor que decir que no se sabe.
  if (
    sesion.success &&
    (sesion.data.startsAt !== null || sesion.data.endsAt !== null || sesion.data.netMinutes !== null)
  ) {
    return {
      kind: 'session',
      startsAt: sesion.data.startsAt,
      endsAt: sesion.data.endsAt,
      netMinutes: sesion.data.netMinutes,
    };
  }

  return { kind: 'unknown' };
}
