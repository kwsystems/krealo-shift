import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import { minutesBetween } from '@/utils/time';
import { sesionDelTurno } from '@/features/reports/bono';
import type { WorkSession } from '@/features/timesheets/api';
import { OPEN_SESSION_ALERT_MINUTES } from '@/features/timesheets/alerts';
import { minutosEnCurso } from '@/features/timesheets/en-curso';
import { estadoDeFalta, faltasDeLosTurnos } from '@/features/timesheets/faltas';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';

/**
 * LO QUE VE EL VENDEDOR, día por día y en el mes, a partir de sus turnos y sus jornadas.
 *
 * «Tarde» es la MISMA marca que usa el resto de la app —`late_arrival`, pasada la tolerancia
 * de la sede—: si aquí se calculara por su cuenta, el vendedor vería «a tiempo» un día que
 * el panel marca como tarde, y la conversación sobre el bono empezaría con dos verdades.
 *
 * «Antes de hora» es lo único que se calcula aquí: el panel no lo marca porque no es un
 * problema, pero Andree pidió que cada uno vea si llegó temprano.
 *
 * «FALTA», CON LA REGLA DE TODA LA APP (1-oct). Antes aquí no se decía: con solo sus
 * propios datos no se sabía desde cuándo su tienda usa el reloj, y un turno de antes de eso
 * no es una falta. Ahora esa fecha la da el servidor (`viewClockStart`) y la falta es la de
 * `timesheets/faltas.ts`: la misma que ve quien administra en Horario, Horas y Reportes, y la
 * que mira el bono. Un turno sin marca de ANTES del reloj sigue diciéndose «sin marca».
 *
 * Y CON LO QUE SE DIJO DE ELLA (2-oct): si quien administra la justificó, el día dice
 * «Falta justificada» con el motivo, en ámbar; sin justificar, sigue en rojo con el motivo.
 * Lo mismo que ve quien administra, en su celular.
 */

export type EstadoDelDia =
  /** Sin turno ese día. */
  | 'libre'
  /** Tenía un turno publicado y quien gestiona lo está cambiando: aún no lo volvió a publicar. */
  | 'porConfirmar'
  /** Turno que aún no llegó. */
  | 'porVenir'
  /** Hoy, dentro o antes del turno, sin haber marcado todavía. */
  | 'hoy'
  /** Marcó y entró a tiempo (o antes). */
  | 'aTiempo'
  /** Marcó con «Entrada tardía». */
  | 'tarde'
  /** Está trabajando ahora mismo. */
  | 'enCurso'
  /** Turno terminado sin ninguna jornada, desde que su tienda usa el reloj: una falta. */
  | 'falta'
  /** Una falta que quien administra justificó: no le quita el bono. */
  | 'faltaJustificada'
  /** Turno terminado sin ninguna jornada de antes del reloj, o sin saber aún desde cuándo. */
  | 'sinMarca'
  /** Entró y no marcó la salida, y ya pasó más de lo que dura un turno: ver `jornadaOlvidada`. */
  | 'sinSalida';

export type DiaDelVendedor = {
  dia: DateKey;
  turnos: ShiftRow[];
  jornadas: WorkSession[];
  estado: EstadoDelDia;
  /** Minutos que entró antes de la hora del turno, si fue antes. */
  minutosAntes: number | null;
  /** Minutos netos trabajados ese día, con lo que lleva si sigue dentro. */
  minutosNetos: number;
  /** Los turnos de ese día que faltó: ver `timesheets/faltas.ts`. */
  faltas: ShiftRow[];
  /** Lo que se dijo de esas faltas, de las que ya se dijo algo. */
  justificaciones: ResolucionDeFalta[];
  /**
   * SUS TURNOS QUE ESTÁN CAMBIANDO (4-oct): ya se le publicaron una vez y quien gestiona
   * los editó sin volver a publicar —el «Cambiado» de Horario—. Antes desaparecían de su
   * celular y el día salía «Libre» hasta la nueva publicación: le decía que no trabajaba
   * justo cuando su turno se estaba moviendo. No cuentan para nada más —ni faltas, ni
   * horas—, igual que en Horario e Inicio: solo se enseñan, dichos como lo que son.
   */
  porConfirmar: ShiftRow[];
};

/** Un turno que ya se publicó y ahora está en borrador: el «Cambiado» de Horario. */
export function estaPorConfirmar(turno: Pick<ShiftRow, 'status' | 'publication_version'>): boolean {
  return turno.status === 'draft' && (turno.publication_version ?? 0) > 0;
}

const MIN = 60 * 1000;

/**
 * Una jornada abierta más de lo que dura un turno es una salida olvidada (2-oct), con la
 * regla de Horas (`OPEN_SESSION_ALERT_MINUTES`): no está trabajando, y sus horas no se
 * saben hasta que alguien ponga la salida.
 */
export function jornadaOlvidada(jornada: WorkSession, nowISO: string): boolean {
  return (
    jornada.ends_at === null &&
    minutesBetween(jornada.starts_at, nowISO) > OPEN_SESSION_ALERT_MINUTES
  );
}

/**
 * Minutos netos de una jornada; si sigue abierta, lo que lleva hasta ahora con LA CUENTA DE
 * HORAS Y EQUIPO (`minutosEnCurso`): sin los descansos ya tomados y parada mientras está en
 * su pausa (`descansoDesde`). Antes aquí se redondeaba y se seguía contando durante el
 * refrigerio, así que el celular decía un minuto más que Horas, o una hora más a la hora
 * de comer. Una salida olvidada no suma nada: sus horas no se saben.
 */
export function minutosDeLaJornada(
  jornada: WorkSession,
  nowISO: string,
  descansoDesde: string | null = null,
): number {
  if (jornada.ends_at !== null) return jornada.net_minutes ?? 0;
  if (jornadaOlvidada(jornada, nowISO)) return 0;
  return minutosEnCurso(
    jornada,
    descansoDesde === null ? undefined : { estado: 'descanso', descansoDesde },
    nowISO,
  );
}

export function diasDelVendedor(params: {
  dias: DateKey[];
  turnos: readonly ShiftRow[];
  jornadas: readonly WorkSession[];
  timezone: string;
  nowISO: string;
  /** Desde qué día usa el reloj cada sede; `undefined` mientras no se sabe. */
  relojDesde?: (locationId: string) => DateKey | null | undefined;
  /** Lo que se dijo de sus faltas. */
  resoluciones?: readonly ResolucionDeFalta[];
  /** Si está en su pausa ahora, desde cuándo: sus horas de hoy se paran ahí. */
  descansoDesde?: string | null;
}): DiaDelVendedor[] {
  const { dias, turnos, jornadas, timezone, nowISO } = params;
  const faltas = faltasDeLosTurnos({
    turnos,
    jornadas,
    relojDesde: params.relojDesde ?? (() => undefined),
    ahoraISO: nowISO,
    timezone,
    resoluciones: params.resoluciones,
  });
  const ahora = Date.parse(nowISO);
  const hoy = dateKeyOf(nowISO, timezone);

  return dias.map((dia) => {
    const suyos = turnos
      .filter((t) => t.status === 'published' && dateKeyOf(t.starts_at, timezone) === dia)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const porConfirmar = turnos
      .filter((t) => estaPorConfirmar(t) && dateKeyOf(t.starts_at, timezone) === dia)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const delDia = jornadas
      .filter((j) => dateKeyOf(j.starts_at, timezone) === dia)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const minutosNetos = delDia.reduce(
      (suma, j) => suma + minutosDeLaJornada(j, nowISO, params.descansoDesde ?? null),
      0,
    );

    const primerTurno = suyos[0];
    const primeraJornada =
      primerTurno === undefined ? delDia[0] : (sesionDelTurno(primerTurno, delDia) ?? delDia[0]);

    let minutosAntes: number | null = null;
    if (primerTurno !== undefined && primeraJornada !== undefined) {
      const antes = Math.round(
        (Date.parse(primerTurno.starts_at) - Date.parse(primeraJornada.starts_at)) / MIN,
      );
      minutosAntes = antes > 0 ? antes : null;
    }

    const estado = ((): EstadoDelDia => {
      if (delDia.some((j) => j.ends_at === null && !jornadaOlvidada(j, nowISO))) return 'enCurso';
      if (delDia.some((j) => jornadaOlvidada(j, nowISO))) return 'sinSalida';
      if (primeraJornada !== undefined) {
        return primeraJornada.flags.includes('late_arrival') ? 'tarde' : 'aTiempo';
      }
      if (primerTurno === undefined) return porConfirmar.length > 0 ? 'porConfirmar' : 'libre';
      const faltasDelDia = faltas.filter((falta) => falta.dia === dia);
      if (faltasDelDia.length > 0) {
        return faltasDelDia.every((falta) => estadoDeFalta(falta) === 'justificada')
          ? 'faltaJustificada'
          : 'falta';
      }
      if (Date.parse(primerTurno.ends_at) <= ahora) return 'sinMarca';
      return dia === hoy ? 'hoy' : 'porVenir';
    })();

    return {
      dia,
      turnos: suyos,
      jornadas: delDia,
      estado,
      minutosAntes,
      minutosNetos,
      faltas: faltas.filter((falta) => falta.dia === dia).map((falta) => falta.turno),
      justificaciones: faltas.flatMap((falta) =>
        falta.dia === dia && falta.resolucion !== null ? [falta.resolucion] : [],
      ),
      porConfirmar,
    };
  });
}

export type ResumenDelMes = {
  minutosNetos: number;
  diasTrabajados: number;
  aTiempo: number;
  /** De los a tiempo, cuántos entró antes de la hora. */
  antesDeHora: number;
  tarde: number;
  /** Turnos que faltó: uno por turno, como los cuenta quien administra. */
  faltas: number;
  /** De esas, las justificadas. */
  faltasJustificadas: number;
  sinMarca: number;
};

export function resumenDelMes(dias: readonly DiaDelVendedor[]): ResumenDelMes {
  return {
    minutosNetos: dias.reduce((suma, d) => suma + d.minutosNetos, 0),
    diasTrabajados: dias.filter((d) => d.jornadas.length > 0).length,
    aTiempo: dias.filter((d) => d.estado === 'aTiempo').length,
    antesDeHora: dias.filter((d) => d.estado === 'aTiempo' && d.minutosAntes !== null).length,
    tarde: dias.filter((d) => d.estado === 'tarde').length,
    faltas: dias.reduce((suma, d) => suma + d.faltas.length, 0),
    faltasJustificadas: dias.reduce(
      (suma, d) => suma + d.justificaciones.filter((j) => j.kind === 'justified').length,
      0,
    ),
    sinMarca: dias.filter((d) => d.estado === 'sinMarca').length,
  };
}
