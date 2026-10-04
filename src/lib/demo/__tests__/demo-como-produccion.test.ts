// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
import '@/test-utils/encender-demo';

import { fetchWeekRestDays, removeRestDay, setRestDays } from '@/features/schedules/api';
import { getDataClient } from '@/lib/firebase/query';
import { DEMO_LOCATION_1, DEMO_ORG_ID } from '@/lib/demo/seed';

/**
 * LA DEMOSTRACIÓN SE PORTA COMO EL SERVIDOR (auditoría, 4-oct). Es contra lo que corren los
 * arneses: si aquí algo sale bien que en la tienda sale mal, ningún arnés lo ve.
 */
const base = { organizationId: DEMO_ORG_ID, locationId: DEMO_LOCATION_1 };
const DIA = '2031-01-06';

describe('la demostración, como producción', () => {
  it('marcar el mismo descanso dos veces deja uno, y quitarlo lo quita', async () => {
    const empleado = 'persona-de-la-prueba';
    await setRestDays({ ...base, days: [{ employeeId: empleado, dateKey: DIA }] });
    await setRestDays({ ...base, days: [{ employeeId: empleado, dateKey: DIA }] });

    const marcados = (await fetchWeekRestDays({ ...base, fromKey: DIA, toKey: DIA })).filter(
      (fila) => fila.employee_id === empleado,
    );
    expect(marcados).toHaveLength(1);

    await removeRestDay({ restDayId: marcados[0]!.id });
    const tras = (await fetchWeekRestDays({ ...base, fromKey: DIA, toKey: DIA })).filter(
      (fila) => fila.employee_id === empleado,
    );
    expect(tras).toEqual([]);
  });

  it('publicar sin turnos es un error, como en el servidor', async () => {
    const db = getDataClient()!;
    const { error } = await db.rpc('publish_shifts_for_week', {
      p_location_id: DEMO_LOCATION_1,
      p_week_start: DIA,
      p_shift_ids: [],
    });
    expect(error).not.toBeNull();
  });
});
