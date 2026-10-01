/**
 * LAS MARCAS RARAS: entrar mucho antes de su turno o salir mucho después (Andree, 1-oct).
 *
 * «Deberías dejar marcar en la tablet aunque lleguen muy temprano o marquen muy tarde…
 * si marcan 1 hora antes, eso sí debes avisarme, ya veo yo si cambio de horario o es hora
 * extra». Así que el reloj ya no frena a nadie —antes no dejaba entrar más de diez minutos
 * antes del turno sin el PIN de un gerente— y lo que pasa de la raya se AVISA en Horario.
 *
 * Quince minutos antes es llegar con tiempo y no se dice nada. Desde una hora —el umbral
 * de la sede, `unusualClockMinutes`— se marca la jornada, y quien gestiona decide si es
 * un cambio de horario, horas extra o nada.
 *
 * VIVE EN `src/domain` PORQUE LA USAN DOS LADOS: el servidor, al calcular las marcas de
 * cada jornada (`functions/src/shared/marcas.ts`), y la demostración, que tiene que
 * comportarse igual. Con una copia en cada lado acabarían discrepando sobre la misma
 * jornada.
 */

export const MINUTOS_FUERA_DEL_TURNO_POR_DEFECTO = 60;

export const MARCAS_FUERA_DEL_TURNO = ['early_arrival', 'late_departure'] as const;
export type MarcaFueraDelTurno = (typeof MARCAS_FUERA_DEL_TURNO)[number];

export function esMarcaFueraDelTurno(marca: string): marca is MarcaFueraDelTurno {
  return (MARCAS_FUERA_DEL_TURNO as readonly string[]).includes(marca);
}

const MINUTO = 60_000;

/** Cuántos minutos entró antes del turno y salió después de él (0 si no lo hizo). */
export function minutosFueraDelTurno(params: {
  entrada: string;
  salida: string | null;
  turno: { starts_at: string; ends_at: string };
}): { antes: number; despues: number } {
  const entrada = Date.parse(params.entrada);
  const inicio = Date.parse(params.turno.starts_at);
  const fin = Date.parse(params.turno.ends_at);
  const salida = params.salida === null ? Number.NaN : Date.parse(params.salida);
  const antes = Number.isNaN(entrada) || Number.isNaN(inicio) ? 0 : (inicio - entrada) / MINUTO;
  const despues = Number.isNaN(salida) || Number.isNaN(fin) ? 0 : (salida - fin) / MINUTO;
  return { antes: Math.max(0, Math.round(antes)), despues: Math.max(0, Math.round(despues)) };
}

/**
 * Las marcas raras de una jornada contra su turno.
 *
 * La salida solo cuenta con la jornada cerrada: alguien que sigue dentro todavía no ha
 * salido tarde, y avisarlo antes sería un aviso que se resuelve solo al marcar.
 */
export function marcasFueraDelTurno(params: {
  entrada: string;
  salida: string | null;
  turno: { starts_at: string; ends_at: string };
  umbralMinutos: number;
}): MarcaFueraDelTurno[] {
  const umbral = Math.max(1, Math.round(params.umbralMinutos) || MINUTOS_FUERA_DEL_TURNO_POR_DEFECTO);
  const { antes, despues } = minutosFueraDelTurno(params);
  const marcas: MarcaFueraDelTurno[] = [];
  if (antes >= umbral) marcas.push('early_arrival');
  if (params.salida !== null && despues >= umbral) marcas.push('late_departure');
  return marcas;
}
