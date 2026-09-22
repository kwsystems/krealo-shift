/**
 * El escenario «ausentes» tiene que producir sus tres ausencias A CUALQUIER HORA Y
 * CUALQUIER DÍA.
 *
 * POR QUÉ EXISTE ESTA PRUEBA
 * `npm run inicio:check` pasaba o fallaba según CUÁNDO se corriera. Observado: a las
 * 11:34 «el titular dice 2 y el escenario siembra 3», y tres minutos después, con el
 * mismo código, pasaba con 3. Un arnés que falla por el reloj se acaba ignorando, y un
 * arnés ignorado es peor que no tenerlo: da la sensación de que algo está comprobado
 * cuando ya nadie lo mira.
 *
 * MEDIDO, y es mucho peor de lo que parecía. El tablero solo cuenta como ausencia un
 * turno de hoy QUE YA TERMINÓ sin que nadie fichara —con razón: mientras el turno sigue
 * abierto la persona todavía puede llegar—, y recorriendo la semilla hora a hora los
 * siete días salen tres agujeros, no uno:
 *
 *   1. ENTRE SEMANA, SOLO DE 20:00 UTC EN ADELANTE. Los turnos de la semilla acaban a
 *      las 14:00 y las 20:00 UTC, así que antes de esa hora no ha terminado ninguno.
 *   2. SÁBADO Y DOMINGO, NUNCA. El domingo la semilla no siembra —la tienda cierra— y
 *      el sábado lo siembra EN BORRADOR, y el tablero solo mira turnos publicados. De
 *      las 05:00 UTC del sábado a las 05:00 UTC del lunes hay cero turnos del día de la
 *      tienda.
 *   3. Y EL DÍA DE LA TIENDA NO EMPIEZA CUANDO EL DEL PROCESO. La semilla arma sus días
 *      con la hora local del proceso —UTC en el contenedor— y el tablero pregunta «¿es
 *      hoy?» en la zona de la sede, que va cinco horas por detrás: la frontera está a
 *      las 05:00 UTC y corre qué turnos cuentan como de hoy.
 *
 * O sea que el arnés no fallaba de vez en cuando: pasaba de vez en cuando.
 *
 * Esto mueve el reloj del sistema por los siete días de la semana y por todo el día, y
 * exige las tres ausencias en todos. El arnés sigue comprobando la PANTALLA; esto
 * comprueba que los datos que la pantalla va a leer existen siempre, que es lo que
 * fallaba, y lo hace en un segundo en vez de pedir catorce ejecuciones del navegador a
 * horas distintas.
 */

import { aplicarEscenario } from '@/lib/demo/escenarios';
import { crearAlmacen, DEMO_LOCATION_1, TZ } from '@/lib/demo/seed';
import type { Almacen, Fila } from '@/lib/demo/postgrest';
import { dateKeyOf, localDateTimeToInstant } from '@/features/schedules/week';

const CUANTAS_PROMETE = 3;

/**
 * Los siete días de una semana: del domingo 2026-09-20 al sábado 2026-09-26. Hacen
 * falta los siete porque el fin de semana falla por un motivo distinto que los días
 * laborables —no hay turno publicado que dejar sin cubrir, en vez de haberlos sin
 * terminar— y una prueba que solo mirara un martes daría verde sobre los dos rotos.
 */
const DIAS = [
  '2026-09-20',
  '2026-09-21',
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
];

/**
 * Horas repartidas por el día, EN UTC, que es el huso en el que corre el contenedor del
 * CI. Elegidas para pisar las fronteras: 05:00 es cuando cambia el día DE LA TIENDA,
 * 13:59 la hora exacta a la que se midieron cero ausencias, y 20:45 la primera a la que
 * la semilla traía alguna por su cuenta.
 */
const HORAS_UTC = ['00:01', '02:13', '05:01', '08:00', '11:34', '13:59', '17:00', '20:45', '23:59'];

const CUANDO = DIAS.flatMap((dia) => HORAS_UTC.map((hora) => [dia, hora] as const));

/**
 * Cuenta las ausencias COMO LAS CUENTA EL TABLERO.
 *
 * Es a propósito una copia de la regla de `use-manager-dashboard.ts` y no una llamada a
 * mi propio ayudante: comprobar el escenario con la misma función que lo construye sería
 * comprobarlo contra sí mismo. La regla, allí: turno publicado, de hoy en la zona de la
 * sede, de alguien que no está dentro ahora mismo y no tiene ninguna sesión hoy, y que
 * YA TERMINÓ. Se cuenta por turno, no por persona, igual que allí.
 */
function ausenciasQueVeElTablero(almacen: Almacen): Fila[] {
  const ahora = new Date().toISOString();
  const hoy = dateKeyOf(ahora, TZ);
  const dentroAhora = new Set(
    (almacen.get('employees_working_now') ?? []).map((fila) => String(fila.employee_id)),
  );
  const conSesionHoy = new Set(
    (almacen.get('work_sessions') ?? [])
      .filter((fila) => dateKeyOf(String(fila.starts_at), TZ) === hoy)
      .map((fila) => String(fila.employee_id)),
  );
  return (almacen.get('shifts') ?? []).filter(
    (turno) =>
      turno.status === 'published' &&
      turno.location_id === DEMO_LOCATION_1 &&
      dateKeyOf(String(turno.starts_at), TZ) === hoy &&
      !dentroAhora.has(String(turno.employee_id)) &&
      !conSesionHoy.has(String(turno.employee_id)) &&
      String(turno.ends_at) < ahora,
  );
}

const ponerElReloj = (dia: string, horaUTC: string, ms = 0) => {
  jest.setSystemTime(new Date(`${dia}T${horaUTC}:00.${String(ms).padStart(3, '0')}Z`));
};

describe('el escenario «ausentes» a cualquier hora y cualquier día', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it.each(CUANDO)('produce las tres ausencias el %s a las %s UTC', (dia, horaUTC) => {
    ponerElReloj(dia, horaUTC);
    const ausencias = ausenciasQueVeElTablero(aplicarEscenario(crearAlmacen(), 'ausentes'));
    expect(ausencias.length).toBeGreaterThanOrEqual(CUANTAS_PROMETE);
  });

  /**
   * Y que los turnos colocados sigan siendo turnos: de hoy EN LA ZONA DE LA SEDE y sin
   * empezar antes de la medianoche de la tienda. Si se colaran al día anterior el
   * tablero dejaría de contarlos y volveríamos al fallo del huso, esta vez en silencio.
   */
  it.each(CUANDO)('y los coloca dentro del día de la tienda el %s a las %s UTC', (dia, horaUTC) => {
    ponerElReloj(dia, horaUTC);
    const ahora = new Date().toISOString();
    const medianoche = localDateTimeToInstant(dateKeyOf(ahora, TZ), '00:00', TZ);
    expect(medianoche).not.toBeNull();

    for (const turno of ausenciasQueVeElTablero(aplicarEscenario(crearAlmacen(), 'ausentes'))) {
      expect(String(turno.starts_at) >= String(medianoche)).toBe(true);
      expect(String(turno.starts_at) <= String(turno.ends_at)).toBe(true);
      expect(String(turno.ends_at) < ahora).toBe(true);
    }
  });

  /**
   * EL CONTROL: que el arreglo haga falta de verdad.
   *
   * Cuenta, en cada una de las 63 combinaciones, a cuánta gente podía llegar la versión
   * ANTERIOR —la que solo sabía usar turnos de hoy YA TERMINADOS— y exige que se quede
   * corta en la mayoría. Si dejara de quedarse corta, las pruebas de arriba estarían
   * pasando porque el calendario coopera y no porque el escenario garantice nada.
   *
   * SE CUENTAN COMBINACIONES Y NO SE FIJA UN DÍA Y UNA HORA CONCRETOS, y eso lo enseñó
   * correr las pruebas en otra zona: las dos primeras versiones de este control decían
   * «a las 13:59 UTC no hay NINGÚN turno terminado» y «el fin de semana no hay NI UNO
   * publicado», y las dos eran ciertas en UTC y en Lima y falsas en Madrid y en Tokio,
   * porque la semilla arma sus días con la hora DEL PROCESO. O sea que el control tenía
   * el mismo defecto que la cosa que vigila. Lo que sí es propiedad del escenario, y no
   * de dónde corra, es que la semilla no llega sola a las tres casi nunca.
   */
  it('hacía falta: con solo los turnos ya terminados no se llega a tres casi nunca', () => {
    const cortas: string[] = [];
    for (const [dia, horaUTC] of CUANDO) {
      ponerElReloj(dia, horaUTC);
      const ahora = new Date().toISOString();
      const hoy = dateKeyOf(ahora, TZ);
      const alcanzables = new Set<string>();
      for (const turno of crearAlmacen().get('shifts') ?? []) {
        if (turno.status !== 'published') continue;
        if (turno.location_id !== DEMO_LOCATION_1) continue;
        if (dateKeyOf(String(turno.starts_at), TZ) !== hoy) continue;
        if (String(turno.ends_at) >= ahora) continue;
        alcanzables.add(String(turno.employee_id));
      }
      if (alcanzables.size < CUANTAS_PROMETE) cortas.push(`${dia} ${horaUTC}`);
    }
    // El fallo de Jest ya dice el número, que es el dato que hace falta para saber si el
    // control sigue mordiendo o si la semilla cambió.
    expect(cortas.length).toBeGreaterThan(CUANDO.length / 2);
  });

  /**
   * LO ÚNICO QUE NO SE PUEDE GARANTIZAR, dicho en voz alta en vez de escondido.
   *
   * En el instante EXACTO en que empieza el día de la tienda no puede haber ninguna
   * ausencia, y no es un fallo del escenario: el tablero pide un turno que empiece hoy y
   * termine antes de ahora, y en ese instante «hoy» y «ahora» son el mismo punto, así
   * que no existe ningún hueco donde meterlo. Un milisegundo después ya sí.
   *
   * Antes el agujero eran horas y días; ahora es un milisegundo de cada 86.400.000, y
   * queda fijado aquí para que se vea que es ese y no otro.
   */
  it('en el primer instante del día de la tienda no hay ausencias, y un milisegundo después sí', () => {
    ponerElReloj('2026-09-22', '05:00', 0);
    expect(ausenciasQueVeElTablero(aplicarEscenario(crearAlmacen(), 'ausentes'))).toHaveLength(0);

    ponerElReloj('2026-09-22', '05:00', 1);
    expect(
      ausenciasQueVeElTablero(aplicarEscenario(crearAlmacen(), 'ausentes')).length,
    ).toBeGreaterThanOrEqual(CUANTAS_PROMETE);
  });
});
