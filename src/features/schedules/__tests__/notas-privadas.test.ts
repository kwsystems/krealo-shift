// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
import '@/test-utils/encender-demo';

import {
  createShift,
  duplicateShift,
  fetchWeekShifts,
  removeShift,
  updateShift,
  type ShiftInput,
} from '@/features/schedules/api';
import { fetchMisTurnos } from '@/features/portal/api';
import { DEMO_LOCATION_1, DEMO_ORG_ID } from '@/lib/demo/seed';
import { getDataClient } from '@/lib/firebase/query';
import { TABLES } from '@/lib/firebase/tables';

/**
 * LA NOTA PRIVADA VIVE FUERA DEL TURNO (auditoría, 4-oct): en el turno la descargaba el
 * celular de la persona. Horario la sigue viendo igual; el turno ya no la lleva.
 */
const base = { organizationId: DEMO_ORG_ID, locationId: DEMO_LOCATION_1, timezone: 'America/Lima' };
const EMPLEADO = 'persona-de-la-nota';
const DIA = '2031-02-03';
const semana = { fromISO: '2031-02-03T05:00:00.000Z', toISO: '2031-02-10T05:00:00.000Z' };

const entrada = (managerNote: string | null): ShiftInput => ({
  employeeId: EMPLEADO,
  jobRoleId: null,
  dateKey: DIA,
  startTime: '10:00',
  endTime: '18:00',
  plannedUnpaidBreakMinutes: 60,
  employeeNote: null,
  managerNote,
});

async function turnosDeLaPersona() {
  return (await fetchWeekShifts({ ...base, ...semana })).filter(
    (turno) => turno.employee_id === EMPLEADO,
  );
}

async function filaCruda(id: string) {
  const { data } = await getDataClient()!
    .from(TABLES.shifts)
    .select('id, manager_note')
    .eq('id', id)
    .single();
  return data as { id: string; manager_note: string | null } | null;
}

describe('la nota privada de un turno', () => {
  it('Horario la ve, el turno no la lleva y el celular no la recibe', async () => {
    await createShift({ ...base, input: entrada('Vigilar la caja') });
    const [turno] = await turnosDeLaPersona();
    expect(turno?.manager_note).toBe('Vigilar la caja');
    expect((await filaCruda(turno!.id))?.manager_note).toBeNull();
  });

  it('editarla la cambia, vaciarla la quita, y duplicar la copia', async () => {
    const [turno] = await turnosDeLaPersona();
    await updateShift({ ...base, shiftId: turno!.id, input: entrada('Otra nota'), actual: turno });
    expect((await turnosDeLaPersona())[0]?.manager_note).toBe('Otra nota');

    await duplicateShift({
      organizationId: DEMO_ORG_ID,
      shift: (await turnosDeLaPersona())[0]!,
      timezone: 'America/Lima',
    });
    const dos = await turnosDeLaPersona();
    expect(dos.map((t) => t.manager_note)).toEqual(['Otra nota', 'Otra nota']);

    await updateShift({ ...base, shiftId: turno!.id, input: entrada(null), actual: dos[0] });
    const tras = await turnosDeLaPersona();
    expect(tras.find((t) => t.id === turno!.id)?.manager_note).toBeNull();

    for (const t of tras) await removeShift({ shiftId: t.id, status: t.status });
    expect(await turnosDeLaPersona()).toEqual([]);
  });

  it('una nota vieja, todavía en el turno, se sigue viendo y se muda al editar', async () => {
    const db = getDataClient()!;
    await db.from(TABLES.shifts).insert({
      timezone: 'America/Lima',
      organization_id: DEMO_ORG_ID,
      location_id: DEMO_LOCATION_1,
      employee_id: EMPLEADO,
      job_role_id: null,
      starts_at: '2031-02-03T15:00:00.000Z',
      ends_at: '2031-02-03T23:00:00.000Z',
      planned_unpaid_break_minutes: 60,
      employee_note: null,
      manager_note: 'Nota de antes',
      status: 'published',
      publication_version: 1,
      published_at: '2031-01-30T12:00:00.000Z',
    });
    const [vieja] = await turnosDeLaPersona();
    expect(vieja?.manager_note).toBe('Nota de antes');

    // Su celular recibe el turno, sin la nota.
    const delCelular = await fetchMisTurnos({
      organizationId: DEMO_ORG_ID,
      employeeId: EMPLEADO,
      ...semana,
    });
    expect(delCelular.map((fila) => [fila.id, fila.manager_note])).toEqual([[vieja!.id, null]]);

    await updateShift({
      ...base,
      shiftId: vieja!.id,
      input: { ...entrada('Nota de antes'), startTime: '11:00' },
      actual: vieja,
    });
    expect((await filaCruda(vieja!.id))?.manager_note).toBeNull();
    expect((await turnosDeLaPersona())[0]?.manager_note).toBe('Nota de antes');
  });
});
