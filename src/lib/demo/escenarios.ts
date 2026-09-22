import type { Almacen, Fila } from './postgrest';
import { DEMO_LOCATION_1, TZ } from './seed';
import { dateKeyOf, localDateTimeToInstant } from '@/features/schedules/week';

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
 * SOLO EN LA SEDE QUE EL TABLERO ESTÁ MIRANDO. Sin ese filtro se descubrían tres turnos
 * y la pantalla enseñaba dos, porque el tercero era de la otra sede y el tablero,
 * correctamente, no lo cuenta. El escenario prometía tres ausentes y el arnés lo cazó:
 * no era un fallo de la app, era el escenario sembrando donde no se mira.
 *
 * Y AHORA LAS GARANTIZA A CUALQUIER HORA Y CUALQUIER DÍA, que es lo que no hacía.
 *
 * El tablero solo cuenta como ausencia un turno de hoy QUE YA TERMINÓ sin que nadie
 * fichara, y con razón: mientras el turno sigue abierto la persona todavía puede llegar.
 * La versión anterior se limitaba a buscar esos turnos, y por eso `inicio:check` pasaba
 * o fallaba según cuándo se corriera. Recorriendo la semilla hora a hora los siete días
 * salen TRES agujeros, no uno:
 *
 *   1. ENTRE SEMANA, SOLO DE 20:00 UTC EN ADELANTE. Los turnos de la semilla acaban a
 *      las 14:00 y las 20:00 UTC, así que antes no ha terminado ninguno. Medido: a las
 *      13:59 UTC el escenario producía CERO ausencias y se veía exactamente igual que el
 *      día tranquilo.
 *   2. SÁBADO Y DOMINGO, NUNCA. El domingo la semilla no siembra —la tienda cierra— y el
 *      sábado lo siembra EN BORRADOR, y el tablero solo mira turnos publicados. De las
 *      05:00 UTC del sábado a las 05:00 UTC del lunes hay cero turnos del día de la
 *      tienda: ni terminados ni abiertos.
 *   3. Y EL DÍA DE LA TIENDA NO EMPIEZA CUANDO EL DEL PROCESO. La semilla arma sus días
 *      con la hora local del proceso —UTC en el contenedor— y el tablero pregunta «¿es
 *      hoy?» en la zona de la sede, cinco horas por detrás: la frontera está a las 05:00
 *      UTC y corre qué turnos cuentan como de hoy.
 *
 * O sea que el arnés no fallaba de vez en cuando: pasaba de vez en cuando.
 *
 * Así que en vez de esperar que el calendario coopere, los turnos que hagan falta SE
 * COLOCAN en el trozo de día que ya ha pasado: son datos sembrados y se pueden poner
 * donde convenga. Se prefieren, en este orden, los que ya terminaron hoy (no hay que
 * tocarlos), los de hoy que siguen abiertos, y los de los días de al lado —que es lo que
 * salva el fin de semana—. Lo que NO se hace es bajar el número que el arnés exige, que
 * es la forma fácil de que deje de fallar y también de que deje de comprobar.
 *
 * El domingo eso enseña turnos en un día en que la tienda cierra. Es a propósito: el
 * escenario es un día de mentira pedido con `?escenario=ausentes` para ver la pantalla
 * con ausencias, no una afirmación sobre el calendario de la tienda.
 *
 * Los huecos se reparten por lo que va de día en vez de amontonarse en el mismo minuto,
 * y ninguno cae antes de la medianoche DE LA TIENDA: un turno que empezara ayer ya no
 * sería «de hoy» para el tablero y volveríamos al punto 2.
 */
function dejarSinCubrir(almacen: Almacen, cuantos: number): number {
  const ahora = new Date().toISOString();
  const ahoraMs = Date.parse(ahora);
  const medianoche = localDateTimeToInstant(dateKeyOf(ahora, TZ), '00:00', TZ);
  const inicioDelDia = medianoche === null ? ahoraMs : Date.parse(medianoche);
  const loQueVaDeDia = Math.max(0, ahoraMs - inicioDelDia);

  const publicadosAqui = (almacen.get('shifts') ?? []).filter(
    (turno) => turno.status === 'published' && turno.location_id === DEMO_LOCATION_1,
  );
  const distanciaAAhora = (turno: Fila) =>
    Math.abs(Date.parse(String(turno.starts_at)) - ahoraMs) || Number.MAX_SAFE_INTEGER;

  const yaSonAusencia = publicadosAqui.filter(
    (turno) => esHoy(turno.starts_at) && String(turno.ends_at) < ahora,
  );
  const deHoyAbiertos = publicadosAqui.filter(
    (turno) => esHoy(turno.starts_at) && String(turno.ends_at) >= ahora,
  );
  const deOtroDia = publicadosAqui
    .filter((turno) => !esHoy(turno.starts_at))
    .sort((a, b) => distanciaAAhora(a) - distanciaAAhora(b));

  const faltan = new Set<string>();
  const porColocar: Fila[] = [];
  for (const grupo of [yaSonAusencia, deHoyAbiertos, deOtroDia]) {
    for (const turno of grupo) {
      if (faltan.size === cuantos) break;
      const quien = String(turno.employee_id);
      if (faltan.has(quien)) continue;
      faltan.add(quien);
      if (grupo !== yaSonAusencia) porColocar.push(turno);
    }
  }

  if (porColocar.length > 0) {
    const nuevasHoras = new Map<string, { starts_at: string; ends_at: string }>();
    porColocar.forEach((turno, indice) => {
      /*
       * El reparto se REDONDEA HACIA ABAJO y se topa un milisegundo antes de `ahora`, y
       * las dos cosas hacen falta: con `Math.round` y un día recién empezado —un
       * milisegundo— dos de los tres turnos caían exactamente en `ahora`, y el tablero
       * pide `ends_at < ahora`, no `<=`. Salían una ausencia de tres.
       */
      const fin =
        inicioDelDia +
        Math.min(
          Math.max(0, loQueVaDeDia - 1),
          Math.floor((loQueVaDeDia * (indice + 1)) / (porColocar.length + 1)),
        );
      const duraba = Date.parse(String(turno.ends_at)) - Date.parse(String(turno.starts_at));
      const inicio = Math.max(inicioDelDia, fin - (Number.isFinite(duraba) ? duraba : 0));
      nuevasHoras.set(String(turno.id), {
        starts_at: new Date(inicio).toISOString(),
        ends_at: new Date(fin).toISOString(),
      });
    });
    almacen.set(
      'shifts',
      (almacen.get('shifts') ?? []).map((turno) => {
        const cambio = nuevasHoras.get(String(turno.id));
        return cambio === undefined ? turno : { ...turno, ...cambio };
      }),
    );
  }

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
  return faltan.size;
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
