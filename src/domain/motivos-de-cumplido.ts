/**
 * POR QUÉ SE DA POR CUMPLIDO UN TURNO QUE NO SE MARCÓ (4-oct). Lo comparten la app y el
 * servidor, como los motivos de falta: con dos listas, el servidor rechazaría un motivo que
 * la app ofrece.
 *
 * Andree, el día de las elecciones: «la escogieron como miembro de mesa, quiero poner que sí
 * cumplió su horario de hoy y que es especial». No es una falta justificada —esa no suma
 * horas—: es un turno que cuenta como trabajado aunque no se marcó en el reloj, por un
 * motivo que hay que poder ver después en cada pantalla.
 *
 * Pocos motivos fijos, para que Reportes pueda contarlos, y «Otro», que pide escribir qué
 * pasó.
 */

export const MOTIVOS_DE_CUMPLIDO = ['election_duty', 'offsite_work', 'training', 'other'] as const;
export type MotivoDeCumplido = (typeof MOTIVOS_DE_CUMPLIDO)[number];

export const NOTA_MAXIMA_DE_CUMPLIDO = 280;

export function motivoDeCumplidoValido(motivo: unknown): motivo is MotivoDeCumplido {
  return (MOTIVOS_DE_CUMPLIDO as readonly unknown[]).includes(motivo);
}

/** «Otro» no dice nada por sí solo: pide escribir qué pasó. */
export function cumplidoPideNota(motivo: MotivoDeCumplido): boolean {
  return motivo === 'other';
}
