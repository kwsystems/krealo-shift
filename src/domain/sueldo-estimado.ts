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
  /**
   * Días del calendario del mes en que tuvo contrato. 0 = ese mes no trabajaba aquí: no hay
   * sueldo que enseñar (la tarjeta lo dice en una línea).
   */
  diasConContrato: number;
  asignacionFamiliar: number;
  /** La RMV con la que se hizo la cuenta, y su norma. */
  rmv: { valor: number; norma: string };
  /**
   * DÍAS de falta que descuentan: sin justificar y, aparte, los que nadie ha revisado aún. Un
   * día con turno partido en que faltó a los dos turnos es UN día, no dos.
   */
  faltas: { dias: number; monto: number };
  faltasSinRevisar: { dias: number; monto: number };
  /** Los días justificados no descuentan: se cuentan para decirlo. */
  faltasJustificadas: number;
  /**
   * Turnos a los que no vino en un día en que SÍ trabajó otro turno (el día partido a medias):
   * se descuentan sus horas, no el día. `turnos` y `minutos` son los que descuentan (sin
   * justificar o sin revisar); `sinRevisar`, cuántos de ellos nadie ha revisado aún.
   */
  turnosSinTrabajar: { turnos: number; minutos: number; monto: number; sinRevisar: number };
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

/** Días del calendario de `desde` a `hasta`, los dos incluidos. */
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
  /**
   * Los DÍAS de falta del mes, con lo que se dijo de cada uno (`faltas.ts`, agrupadas por día
   * en `hechos-del-mes.ts`): uno por día, aunque ese día tuviera dos turnos.
   */
  faltas: readonly { estado: EstadoDeLaFalta }[];
  /** Los turnos no trabajados de un día en que sí trabajó otro, con sus minutos planificados. */
  turnosSinTrabajar?: readonly { estado: EstadoDeLaFalta; minutos: number }[];
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
   * EL MES SE PAGA ENTERO SI TUVO CONTRATO TODO EL MES, tenga 28 o 31 días.
   *
   * EL MES A MEDIAS TAMBIÉN SE CUENTA SOBRE 30 (26-oct). Hasta hoy, quien entraba o se iba a
   * mitad de mes cobraba los días DEL CALENDARIO con contrato. Pero el mes entero vale 30 días
   * aunque tenga 28 o 31, así que la cuenta no casaba con ella misma: quien se iba el 14 de
   * febrero cobraba 14/30 por medio mes (de menos) y quien entraba el 2 de un mes de 31
   * cobraba 30/30, el mes entero, sin haber estado el 1 (de más). Ahora se paga
   * 30 − los días del mes SIN contrato: lo que no estuvo se descuenta igual en cualquier mes.
   * Nunca menos de 0: quien entra el 31 de un mes de 31 no tiene días que cobrar ese mes.
   */
  const desde = params.ingreso && params.ingreso > mes.desde ? params.ingreso : mes.desde;
  const hasta = params.baja && params.baja < mes.hasta ? params.baja : mes.hasta;
  const mesEntero = desde === mes.desde && hasta === mes.hasta;
  const diasConContrato = hasta < desde ? 0 : diasEntre(desde, hasta);
  const diasSinContrato = diasEntre(mes.desde, mes.hasta) - diasConContrato;
  const diasPagados = diasConContrato === 0 ? 0 : Math.max(0, DIAS_DEL_MES - diasSinContrato);
  const base = mesEntero ? sueldo : valorDia * diasPagados;

  const rmv = vigenteEn(RMV, mes.hasta);
  /*
   * LA ASIGNACIÓN FAMILIAR, SOLO CON DÍAS PAGADOS (26-oct): un mes sin contrato sumaba igual
   * sus S/ 123 a un sueldo de cero.
   */
  const asignacionFamiliar =
    datos.asignacionFamiliar && diasPagados > 0 ? rmv.valor * ASIGNACION_FAMILIAR : 0;

  // Cada falta: su día y la parte del descanso semanal que generaba.
  const porFalta = valorDia * (1 + PARTE_DEL_DESCANSO_POR_FALTA);
  const injustificadas = params.faltas.filter((f) => f.estado === 'injustificada').length;
  const sinRevisar = params.faltas.filter((f) => f.estado === 'sinRevisar').length;
  const justificadas = params.faltas.filter((f) => f.estado === 'justificada').length;

  /*
   * EL TURNO PARTIDO A MEDIAS SE DESCUENTA POR HORAS (26-oct). Quien vino a la mañana y no a
   * la tarde trabajó ese día: no es una falta de día —ni su sexto del descanso—, son las horas
   * de la tarde, a su valor, como las horas que debe. Las justificadas no descuentan.
   */
  const turnosQueDescuentan = (params.turnosSinTrabajar ?? []).filter(
    (turno) => turno.estado !== 'justificada',
  );
  const minutosSinTrabajar = turnosQueDescuentan.reduce(
    (suma, turno) => suma + Math.max(0, turno.minutos),
    0,
  );
  const montoSinTrabajar = (minutosSinTrabajar / 60) * valorHora;

  const minutosExtra = params.extrasPorDia.reduce((suma, m) => suma + Math.max(0, m), 0);
  const montoExtra = params.extrasPorDia.reduce(
    (suma, m) => suma + pagoDeHorasExtraDelDia(Math.max(0, m), valorHora),
    0,
  );
  const montoFeriados = params.feriadosTrabajados * valorDia * DIAS_DE_MAS_POR_FERIADO;
  const minutosQueDebe = Math.max(0, params.minutosQueDebe);
  const montoQueDebe = (minutosQueDebe / 60) * valorHora;

  const descuentos = porFalta * (injustificadas + sinRevisar) + montoSinTrabajar + montoQueDebe;
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
    diasConContrato,
    asignacionFamiliar: redondear(asignacionFamiliar),
    rmv: { valor: rmv.valor, norma: rmv.norma },
    faltas: { dias: injustificadas, monto: redondear(porFalta * injustificadas) },
    faltasSinRevisar: { dias: sinRevisar, monto: redondear(porFalta * sinRevisar) },
    faltasJustificadas: justificadas,
    turnosSinTrabajar: {
      turnos: turnosQueDescuentan.length,
      minutos: minutosSinTrabajar,
      monto: redondear(montoSinTrabajar),
      sinRevisar: turnosQueDescuentan.filter((turno) => turno.estado === 'sinRevisar').length,
    },
    horasExtra: { minutos: minutosExtra, monto: redondear(montoExtra) },
    feriados: { dias: params.feriadosTrabajados, monto: redondear(montoFeriados) },
    horasQueDebe: { minutos: minutosQueDebe, monto: redondear(montoQueDebe) },
    bruto: redondear(bruto),
    pension,
    neto: pension === null ? null : redondear(bruto - pension.monto),
    menorQueLaRmv: sueldo > 0 && sueldo < rmv.valor,
  };
}
