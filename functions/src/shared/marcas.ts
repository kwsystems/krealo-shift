/**
 * Las marcas de una sesión de trabajo: lo que el gerente ve en la hoja de horas cuando
 * algo no cuadra (§11.4).
 *
 * POR QUE EXISTE ESTE ARCHIVO. Hasta el 2026-09-22 `rebuildWorkSession` escribía
 * `flags: []` —fijo, vacío, siempre— y nadie más las calculaba. La pantalla de Horas
 * sabía pintar «Salida anticipada», «Entrada tardía», «Sin turno programado» y
 * «Diferencia de reloj»: tenía los textos, los iconos y el mapeo de cada marca. Nunca
 * recibió el dato. Cuatro alertas de adorno, y el panel se veía limpio mientras alguien
 * se iba cinco horas antes.
 *
 * ES UNA FUNCION PURA a propósito. Son cuatro decisiones sobre fechas y tolerancias, que
 * es exactamente donde se cuelan los errores de un minuto, y donde un error de un minuto
 * se paga en dinero. Aquí no se importa Firestore, así que se puede probar sin levantar
 * nada.
 *
 * LO QUE NO CALCULA, y es deliberado: `missing_clock_out`, `abnormal_duration` y
 * `overlap`. Esas tres las deriva el cliente en `src/features/timesheets/alerts.ts`
 * porque dependen de la hora actual o de las sesiones vecinas, no de la sesión sola.
 * Calcularlas también aquí sería tener dos verdades que pueden discrepar.
 */

export type MarcaDeSesion = 'late_arrival' | 'early_departure' | 'unscheduled' | 'clock_drift';

/**
 * Cuánto puede separarse el reloj del aparato del reloj del servidor antes de avisar.
 *
 * NO ES UN AJUSTE DE SEDE porque no es una política del negocio: es salud de un aparato.
 * Tres minutos es holgado para un fichaje EN LINEA —ahí las dos marcas se toman con
 * segundos de diferencia— y no salta por el viaje de red ni por el bcrypt del PIN.
 *
 * Y IMPORTA AUNQUE LA HORA LA PONGA EL SERVIDOR. Desde `fd65ea0` un fichaje en línea se
 * sella con el reloj del servidor, así que la hora del aparato no toca lo que se paga.
 * Pero un fichaje SIN CONEXION se guarda con la hora del aparato y se sincroniza después:
 * si ese reloj va mal, ahí sí se paga. Esta marca es el aviso temprano de un problema que
 * todavía no ha costado nada.
 */
export const DERIVA_MAXIMA_MINUTOS = 3;

export type DatosDeLaSesion = {
  /** El turno al que pertenece, si lo hay. */
  turno: { starts_at: string; ends_at: string } | null;
  /** Instante de la entrada, sellado por el servidor. */
  entrada: string;
  /** Instante de la salida, o `null` si la sesión sigue abierta. */
  salida: string | null;
  /** La hora que decía el aparato al fichar la entrada, si la mandó. */
  entradaSegunElAparato?: string | null;
  /** Lo mismo para la salida. */
  salidaSegunElAparato?: string | null;
  /**
   * Si la sesión se fichó sin conexión. CAMBIA LA LECTURA DE LA DERIVA: en un lote
   * offline, la distancia entre la hora del aparato y la de recepción es el tiempo que
   * estuvo en la cola, no un reloj mal puesto. Marcarlo ahí sería avisar de algo normal
   * en cada sincronización, y una alerta que salta siempre deja de leerse.
   */
  sinConexion?: boolean;
  /** Tolerancias de la sede. */
  politicas: { lateGraceMinutes: number };
};

const MINUTO = 60_000;

/** Milisegundos de una fecha ISO, o `null` si no lo es. */
function instante(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function derivaExcesiva(servidor: string, aparato: string | null | undefined): boolean {
  const a = instante(servidor);
  const b = instante(aparato);
  if (a === null || b === null) return false;
  return Math.abs(a - b) > DERIVA_MAXIMA_MINUTOS * MINUTO;
}

export function marcasDeLaSesion(datos: DatosDeLaSesion): MarcaDeSesion[] {
  const marcas = new Set<MarcaDeSesion>();

  /*
   * La tolerancia es la MISMA en las dos puntas del turno, y se reutiliza
   * `lateGraceMinutes` en vez de inventar un ajuste nuevo. Quien configura «cinco
   * minutos de tolerancia» está diciendo cuánto ruido acepta alrededor del turno, y no
   * hay motivo para que entrar tarde y salir pronto se midan distinto. Si algún día hace
   * falta separarlos, es un ajuste nuevo y una decisión, no un descuido de aquí.
   */
  const tolerancia = Math.max(0, Number(datos.politicas.lateGraceMinutes) || 0) * MINUTO;

  const entrada = instante(datos.entrada);
  const salida = instante(datos.salida);

  if (datos.turno === null) {
    marcas.add('unscheduled');
  } else {
    const inicioTurno = instante(datos.turno.starts_at);
    const finTurno = instante(datos.turno.ends_at);

    if (entrada !== null && inicioTurno !== null && entrada > inicioTurno + tolerancia) {
      marcas.add('late_arrival');
    }

    /*
     * SOLO CON LA SESION CERRADA. Una sesión abierta no es una salida anticipada: es
     * alguien que todavía está trabajando. Marcarla mientras sigue dentro llenaría la
     * pantalla de avisos que se resuelven solos al marcar salida, y el aviso que importa
     * —el de quien se fue de verdad— quedaría enterrado entre ellos.
     */
    if (salida !== null && finTurno !== null && salida < finTurno - tolerancia) {
      marcas.add('early_departure');
    }
  }

  if (datos.sinConexion !== true) {
    if (
      derivaExcesiva(datos.entrada, datos.entradaSegunElAparato) ||
      (datos.salida !== null && derivaExcesiva(datos.salida, datos.salidaSegunElAparato))
    ) {
      marcas.add('clock_drift');
    }
  }

  return [...marcas];
}
