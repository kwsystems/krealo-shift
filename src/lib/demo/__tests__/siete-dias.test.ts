import { crearAlmacen, DEMO_LOCATION_1, DEMO_LOCATION_2 } from '../seed';

import { BREAK_REASONS } from '@/domain/break-reason';

/**
 * La demostración tiene que aguantar los SIETE días de la semana.
 *
 * POR QUÉ EXISTE. La semilla reparte los datos a partir del día de la semana, y eso ya
 * se rompió: un lunes, el bucle de días cerrados no corría ninguna vez, `break_intervals`
 * quedaba VACÍA y Reportes enseñaba «en qué se va el tiempo» en blanco mientras las filas
 * de Horas afirmaban que sí hubo descansos. La demostración se contradecía a sí misma un
 * día de cada siete, y nadie lo vio en meses porque nadie la abrió un lunes.
 *
 * LO QUE SUSTITUYE. Había una tarea abierta que decía, literalmente, «comprobar UN LUNES
 * que la prueba de pausas ya no falla». Una tarea que solo se puede verificar un día
 * concreto es una tarea que se queda abierta para siempre: hay que acordarse, y hay que
 * acordarse el día bueno. Con la semilla aceptando el instante, los siete días se
 * comprueban en dos segundos y en cada corrida del CI.
 *
 * No es hipotético que vuelva a pasar: cualquier cambio en el reparto de días puede
 * vaciar otra vez un día suelto, y el único síntoma sería una pantalla en blanco en una
 * demostración delante de un cliente.
 */

/** Lunes 21 de septiembre de 2026, a media mañana. Los siete días salen de aquí. */
const LUNES = new Date('2026-09-21T10:30:00');

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const filas = (almacen: ReturnType<typeof crearAlmacen>, tabla: string) => almacen.get(tabla) ?? [];

describe.each(DIAS.map((nombre, i) => [nombre, new Date(LUNES.getTime() + i * 86400000)]))(
  'la demostración sembrada un %s',
  (_nombre, instante) => {
    const almacen = crearAlmacen(instante as Date);

    /** EL FALLO ORIGINAL, en su forma exacta: la tabla vacía. */
    it('tiene pausas registradas, que es lo que un lunes se quedaba a cero', () => {
      expect(filas(almacen, 'break_intervals').length).toBeGreaterThan(0);
    });

    it('todas las pausas llevan un motivo que la app conoce', () => {
      for (const pausa of filas(almacen, 'break_intervals')) {
        expect(BREAK_REASONS).toContain(pausa.break_reason);
      }
    });

    /**
     * LA CONTRADICCIÓN, que es peor que el vacío: Horas decía que hubo descanso y
     * Reportes no tenía de dónde sacarlo. Si una sesión declara minutos de pausa, tiene
     * que haber intervalos de esa misma sesión que los respalden.
     */
    it('ninguna sesión afirma un descanso que no está en ninguna tabla', () => {
      const conPausa = filas(almacen, 'work_sessions').filter(
        (s) => Number(s.paid_break_minutes ?? 0) + Number(s.unpaid_break_minutes ?? 0) > 0,
      );
      expect(conPausa.length).toBeGreaterThan(0);

      const respaldadas = new Set(filas(almacen, 'break_intervals').map((p) => p.work_session_id));
      for (const sesion of conPausa) {
        expect(respaldadas.has(sesion.id)).toBe(true);
      }
    });

    it('las dos sedes tienen datos, no solo la primera', () => {
      const sedes = new Set(filas(almacen, 'work_sessions').map((s) => s.location_id));
      expect(sedes.has(DEMO_LOCATION_1)).toBe(true);
      expect(sedes.has(DEMO_LOCATION_2)).toBe(true);
    });

    /** Sin turnos publicados, el horario sale vacío y no hay nada que enseñar. */
    it('hay turnos publicados', () => {
      const publicados = filas(almacen, 'shifts').filter((t) => t.status === 'published');
      expect(publicados.length).toBeGreaterThan(0);
    });
  },
);

describe('la semilla inyectable', () => {
  it('sin argumento se comporta igual que siempre: usa el reloj de verdad', () => {
    const conAhora = crearAlmacen();
    const explicito = crearAlmacen(new Date());
    expect(filas(conAhora, 'employees').length).toBe(filas(explicito, 'employees').length);
    expect(filas(conAhora, 'break_intervals').length).toBe(
      filas(explicito, 'break_intervals').length,
    );
  });
});
