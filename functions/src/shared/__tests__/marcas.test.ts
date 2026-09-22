import { DERIVA_MAXIMA_MINUTOS, marcasDeLaSesion } from '../marcas';

/**
 * Las marcas de la hoja de horas (§11.4).
 *
 * CADA CASO SE PRUEBA EN LAS DOS DIRECCIONES: que la marca aparezca cuando toca y que NO
 * aparezca cuando no toca. La segunda mitad es la que importa más de lo que parece: una
 * alerta que salta siempre deja de leerse, y entonces el aviso que sí importaba pasa
 * desapercibido entre el ruido. Eso es peor que no tener alertas.
 */

const TURNO = { starts_at: '2026-09-22T14:00:00.000Z', ends_at: '2026-09-22T22:00:00.000Z' };
const POLITICAS = { lateGraceMinutes: 5 };

const sesion = (extra: Partial<Parameters<typeof marcasDeLaSesion>[0]> = {}) =>
  marcasDeLaSesion({
    turno: TURNO,
    entrada: TURNO.starts_at,
    salida: TURNO.ends_at,
    politicas: POLITICAS,
    ...extra,
  });

describe('entrada tardía', () => {
  it('marca a quien llega más tarde que la tolerancia', () => {
    expect(sesion({ entrada: '2026-09-22T14:06:00.000Z' })).toContain('late_arrival');
  });

  it('NO marca a quien llega dentro de la tolerancia', () => {
    expect(sesion({ entrada: '2026-09-22T14:05:00.000Z' })).not.toContain('late_arrival');
  });

  it('NO marca a quien llega antes de su hora', () => {
    expect(sesion({ entrada: '2026-09-22T13:40:00.000Z' })).not.toContain('late_arrival');
  });

  /** Con tolerancia cero, un minuto tarde es tarde. Es una sede que lo quiere estricto. */
  it('respeta una tolerancia de cero', () => {
    expect(
      sesion({ entrada: '2026-09-22T14:01:00.000Z', politicas: { lateGraceMinutes: 0 } }),
    ).toContain('late_arrival');
  });
});

describe('salida anticipada', () => {
  /** El caso que motivó todo esto: turno hasta las 22:00 y se va a las 17:00. */
  it('marca a quien se va cinco horas antes', () => {
    expect(sesion({ salida: '2026-09-22T17:00:00.000Z' })).toContain('early_departure');
  });

  it('NO marca a quien se va dentro de la tolerancia', () => {
    expect(sesion({ salida: '2026-09-22T21:55:00.000Z' })).not.toContain('early_departure');
  });

  it('NO marca a quien se queda de más', () => {
    expect(sesion({ salida: '2026-09-22T22:30:00.000Z' })).not.toContain('early_departure');
  });

  /**
   * UNA SESION ABIERTA NO ES UNA SALIDA ANTICIPADA: es alguien que sigue trabajando.
   * Sin esto, toda persona dentro de la tienda apareceria marcada hasta que fichara
   * salida, y el aviso de quien se fue de verdad quedaria enterrado.
   */
  it('NO marca una sesión que sigue abierta', () => {
    expect(sesion({ salida: null })).not.toContain('early_departure');
  });
});

describe('sin turno programado', () => {
  it('marca a quien ficha sin turno', () => {
    expect(sesion({ turno: null })).toContain('unscheduled');
  });

  it('y entonces no inventa tardanza ni salida anticipada: no hay contra qué comparar', () => {
    const marcas = sesion({ turno: null, entrada: '2026-09-22T20:00:00.000Z' });
    expect(marcas).not.toContain('late_arrival');
    expect(marcas).not.toContain('early_departure');
  });

  it('NO marca a quien sí tiene turno', () => {
    expect(sesion()).not.toContain('unscheduled');
  });
});

describe('diferencia de reloj del aparato', () => {
  const desviado = (minutos: number) =>
    new Date(Date.parse(TURNO.starts_at) + minutos * 60_000).toISOString();

  it('marca cuando el reloj del aparato va muy adelantado', () => {
    expect(sesion({ entradaSegunElAparato: desviado(DERIVA_MAXIMA_MINUTOS + 1) })).toContain(
      'clock_drift',
    );
  });

  it('marca también cuando va muy atrasado', () => {
    expect(sesion({ entradaSegunElAparato: desviado(-(DERIVA_MAXIMA_MINUTOS + 1)) })).toContain(
      'clock_drift',
    );
  });

  it('NO marca una diferencia pequeña: el viaje de red no es un reloj mal puesto', () => {
    expect(sesion({ entradaSegunElAparato: desviado(1) })).not.toContain('clock_drift');
  });

  it('NO marca cuando el aparato no mandó su hora', () => {
    expect(sesion({ entradaSegunElAparato: null })).not.toContain('clock_drift');
  });

  /**
   * EN UN LOTE SIN CONEXION la distancia entre la hora del aparato y la de recepción es
   * el tiempo que el fichaje pasó en la cola, no un reloj mal puesto. Marcarlo ahí sería
   * avisar de algo normal en cada sincronización.
   */
  it('NO marca un fichaje sin conexión, por mucha diferencia que haya', () => {
    expect(sesion({ entradaSegunElAparato: desviado(-600), sinConexion: true })).not.toContain(
      'clock_drift',
    );
  });
});

describe('varias a la vez', () => {
  it('una sesión puede llegar tarde e irse pronto', () => {
    const marcas = sesion({
      entrada: '2026-09-22T15:00:00.000Z',
      salida: '2026-09-22T17:00:00.000Z',
    });
    expect(marcas).toContain('late_arrival');
    expect(marcas).toContain('early_departure');
  });

  it('una sesión puntual no tiene ninguna marca', () => {
    expect(sesion()).toEqual([]);
  });
});
