// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
import '@/test-utils/encender-demo';

import { fetchWorkSessions } from '../api';
import { casosPorResolver } from '../casos';
import { arreglarCaso, fetchHorasDebidasDeLaSede } from '../horas-debidas';
import { aprobadasPorDia, deMasAlDecidirPorDia, fetchHorasExtra } from '../horas-extra';
import { fetchWeekShifts } from '@/features/schedules/api';
import {
  addDaysToKey,
  dateKeyOf,
  weekRangeInstants,
  weekStartOfKey,
} from '@/features/schedules/week';
import { DEMO_LOCATION_1, DEMO_ORG_ID } from '@/lib/demo/seed';

/**
 * LA DEMOSTRACIÓN NO NACE CON EXTRAS QUE NO CUADRAN (26-oct). Sus extras aprobadas de la semana
 * pasada son lo que se trabajó de más; si la semilla y `extra_que_no_cuadra` dijeran cosas
 * distintas, «Por resolver» de la demo saldría lleno de avisos que nadie provocó.
 */
const TZ = 'America/Lima';
const base = { organizationId: DEMO_ORG_ID, locationId: DEMO_LOCATION_1 };

it('ni esta semana ni la pasada hay una extra que no cuadre', async () => {
  const estaSemana = weekStartOfKey(dateKeyOf(new Date(), TZ), 1);
  for (const semana of [addDaysToKey(estaSemana, -7), estaSemana]) {
    const rango = weekRangeInstants(semana, TZ);
    const [sesiones, turnos, extras] = await Promise.all([
      fetchWorkSessions({ ...base, fromISO: rango.fromISO, toISO: rango.toISO }),
      fetchWeekShifts({ ...base, fromISO: rango.fromISO, toISO: rango.toISO }),
      fetchHorasExtra({ ...base, from: semana, to: addDaysToKey(semana, 6) }),
    ]);
    const casos = casosPorResolver({
      sesiones,
      turnos,
      ahoraISO: new Date().toISOString(),
      timezone: TZ,
      aprobadas: aprobadasPorDia(extras),
      deMasAlDecidir: deMasAlDecidirPorDia(extras),
      umbralExtra: 60,
    });
    expect(casos.filter((caso) => caso.tipo === 'extra_que_no_cuadra')).toEqual([]);
  }
});

/*
 * «LE DEBE» PARCIAL EN LA DEMOSTRACIÓN (26-oct): como `resolveSessionCase`, la decisión apunta
 * cuánto le faltaba, y Horas la lee de vuelta con la jornada.
 */
it('«le debe 1 h» de 2 apunta lo que faltaba, y la deuda queda en 1 h', async () => {
  const estaSemana = weekStartOfKey(dateKeyOf(new Date(), TZ), 1);
  const rango = weekRangeInstants(addDaysToKey(estaSemana, -7), TZ);
  const leer = () => fetchWorkSessions({ ...base, fromISO: rango.fromISO, toISO: rango.toISO });
  const sesion = (await leer()).find((fila) => fila.ends_at !== null);
  expect(sesion).toBeDefined();

  await arreglarCaso({
    tipo: 'debe',
    sessionId: sesion!.id,
    minutos: 60,
    faltaban: 120,
    nota: null,
  });
  const leida = (await leer()).find((fila) => fila.id === sesion!.id);
  expect(leida?.casos_decision?.faltan_horas).toMatchObject({ decision: 'owes', faltaban: 120 });

  const deuda = (await fetchHorasDebidasDeLaSede(base)).find((fila) => fila.id === sesion!.id);
  expect(deuda).toMatchObject({ minutes: 60, status: 'pending' });
});
