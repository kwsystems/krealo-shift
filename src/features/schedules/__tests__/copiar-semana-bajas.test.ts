// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
import '@/test-utils/encender-demo';

import {
  copyPreviousWeek,
  createShift,
  fetchWeekRestDays,
  fetchWeekShifts,
  removeShift,
  setRestDays,
} from '../api';
import { fueraDelEquipoEl } from '../fuera-del-equipo';
import { weekRangeInstants } from '../week';
import { DEMO_LOCATION_1, DEMO_ORG_ID } from '@/lib/demo/seed';
import { getDataClient } from '@/lib/firebase/query';
import { TABLES } from '@/lib/firebase/tables';

/**
 * COPIAR LA SEMANA NO TRAE A QUIEN YA NO ESTÁ, Y EL «CAMBIADO» SE CANCELA (26-oct).
 *
 * Con las funciones reales contra la demostración, en semanas de 2031 que la semilla no
 * toca, y con personas propias: lo que importa es lo que queda guardado.
 */
const TZ = 'America/Lima';
const base = { organizationId: DEMO_ORG_ID, locationId: DEMO_LOCATION_1, timezone: TZ };
const DESTINO = '2031-03-10';

const ACTIVA = 'persona-que-sigue';
const INACTIVA = 'persona-dada-de-baja';
const SE_VA = 'persona-que-se-va-el-martes';

async function altaDe(id: string, status: string, endDate: string | null) {
  await getDataClient()!.from(TABLES.employees).insert({
    id,
    organization_id: DEMO_ORG_ID,
    full_name: id,
    preferred_name: null,
    email: null,
    employee_number: null,
    status,
    hire_date: '2030-01-01',
    end_date: endDate,
    user_id: null,
  });
}

async function turnoDe(employeeId: string, dateKey: string) {
  await createShift({
    ...base,
    input: {
      employeeId,
      jobRoleId: null,
      dateKey,
      startTime: '09:00',
      endTime: '17:00',
      plannedUnpaidBreakMinutes: 60,
      employeeNote: null,
      managerNote: null,
    },
  });
}

async function turnosDe(weekStart: string, employeeId: string) {
  const rango = weekRangeInstants(weekStart, TZ);
  return (await fetchWeekShifts({ ...base, fromISO: rango.fromISO, toISO: rango.toISO })).filter(
    (turno) => turno.employee_id === employeeId,
  );
}

describe('fueraDelEquipoEl', () => {
  it('inactiva siempre; con último día, solo después de él; invitada nunca', () => {
    expect(fueraDelEquipoEl({ status: 'inactive', end_date: '2031-12-31' }, '2031-03-10')).toBe(
      true,
    );
    expect(fueraDelEquipoEl({ status: 'active', end_date: '2031-03-11' }, '2031-03-11')).toBe(
      false,
    );
    expect(fueraDelEquipoEl({ status: 'active', end_date: '2031-03-11' }, '2031-03-12')).toBe(true);
    expect(fueraDelEquipoEl({ status: 'invited', end_date: null }, '2031-03-12')).toBe(false);
    expect(fueraDelEquipoEl(undefined, '2031-03-12')).toBe(false);
  });
});

describe('copiar la semana anterior con gente que se fue', () => {
  beforeAll(async () => {
    await altaDe(ACTIVA, 'active', null);
    await altaDe(INACTIVA, 'inactive', '2031-03-05');
    await altaDe(SE_VA, 'active', '2031-03-11');
    for (const persona of [ACTIVA, INACTIVA, SE_VA]) {
      await turnoDe(persona, '2031-03-03'); // la semana de origen, del lunes 3
      await turnoDe(persona, '2031-03-05');
    }
    await setRestDays({
      organizationId: DEMO_ORG_ID,
      locationId: DEMO_LOCATION_1,
      days: [
        { employeeId: INACTIVA, dateKey: '2031-03-04' },
        { employeeId: ACTIVA, dateKey: '2031-03-04' },
      ],
    });
  });

  it('salta los turnos y descansos de quien ya no está, y los cuenta aparte', async () => {
    const copia = await copyPreviousWeek({ ...base, targetWeekStart: DESTINO });

    // La que sigue: sus dos turnos. La que se va el martes 11: el lunes 10 sí, el 12 no.
    expect(copia.turnos).toBe(3);
    expect(copia.deBaja).toBe(3);
    expect(copia.omitidos).toBe(3);

    expect(await turnosDe(DESTINO, ACTIVA)).toHaveLength(2);
    expect(await turnosDe(DESTINO, INACTIVA)).toHaveLength(0);
    const deLaQueSeVa = await turnosDe(DESTINO, SE_VA);
    expect(deLaQueSeVa).toHaveLength(1);
    expect(deLaQueSeVa[0]?.starts_at.startsWith('2031-03-10')).toBe(true);

    const descansos = await fetchWeekRestDays({
      ...base,
      fromKey: DESTINO,
      toKey: '2031-03-16',
    });
    expect(descansos.map((descanso) => descanso.employee_id)).toEqual([ACTIVA]);
  });

  it('copiar otra vez: lo de la baja sigue contando como de baja, no como pisado', async () => {
    const otra = await copyPreviousWeek({ ...base, targetWeekStart: DESTINO });
    expect(otra.turnos).toBe(0);
    expect(otra.deBaja).toBe(3);
    expect(otra.omitidos).toBe(6);
  });
});

describe('quitar un turno', () => {
  async function insertar(id: string, status: string, version: number) {
    await getDataClient()!
      .from(TABLES.shifts)
      .insert({
        id,
        organization_id: DEMO_ORG_ID,
        location_id: DEMO_LOCATION_1,
        employee_id: ACTIVA,
        job_role_id: null,
        starts_at: '2031-04-07T14:00:00.000Z',
        ends_at: '2031-04-07T22:00:00.000Z',
        timezone: TZ,
        planned_unpaid_break_minutes: 60,
        employee_note: null,
        manager_note: null,
        status,
        publication_version: version,
        published_at: version > 0 ? '2031-04-01T12:00:00.000Z' : null,
      });
  }
  async function leer(id: string) {
    const { data } = await getDataClient()!
      .from(TABLES.shifts)
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    return data as { id: string; status: string } | null;
  }

  it('un «Cambiado» (borrador ya publicado) se cancela, no se borra', async () => {
    await insertar('turno-cambiado', 'draft', 2);
    await removeShift({ shiftId: 'turno-cambiado', status: 'draft', publicationVersion: 2 });
    expect((await leer('turno-cambiado'))?.status).toBe('cancelled');
  });

  it('un borrador nunca publicado se elimina', async () => {
    await insertar('turno-nuevo', 'draft', 0);
    await removeShift({ shiftId: 'turno-nuevo', status: 'draft', publicationVersion: 0 });
    expect(await leer('turno-nuevo')).toBeNull();
  });
});
