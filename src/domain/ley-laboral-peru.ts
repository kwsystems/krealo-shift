/**
 * LAS CIFRAS DE LA LEY LABORAL PERUANA QUE USA EL SUELDO APROXIMADO (13-oct).
 *
 * Andree: «que siempre vaya con la ley… si sube el sueldo mínimo, avísame para cambiarlo».
 * Las que cambian por decreto llevan la FECHA DESDE LA QUE RIGEN y la norma que las fijó: un
 * mes se calcula con lo vigente ese mes, así que subir el sueldo mínimo no reescribe los
 * meses ya pasados. Para cambiar una cifra se AÑADE una fila con su fecha, no se pisa la de
 * antes.
 *
 * Lo que no cambia por decreto —el 25 % de las horas extra, el 100 % del feriado— está en
 * leyes que llevan años igual, y va como constante con su norma al lado.
 */

export type Vigente<T> = {
  /** Primer día (de la sede, `YYYY-MM-DD`) en que rige. */
  desde: string;
  valor: T;
  /** La norma que la fijó: para poder comprobarla. */
  norma: string;
};

/**
 * REMUNERACIÓN MÍNIMA VITAL, en soles al mes, por jornada completa (8 h diarias o 48 h a la
 * semana). El 13-oct-2026 está anunciado un segundo tramo hasta S/ 1,300 para el primer
 * semestre de 2027, todavía sin decreto: se añade cuando salga.
 */
export const RMV: readonly Vigente<number>[] = [
  { desde: '2022-05-01', valor: 1025, norma: 'D.S. 003-2022-TR' },
  { desde: '2025-01-01', valor: 1130, norma: 'D.S. 006-2024-TR' },
  { desde: '2026-10-01', valor: 1230, norma: 'D.S. 015-2026-TR' },
];

/** La fila vigente ese día: la última cuya fecha ya llegó. */
export function vigenteEn<T>(lista: readonly Vigente<T>[], dia: string): Vigente<T> {
  let vigente = lista[0];
  for (const fila of lista) {
    if (fila.desde <= dia) vigente = fila;
  }
  if (vigente === undefined) throw new Error('Lista de cifras legales vacía');
  return vigente;
}

/** Asignación familiar: 10 % de la RMV vigente (Ley 25129). */
export const ASIGNACION_FAMILIAR = 0.1;

/**
 * El valor de un día es el sueldo entre 30, tenga el mes los días que tenga, y el de una
 * hora, el del día entre 8 (D.S. 012-92-TR; T.U.O. de la Ley de Jornada, D.S. 007-2002-TR).
 */
export const DIAS_DEL_MES = 30;
export const HORAS_DE_LA_JORNADA = 8;

/** Horas extra: las dos primeras de cada día, +25 %; desde la tercera, +35 % (D.S. 007-2002-TR). */
export const HORAS_EXTRA_AL_25 = 2;
export const SOBRETASA_PRIMERAS_HORAS = 0.25;
export const SOBRETASA_SIGUIENTES_HORAS = 0.35;

/**
 * Feriado trabajado sin otro día de descanso a cambio: el día que trabajó más una sobretasa
 * del 100 % (D.Leg. 713, art. 9). El feriado ya va pagado en el sueldo mensual: por eso
 * suma DOS valores de día y en total cobra el triple.
 */
export const DIAS_DE_MAS_POR_FERIADO = 2;

/**
 * Una falta sin justificar descuenta su día y la parte del descanso semanal que ese día
 * generaba: un sexto, con la semana de seis días (D.Leg. 713; D.S. 012-92-TR, art. 2).
 */
export const PARTE_DEL_DESCANSO_POR_FALTA = 1 / 6;

/**
 * Lo que se descuenta para la pensión. ONP, 13 %. AFP, el 10 % del fondo más la comisión y
 * la prima de seguro, que cambian por AFP y por año: ~13 % es la cuenta redonda. Por eso el
 * neto se dice «aproximado».
 */
export const APORTE_ONP = 0.13;
export const APORTE_AFP_APROXIMADO = 0.13;
