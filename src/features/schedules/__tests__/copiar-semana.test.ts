// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
import '@/test-utils/encender-demo';

import { copyPreviousWeek, fetchWeekRestDays, fetchWeekShifts } from '../api';
import { addDaysToKey, dateKeyOf, weekRangeInstants, weekStartOfKey } from '../week';
import { DEMO_LOCATION_1, DEMO_ORG_ID } from '@/lib/demo/seed';

/**
 * COPIAR LA SEMANA ANTERIOR DOS VECES NO LA DUPLICA (auditoría, 4-oct).
 *
 * Copiar creaba cada turno otra vez sin mirar lo que ya había: dos pulsaciones eran el
 * doble de turnos sin publicar, y «Publicar» los publicaba todos. Se prueba con las
 * funciones reales contra la demostración, porque lo que importa es lo que queda guardado.
 */

const TZ = 'America/Lima';
const base = { organizationId: DEMO_ORG_ID, locationId: DEMO_LOCATION_1, timezone: TZ };

async function turnosDe(weekStart: string) {
  const rango = weekRangeInstants(weekStart, TZ);
  return (await fetchWeekShifts({ ...base, fromISO: rango.fromISO, toISO: rango.toISO })).filter(
    (turno) => turno.status !== 'cancelled',
  );
}

describe('copiar la semana anterior', () => {
  const estaSemana = weekStartOfKey(dateKeyOf(new Date(), TZ), 1);
  const siguiente = addDaysToKey(estaSemana, 7);

  it('la primera vez copia; la segunda no repite ni un turno', async () => {
    const origen = await turnosDe(estaSemana);
    expect(origen.length).toBeGreaterThan(0);
    const antes = (await turnosDe(siguiente)).length;

    const primera = await copyPreviousWeek({ ...base, targetWeekStart: siguiente });
    expect(primera.turnos).toBeGreaterThan(0);
    const trasLaPrimera = (await turnosDe(siguiente)).length;
    expect(trasLaPrimera).toBe(antes + primera.turnos);

    const segunda = await copyPreviousWeek({ ...base, targetWeekStart: siguiente });
    expect(segunda.turnos).toBe(0);
    expect(segunda.omitidos).toBe(primera.turnos + primera.omitidos);
    expect((await turnosDe(siguiente)).length).toBe(trasLaPrimera);
  });

  it('no deja descanso y turno el mismo día', async () => {
    const turnos = await turnosDe(siguiente);
    const descansos = await fetchWeekRestDays({
      ...base,
      fromKey: siguiente,
      toKey: addDaysToKey(siguiente, 6),
    });
    const conTurno = new Set(
      turnos.map((turno) => `${turno.employee_id}|${dateKeyOf(turno.starts_at, TZ)}`),
    );
    expect(
      descansos.filter((descanso) => conTurno.has(`${descanso.employee_id}|${descanso.date_key}`)),
    ).toEqual([]);
  });
});
