import type { Almacen, Fila } from './postgrest';
import { DEMO_LOCATION_1, TZ } from './seed';
import { dateKeyOf } from '@/features/schedules/week';

/**
 * Tres días distintos en la misma demostración.
 *
 * POR QUÉ HACE FALTA
 * Inicio ahora decide qué enseñar en grande según lo que pase HOY. Esa promesa solo se
 * puede comprobar viendo la misma pantalla en días distintos: si un día tranquilo y un
 * día con tres ausentes se ven igual, la priorización no está haciendo nada y ninguna
 * prueba unitaria lo denuncia —las cuentas pueden estar perfectas y la pantalla seguir
 * enseñándolas todas del mismo tamaño—.
 *
 * La semilla es relativa a AHORA, así que el día que salga depende de la hora a la que
 * se abra. Con esto se fija a propósito, y `scripts/inicio-check.mjs` abre los tres y
 * exige que se vean distintos.
 *
 * SOLO EN MODO DEMOSTRACIÓN, y se elige con `?escenario=` en la URL. En la app de
 * verdad no existe: no hay nada que sembrar, los días los trae la vida.
 */

export const ESCENARIOS = ['normal', 'tranquilo', 'ausentes', 'solicitudes'] as const;
export type Escenario = (typeof ESCENARIOS)[number];

export function escenarioDeLaUrl(): Escenario {
  if (typeof window === 'undefined') return 'normal';
  try {
    const pedido = new URLSearchParams(window.location.search).get('escenario');
    return (ESCENARIOS as readonly string[]).includes(pedido ?? '')
      ? (pedido as Escenario)
      : 'normal';
  } catch {
    // Una URL rara no puede tumbar la demostración entera.
    return 'normal';
  }
}

/**
 * ¿Ese instante cae hoy EN LA ZONA DE LA SEDE?
 *
 * Con la misma función que usa el tablero (`dateKeyOf`) y el mismo huso, y esto no es
 * una precaución teórica: la primera versión comparaba el día local del navegador. En
 * el contenedor donde corre el arnés la hora local es UTC, así que a las 02:13 UTC —las
 * 21:13 del día anterior en Lima— «hoy» eran dos días distintos según a quién se le
 * preguntara. Resultado: el escenario de ausentes sembraba turnos que el tablero
 * colocaba ayer y enseñaba cero ausentes, y solo pasaba a ciertas horas del día.
 */
const esHoy = (iso: unknown): boolean =>
  typeof iso === 'string' && dateKeyOf(iso, TZ) === dateKeyOf(new Date().toISOString(), TZ);

/** Quién tiene ya una sesión hoy: esa gente ni falta ni llega tarde. */
function conSesionHoy(almacen: Almacen): Set<string> {
  return new Set(
    (almacen.get('work_sessions') ?? [])
      .filter((fila) => esHoy(fila.starts_at))
      .map((fila) => String(fila.employee_id)),
  );
}

/**
 * Quita del tablero los fichajes incompletos y las solicitudes pendientes.
 *
 * Lo usan LOS TRES escenarios, y no por comodidad: un escenario que dice llamarse
 * «solicitudes» tiene que producir de verdad un día cuyo titular sean las solicitudes.
 * La primera versión se limitaba a añadir solicitudes y el titular seguía siendo «3
 * fichajes sin cerrar», porque un fichaje sin cerrar pesa más y la semilla ya traía
 * tres. O sea: un escenario que no producía su propio escenario, y el arnés lo cazó.
 */
function despejarLoDemas(almacen: Almacen): void {
  almacen.set(
    'work_sessions',
    (almacen.get('work_sessions') ?? []).map((sesion) =>
      sesion.status === 'needs_review' ? { ...sesion, status: 'complete', flags: [] } : sesion,
    ),
  );
  almacen.set(
    'daily_time_summary',
    (almacen.get('daily_time_summary') ?? []).map((fila) => ({
      ...fila,
      needs_review: false,
      flags: [],
    })),
  );
  almacen.set(
    'time_edit_requests',
    (almacen.get('time_edit_requests') ?? []).map((fila) => ({
      ...fila,
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    })),
  );
}

/** Deja en borrador los turnos de hoy que ya empezaron y nadie fichó: ni ausentes ni tardanzas. */
function cubrirTurnosDeHoy(almacen: Almacen): void {
  const ahora = new Date().toISOString();
  const fichados = conSesionHoy(almacen);
  almacen.set(
    'shifts',
    (almacen.get('shifts') ?? []).map((turno) =>
      esHoy(turno.starts_at) &&
      String(turno.starts_at) < ahora &&
      !fichados.has(String(turno.employee_id))
        ? { ...turno, status: 'draft', published_at: null }
        : turno,
    ),
  );
}

/**
 * Deja sin cubrir los turnos de hoy de `cuantos` personas: eso es una ausencia.
 *
 * SE QUITAN SUS SESIONES, no se inventan turnos nuevos. Un ausente es alguien que TENÍA
 * turno y NO fichó, así que el modelo correcto es borrar el fichaje, no añadir un turno
 * de más. Y además es lo único que funciona: en la semilla las doce personas menos una
 * ya han fichado hoy, así que «coger tres libres» encontraba una sola y el escenario
 * enseñaba «1 ausente» llamándose «día con ausentes».
 *
 * No se toca a quien está DENTRO ahora mismo: quitarle la sesión a alguien que la
 * pantalla enseña trabajando dejaría la demostración contradiciéndose a sí misma.
 */
function dejarSinCubrir(almacen: Almacen, cuantos: number): number {
  const ahora = new Date().toISOString();

  /*
   * SOLO EN LA SEDE QUE EL TABLERO ESTÁ MIRANDO. Sin este filtro se descubrían tres
   * turnos y la pantalla enseñaba dos, porque el tercero era de la otra sede y el
   * tablero, correctamente, no lo cuenta. El escenario prometía tres ausentes y el
   * arnés lo cazó: no era un fallo de la app, era el escenario sembrando donde no se
   * mira.
   */
  const candidatos: string[] = [];
  for (const turno of almacen.get('shifts') ?? []) {
    if (!esHoy(turno.starts_at) || turno.status !== 'published') continue;
    if (turno.location_id !== DEMO_LOCATION_1) continue;
    if (String(turno.ends_at) >= ahora) continue;
    const quien = String(turno.employee_id);
    if (candidatos.includes(quien)) continue;
    candidatos.push(quien);
    if (candidatos.length === cuantos) break;
  }

  const faltan = new Set(candidatos);

  /*
   * Se le quita TODO rastro de haber venido hoy: la sesión, la fila del resumen diario
   * y, si estaba, su presencia en «trabajando ahora». Las tres, porque una persona que
   * no vino tampoco está dentro: dejarla en «trabajando ahora» haría que la pantalla se
   * contradijera a sí misma —la cuenta diría «no llegó» y la lista de abajo la
   * enseñaría fichada— y una demostración que se contradice no demuestra nada.
   */
  almacen.set(
    'work_sessions',
    (almacen.get('work_sessions') ?? []).filter(
      (fila) => !(esHoy(fila.starts_at) && faltan.has(String(fila.employee_id))),
    ),
  );
  almacen.set(
    'daily_time_summary',
    (almacen.get('daily_time_summary') ?? []).filter(
      (fila) => !(faltan.has(String(fila.employee_id)) && fila.work_date === dateKeyOf(ahora, TZ)),
    ),
  );
  almacen.set(
    'employees_working_now',
    (almacen.get('employees_working_now') ?? []).filter(
      (fila) => !faltan.has(String(fila.employee_id)),
    ),
  );
  return candidatos.length;
}

export function aplicarEscenario(almacen: Almacen, escenario: Escenario): Almacen {
  if (escenario === 'normal') return almacen;

  // Los tres parten del mismo día limpio y añaden SOLO lo suyo. Si no, el titular lo
  // decidiría lo que arrastre la semilla y el escenario no significaría nada.
  despejarLoDemas(almacen);
  cubrirTurnosDeHoy(almacen);

  if (escenario === 'tranquilo') return almacen;

  if (escenario === 'ausentes') {
    dejarSinCubrir(almacen, 3);
    return almacen;
  }

  // 'solicitudes': la bandeja acumulada. Seis, que es cuando deja de ser una cosa
  // suelta y pasa a ser trabajo atrasado.
  const base = almacen.get('time_edit_requests') ?? [];
  const clonadas: Fila[] = [];
  for (let i = 0; i < 6; i += 1) {
    const plantilla = base[i % Math.max(1, base.length)];
    if (plantilla === undefined) break;
    clonadas.push({
      ...plantilla,
      id: `88888888-8888-4888-8888-${String(i + 1).padStart(12, '0')}`,
      // TODAS en la sede que el tablero está mirando. Las dos de la semilla están en
      // sedes distintas, así que clonarlas alternando dejaba la mitad en la otra sede:
      // se sembraban seis y la pantalla enseñaba tres.
      location_id: DEMO_LOCATION_1,
      status: 'pending',
      reviewed_at: null,
    });
  }
  if (clonadas.length > 0) almacen.set('time_edit_requests', clonadas);
  return almacen;
}
