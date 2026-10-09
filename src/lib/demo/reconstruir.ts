import { DEFAULT_PAID_REASONS, type BreakReason } from '@/domain/break-reason';
import { elegirTurno, VENTANA_DE_BUSQUEDA_MS } from '@/domain/elegir-turno';
import {
  marcasDeLaSesion,
  marcasDentroDelTurno,
  sinSalidaAntesSiEsDeCorrido,
  type MarcaDeSesion,
} from '@/domain/marcas-de-sesion';
import { politicasDe } from '@/domain/politicas-de-sede';
import { turnoEnPie } from '@/features/schedules/turno-en-pie';

import type { Almacen, Fila } from './postgrest';
import { DEMO_ORG_ID } from './seed';

/**
 * Lo que el servidor hace con un fichaje, hecho dentro de la demostración.
 *
 * DE DONDE SALE. Andree, 2026-09-23, probando la demostración en su PC: fichó entrada en
 * el reloj y preguntó dónde verlo. La respuesta era «en ningún sitio», y eso convertía el
 * primer recorrido que intenta cualquiera —marco, y lo veo en el panel— en un recorrido
 * roto. Y roto de la peor forma: sin error, simplemente no aparecía, así que quien lo
 * pruebe concluye que el fichaje falló.
 *
 * QUÉ HACÍA ANTES. `registrarEventoDemo` guardaba dos cosas: el estado nuevo, para que el
 * reloj supiera si estás dentro, y el motivo si era una pausa. Nada más. Ni el evento ni
 * la sesión, así que el panel seguía enseñando únicamente lo sembrado.
 *
 * POR QUÉ NO SE HACE «MÁS SIMPLE». Sería tentador escribir una sesión a ojo y listo, pero
 * el panel no lee una tabla: lee cuatro, y tienen que cuadrar entre sí. `work_sessions`
 * alimenta las filas de Horas, `daily_time_summary` los totales de arriba,
 * `employees_working_now` la pantalla de Inicio, y `time_events` el detalle de la sesión.
 * Una demostración donde los totales no cuadran con las filas es peor que una donde no
 * aparece nada: enseña un producto que suma mal.
 *
 * SE RECONSTRUYE DESDE LOS EVENTOS, igual que el servidor. Es lo único que garantiza que
 * las cuatro digan lo mismo, porque las cuatro salen del mismo sitio.
 */

const MINUTO = 60_000;

type Evento = Fila & {
  event_type: string;
  occurred_at: string;
  break_type?: string | null;
  break_reason?: string | null;
  reclassified_as?: string | null;
};

const filas = (almacen: Almacen, tabla: string): Fila[] => almacen.get(tabla) ?? [];

/** El tipo con el que CUENTA el fichaje. Ver `functions/src/shared/eventos.ts`. */
const tipoEfectivo = (evento: Evento): string =>
  typeof evento.reclassified_as === 'string' && evento.reclassified_as !== ''
    ? evento.reclassified_as
    : evento.event_type;

const claveDeDia = (iso: string, zona: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

const minutos = (desde: string, hasta: string): number =>
  Math.max(0, Math.floor((Date.parse(hasta) - Date.parse(desde)) / MINUTO));

/**
 * Añade un fichaje y recalcula las cuatro tablas que lo enseñan.
 *
 * `zona` es la de la sede: decide a qué día se apunta la jornada, igual que en el
 * servidor. Ver la decisión sobre la zona horaria por sede en `docs/DECISIONES.md`.
 */
export function registrarFichajeDemo(
  almacen: Almacen,
  datos: {
    employeeId: string;
    locationId: string;
    eventType: string;
    breakReason?: string | null;
    breakNote?: string | null;
    zona: string;
    ahora?: Date;
  },
): void {
  const instante = (datos.ahora ?? new Date()).toISOString();
  const esPausa = datos.eventType === 'break_start';
  const motivo = (datos.breakReason ?? null) as BreakReason | null;
  const pagada = motivo === null ? false : (DEFAULT_PAID_REASONS[motivo] ?? false);

  almacen.set('time_events', [
    ...filas(almacen, 'time_events'),
    {
      // Un id que no choca con los sembrados y que ordena por llegada.
      id: `demo-fichaje-${filas(almacen, 'time_events').length + 1}`,
      organization_id: DEMO_ORG_ID,
      employee_id: datos.employeeId,
      location_id: datos.locationId,
      event_type: datos.eventType,
      break_type: esPausa ? (pagada ? 'paid' : 'unpaid') : null,
      break_reason: esPausa ? motivo : null,
      break_note: esPausa ? (datos.breakNote ?? null) : null,
      departure_reason: datos.eventType === 'clock_out' ? (datos.breakReason ?? null) : null,
      departure_note: datos.eventType === 'clock_out' ? (datos.breakNote ?? null) : null,
      occurred_at: instante,
      received_at: instante,
      source: 'kiosk',
      is_offline: false,
      reclassified_as: null,
    },
  ]);

  reconstruir(almacen, datos.employeeId, datos.locationId, datos.zona);
}

/**
 * Recalcula sesión, resumen diario y «trabajando ahora» de una persona.
 *
 * Mira SOLO desde su última entrada, igual que `rebuildWorkSession`: una pausa sin cerrar
 * de otro día no es una pausa abierta, es un olvido.
 */
function reconstruir(almacen: Almacen, employeeId: string, locationId: string, zona: string): void {
  const eventos = (filas(almacen, 'time_events') as Evento[])
    .filter((e) => e.employee_id === employeeId)
    .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));

  let inicio: Evento | undefined;
  const desdeEntrada: Evento[] = [];
  for (const evento of eventos) {
    if (tipoEfectivo(evento) === 'clock_in') {
      inicio = evento;
      desdeEntrada.length = 0;
    }
    if (inicio !== undefined) desdeEntrada.push(evento);
  }
  if (inicio === undefined) return;

  const salida = desdeEntrada.find((e) => tipoEfectivo(e) === 'clock_out');
  const abierta = salida === undefined;

  let pagados = 0;
  let noPagados = 0;
  let pausaAbierta: Evento | null = null;
  for (const evento of desdeEntrada) {
    const tipo = tipoEfectivo(evento);
    if (tipo === 'break_start') pausaAbierta = evento;
    if (tipo === 'break_end' && pausaAbierta !== null) {
      const mins = minutos(String(pausaAbierta.occurred_at), String(evento.occurred_at));
      if (pausaAbierta.break_type === 'paid') pagados += mins;
      else noPagados += mins;
      pausaAbierta = null;
    }
  }

  const startsAt = String(inicio.occurred_at);
  const endsAt = salida === undefined ? null : String(salida.occurred_at);
  const brutos = endsAt === null ? null : minutos(startsAt, endsAt);
  const netos = brutos === null ? null : brutos - noPagados;
  const sesionId = `demo-sesion-${employeeId}-${startsAt}`;

  /*
   * EL TURNO Y LAS MARCAS, COMO EL SERVIDOR (8-oct). Aquí se guardaba `shift_id: null` y
   * `flags: []`: quien fichaba en vivo en la demo nunca llegaba tarde ni salía antes, no tenía
   * turno y no abría ningún caso, mientras producción sí lo hacía. Las reglas son las mismas
   * que usa `functions/src/shared/attendance.ts`, desde `src/domain`.
   */
  const entradaMs = Date.parse(startsAt);
  const candidatos = filas(almacen, 'shifts').filter(
    (turno) =>
      turno.employee_id === employeeId &&
      turno.location_id === locationId &&
      turnoEnPie(turno as { status: string; publication_version?: number | null }) &&
      Math.abs(Date.parse(String(turno.starts_at)) - entradaMs) <= VENTANA_DE_BUSQUEDA_MS,
  );
  const elegido = elegirTurno(
    candidatos.map((turno) => ({
      id: String(turno.id),
      starts_at: String(turno.starts_at),
      ends_at: String(turno.ends_at),
      planned_unpaid_break_minutes: Number(turno.planned_unpaid_break_minutes ?? 0),
    })),
    startsAt,
    endsAt,
  );
  const hermanas =
    elegido === null
      ? []
      : filas(almacen, 'work_sessions').filter(
          (fila) =>
            fila.employee_id === employeeId && fila.shift_id === elegido.id && fila.id !== sesionId,
        );
  const antes = hermanas.filter((fila) => String(fila.starts_at) < startsAt);
  const despues = hermanas.filter((fila) => String(fila.starts_at) > startsAt);
  const sede = filas(almacen, 'locations').find((fila) => fila.id === locationId) ?? {};
  const marcas = sinSalidaAntesSiEsDeCorrido(
    marcasDentroDelTurno(
      marcasDeLaSesion({
        turno: elegido === null ? null : { starts_at: elegido.starts_at, ends_at: elegido.ends_at },
        entrada: startsAt,
        salida: endsAt,
        politicas: politicasDe(sede),
      }),
      { esLaPrimera: antes.length === 0, esLaUltima: despues.length === 0 },
    ),
    elegido,
    hermanas.length === 0 && endsAt !== null
      ? [
          {
            starts_at: startsAt,
            ends_at: endsAt,
            paid_break_minutes: pagados,
            unpaid_break_minutes: noPagados,
          },
        ]
      : [],
  );
  // A las hermanas se les quita la marca que dejó de ser suya, como en el servidor.
  if (hermanas.length > 0) {
    almacen.set(
      'work_sessions',
      filas(almacen, 'work_sessions').map((fila) => {
        const quitar = antes.includes(fila)
          ? 'early_departure'
          : despues.includes(fila)
            ? 'late_arrival'
            : null;
        const suyas = (fila.flags as MarcaDeSesion[] | undefined) ?? [];
        return quitar !== null && suyas.includes(quitar)
          ? { ...fila, flags: suyas.filter((marca) => marca !== quitar) }
          : fila;
      }),
    );
  }

  // Lo que ya se decidió sobre ella —casos, avisos vistos— se queda, como el `merge` del servidor.
  const previa = filas(almacen, 'work_sessions').find((fila) => fila.id === sesionId) ?? {};
  const sesion: Fila = {
    ...previa,
    id: sesionId,
    organization_id: DEMO_ORG_ID,
    employee_id: employeeId,
    location_id: locationId,
    shift_id: elegido?.id ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    gross_minutes: brutos,
    paid_break_minutes: pagados,
    unpaid_break_minutes: noPagados,
    net_minutes: netos,
    status: abierta ? 'open' : 'complete',
    flags: marcas,
    departure_reason: salida?.departure_reason ?? null,
    departure_note: salida?.departure_note ?? null,
    updated_at: new Date().toISOString(),
  };

  almacen.set('work_sessions', [
    ...filas(almacen, 'work_sessions').filter((f) => f.id !== sesionId),
    sesion,
  ]);

  /*
   * EL RESUMEN DIARIO SE SUMA, no se sustituye: puede haber ya una fila sembrada de esa
   * persona ese día, y machacarla haría que los totales de arriba dejaran de cuadrar con
   * las filas de abajo. Se recalcula desde TODAS sus sesiones del día, que es lo único
   * que no se descuadra por añadir una más.
   */
  const dia = claveDeDia(startsAt, zona);
  const susSesiones = filas(almacen, 'work_sessions').filter(
    (f) =>
      f.employee_id === employeeId &&
      typeof f.starts_at === 'string' &&
      claveDeDia(f.starts_at, zona) === dia,
  );

  const total = (campo: string) => susSesiones.reduce((suma, f) => suma + Number(f[campo] ?? 0), 0);

  almacen.set('daily_time_summary', [
    ...filas(almacen, 'daily_time_summary').filter(
      (f) => !(f.employee_id === employeeId && f.work_date === dia),
    ),
    {
      employee_id: employeeId,
      location_id: locationId,
      work_date: dia,
      sessions: susSesiones.length,
      gross_minutes: total('gross_minutes'),
      paid_break_minutes: total('paid_break_minutes'),
      unpaid_break_minutes: total('unpaid_break_minutes'),
      net_minutes: total('net_minutes'),
      needs_review: false,
      flags: [],
    },
  ]);

  /*
   * «TRABAJANDO AHORA» es la pantalla de Inicio, y es donde de verdad se nota que el
   * fichaje llegó: entras al panel y la persona está ahí. Se quita al salir, porque una
   * lista de gente dentro que incluye a quien ya se fue no sirve para nada.
   */
  const empleado = filas(almacen, 'employees').find((f) => f.id === employeeId);
  const resto = filas(almacen, 'employees_working_now').filter((f) => f.employee_id !== employeeId);

  almacen.set(
    'employees_working_now',
    abierta
      ? [
          ...resto,
          {
            organization_id: DEMO_ORG_ID,
            location_id: locationId,
            work_session_id: sesionId,
            employee_id: employeeId,
            full_name: empleado?.full_name ?? 'Empleado',
            preferred_name: empleado?.preferred_name ?? null,
            starts_at: startsAt,
            shift_id: elegido?.id ?? null,
            break_started_at: pausaAbierta === null ? null : String(pausaAbierta.occurred_at),
            // El motivo de la pausa, como lo devuelve el servidor: ver `viewEmployeesWorkingNow`.
            break_reason:
              pausaAbierta === null ? null : ((pausaAbierta.break_reason as string | null) ?? null),
            attendance_state: pausaAbierta === null ? 'WORKING' : 'ON_BREAK',
          },
        ]
      : resto,
  );
}
