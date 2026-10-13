import {
  APORTE_AFP_APROXIMADO,
  APORTE_ONP,
  ASIGNACION_FAMILIAR,
  DIAS_DE_MAS_POR_FERIADO,
  DIAS_DEL_MES,
  HORAS_DE_LA_JORNADA,
  HORAS_EXTRA_AL_25,
  PARTE_DEL_DESCANSO_POR_FALTA,
  RMV,
  SOBRETASA_PRIMERAS_HORAS,
  SOBRETASA_SIGUIENTES_HORAS,
  vigenteEn,
} from './ley-laboral-peru';

/**
 * CUÁNTO VA A COBRAR ESTE MES, APROXIMADAMENTE (13-oct).
 *
 * Andree: «que cada uno pueda ver más o menos cuánto es el sueldo que va a ganar, dependiendo
 * si ha faltado, si ha llegado tarde, si hay descuentos… si ha trabajado feriado, horas
 * extra… pero siempre poner que es un aproximado, que al final eso se ve en su boleta». Es
 * el «pago estimado» de Homebase, pero a la peruana: allá se cobra por hora y aquí hay un
 * SUELDO MENSUAL, del que se descuenta lo que no se trabajó y al que se suma lo que se
 * trabajó de más.
 *
 * UNA SOLA CUENTA PARA TODAS LAS PANTALLAS —el celular de la persona y la ficha de Equipo—,
 * y PURA: recibe los hechos del mes ya decididos por las reglas de siempre (`faltas.ts`, las
 * horas extra aprobadas, los feriados, las horas que debe) y no vuelve a decidir ninguno.
 *
 * Las cifras legales salen de `ley-laboral-peru.ts`, con la vigente ese mes.
 *
 * LO QUE NO ENTRA, y se dice: renta de 5.ª categoría, gratificación, CTS, vacaciones,
 * descuentos pactados (préstamos, adelantos). Por eso es «aproximado».
 */

export type SistemaDePension = 'onp' | 'afp';

/** Lo que se sabe del sueldo de una persona: lo guarda quien administra. */
export type DatosDelSueldo = {
  /** Sueldo mensual bruto en soles. */
  sueldoMensual: number;
  asignacionFamiliar: boolean;
  /** `null` si no se sabe: entonces no se calcula el neto. */
  pension: SistemaDePension | null;
};

export type EstadoDeLaFalta = 'sinRevisar' | 'injustificada' | 'justificada';

export type SueldoEstimado = {
  /** El sueldo de los días del mes en que tuvo contrato (todo, el mes entero). */
  base: number;
  /** Días pagados de 30: menos si entró o se fue a mitad de mes. */
  diasPagados: number;
  asignacionFamiliar: number;
  /** La RMV con la que se hizo la cuenta, y su norma. */
  rmv: { valor: number; norma: string };
  /** Faltas que descuentan: sin justificar y, aparte, las que nadie ha revisado aún. */
  faltas: { dias: number; monto: number };
  faltasSinRevisar: { dias: number; monto: number };
  /** Las justificadas no descuentan: se cuentan para decirlo. */
  faltasJustificadas: number;
  horasExtra: { minutos: number; monto: number };
  feriados: { dias: number; monto: number };
  /** Horas que debe, pendientes: se descuentan si no se compensan. */
  horasQueDebe: { minutos: number; monto: number };
  /** Lo que cobra antes de la pensión. */
  bruto: number;
  pension: { sistema: SistemaDePension; monto: number } | null;
  /** `null` si no se sabe su sistema de pensiones. */
  neto: number | null;
  /** El sueldo es menor que la RMV vigente para una jornada completa. */
  menorQueLaRmv: boolean;
};

const redondear = (soles: number) => Math.round(soles * 100) / 100;

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) +
  1;

/** Lo que pagan las horas extra de UN día: las dos primeras al +25 %, el resto al +35 %. */
export function pagoDeHorasExtraDelDia(minutos: number, valorHora: number): number {
  const alPrimero = Math.min(minutos, HORAS_EXTRA_AL_25 * 60);
  const alSegundo = Math.max(0, minutos - HORAS_EXTRA_AL_25 * 60);
  return (
    (alPrimero / 60) * valorHora * (1 + SOBRETASA_PRIMERAS_HORAS) +
    (alSegundo / 60) * valorHora * (1 + SOBRETASA_SIGUIENTES_HORAS)
  );
}

export function sueldoEstimado(params: {
  datos: DatosDelSueldo;
  /** Primer y último día del mes (`YYYY-MM-DD`). */
  mes: { desde: string; hasta: string };
  /** Su fecha de ingreso y de baja, si caen dentro del mes. */
  ingreso?: string | null;
  baja?: string | null;
  /** Las faltas del mes, con lo que se dijo de cada una (`faltas.ts`). */
  faltas: readonly { estado: EstadoDeLaFalta }[];
  /** Las horas extra APROBADAS del mes, en minutos por día. */
  extrasPorDia: readonly number[];
  /** Los días de feriado del mes en que trabajó. */
  feriadosTrabajados: number;
  /** Los minutos que debe, pendientes de compensar. */
  minutosQueDebe: number;
}): SueldoEstimado {
  const { datos, mes } = params;
  const sueldo = Math.max(0, datos.sueldoMensual);
  const valorDia = sueldo / DIAS_DEL_MES;
  const valorHora = valorDia / HORAS_DE_LA_JORNADA;

  /*
   * EL MES SE PAGA ENTERO SI TUVO CONTRATO TODO EL MES, tenga 28 o 31 días. Si entró o se fue
   * a mitad de mes, se pagan los días en que tuvo contrato, con 30 como tope.
   */
  const desde = params.ingreso && params.ingreso > mes.desde ? params.ingreso : mes.desde;
  const hasta = params.baja && params.baja < mes.hasta ? params.baja : mes.hasta;
  const mesEntero = desde === mes.desde && hasta === mes.hasta;
  const diasPagados =
    hasta < desde ? 0 : mesEntero ? DIAS_DEL_MES : Math.min(DIAS_DEL_MES, diasEntre(desde, hasta));
  const base = mesEntero ? sueldo : valorDia * diasPagados;

  const rmv = vigenteEn(RMV, mes.hasta);
  const asignacionFamiliar = datos.asignacionFamiliar ? rmv.valor * ASIGNACION_FAMILIAR : 0;

  // Cada falta: su día y la parte del descanso semanal que generaba.
  const porFalta = valorDia * (1 + PARTE_DEL_DESCANSO_POR_FALTA);
  const injustificadas = params.faltas.filter((f) => f.estado === 'injustificada').length;
  const sinRevisar = params.faltas.filter((f) => f.estado === 'sinRevisar').length;
  const justificadas = params.faltas.filter((f) => f.estado === 'justificada').length;

  const minutosExtra = params.extrasPorDia.reduce((suma, m) => suma + Math.max(0, m), 0);
  const montoExtra = params.extrasPorDia.reduce(
    (suma, m) => suma + pagoDeHorasExtraDelDia(Math.max(0, m), valorHora),
    0,
  );
  const montoFeriados = params.feriadosTrabajados * valorDia * DIAS_DE_MAS_POR_FERIADO;
  const minutosQueDebe = Math.max(0, params.minutosQueDebe);
  const montoQueDebe = (minutosQueDebe / 60) * valorHora;

  const descuentos = porFalta * (injustificadas + sinRevisar) + montoQueDebe;
  // Nunca menos de cero: un mes de faltas no deja una deuda en la cuenta.
  const bruto = Math.max(0, base + asignacionFamiliar + montoExtra + montoFeriados - descuentos);

  const tasa =
    datos.pension === 'onp' ? APORTE_ONP : datos.pension === 'afp' ? APORTE_AFP_APROXIMADO : null;
  const pension =
    datos.pension === null || tasa === null
      ? null
      : { sistema: datos.pension, monto: redondear(bruto * tasa) };

  return {
    base: redondear(base),
    diasPagados,
    asignacionFamiliar: redondear(asignacionFamiliar),
    rmv: { valor: rmv.valor, norma: rmv.norma },
    faltas: { dias: injustificadas, monto: redondear(porFalta * injustificadas) },
    faltasSinRevisar: { dias: sinRevisar, monto: redondear(porFalta * sinRevisar) },
    faltasJustificadas: justificadas,
    horasExtra: { minutos: minutosExtra, monto: redondear(montoExtra) },
    feriados: { dias: params.feriadosTrabajados, monto: redondear(montoFeriados) },
    horasQueDebe: { minutos: minutosQueDebe, monto: redondear(montoQueDebe) },
    bruto: redondear(bruto),
    pension,
    neto: pension === null ? null : redondear(bruto - pension.monto),
    menorQueLaRmv: sueldo > 0 && sueldo < rmv.valor,
  };
}
