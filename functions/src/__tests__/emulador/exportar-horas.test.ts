import { exportTimesheetRows, viewBreakTimeByReason } from '../../index';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * «EXPORTAR CSV» DE HORAS Y LAS PAUSAS DE REPORTES (2-oct). Lo que tiene que ser cierto:
 *   - el CSV llega con la forma que lee la app (`employee_name`, `work_date`, `clock_in`,
 *     `clock_out`, `net_hours_decimal`): con la de antes la app lo rechazaba y el botón
 *     fallaba en producción;
 *   - los dos cuentan por DÍA DE LA SEDE: la jornada de las 20:00 del último día en Lima
 *     —en UTC ya es el día siguiente— entra, y la de las 20:00 de la víspera no.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-exportar';
const SEDE = 'sede-exportar';
const GERENTE = 'uid-gerente-exportar';

const correr = (fn: unknown, data: Record<string, unknown>, uid: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${GERENTE}`)
    .set({
      organization_id: ORG,
      user_id: GERENTE,
      role: 'manager',
      status: 'active',
      managed_location_ids: [SEDE],
      employee_id: null,
    });
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ organization_id: ORG, name: 'Sede', timezone: 'America/Lima' });
  await db
    .collection(COLLECTIONS.employees)
    .doc('emp-exportar')
    .set({ organization_id: ORG, full_name: 'Persona Prueba', status: 'active' });

  const jornada = (id: string, desde: string, hasta: string, netos: number) =>
    db.collection(COLLECTIONS.workSessions).doc(id).set({
      organization_id: ORG,
      location_id: SEDE,
      employee_id: 'emp-exportar',
      shift_id: null,
      starts_at: desde,
      ends_at: hasta,
      gross_minutes: netos,
      paid_break_minutes: 0,
      unpaid_break_minutes: 0,
      net_minutes: netos,
      status: 'complete',
      flags: [],
    });
  // 20:00 del 6 de octubre en Lima = 01:00 del 7 en UTC: es del día 6.
  await jornada('noche-del-ultimo', '2026-10-07T01:00:00.000Z', '2026-10-07T04:30:00.000Z', 210);
  // 20:00 del 30 de septiembre en Lima = 01:00 del 1 en UTC: es de la víspera.
  await jornada('noche-de-la-vispera', '2026-10-01T01:00:00.000Z', '2026-10-01T03:00:00.000Z', 120);
  // Mañana del primer día.
  await jornada('manana-del-primero', '2026-10-01T14:00:00.000Z', '2026-10-01T22:00:00.000Z', 480);

  const evento = (id: string, tipo: string, cuando: string) =>
    db
      .collection(COLLECTIONS.timeEvents)
      .doc(id)
      .set({
        organization_id: ORG,
        location_id: SEDE,
        employee_id: 'emp-exportar',
        event_type: tipo,
        occurred_at: cuando,
        break_reason: tipo === 'break_start' ? 'meal' : null,
        break_type: tipo === 'break_start' ? 'unpaid' : null,
      });
  // Pausa a las 21:00 del 6 en Lima (02:00 del 7 en UTC): 20 minutos, del día 6.
  await evento('pausa-noche-inicio', 'break_start', '2026-10-07T02:00:00.000Z');
  await evento('pausa-noche-fin', 'break_end', '2026-10-07T02:20:00.000Z');
  // Pausa a las 21:00 del 30 en Lima: de la víspera, no cuenta.
  await evento('pausa-vispera-inicio', 'break_start', '2026-10-01T02:00:00.000Z');
  await evento('pausa-vispera-fin', 'break_end', '2026-10-01T02:30:00.000Z');
});

describe('exportar las horas y contar las pausas por día de la sede', () => {
  it('el CSV llega con la forma que lee la app y con los días de la sede', async () => {
    const filas = (await correr(
      exportTimesheetRows,
      { p_location_id: SEDE, p_from: '2026-10-01', p_to: '2026-10-06' },
      GERENTE,
    )) as Record<string, unknown>[];

    expect(filas.map((fila) => fila.work_date)).toEqual(['2026-10-01', '2026-10-06']);
    const [manana, noche] = filas;
    expect(manana).toMatchObject({
      employee_id: 'emp-exportar',
      employee_name: 'Persona Prueba',
      work_date: '2026-10-01',
      clock_in: '2026-10-01T14:00:00.000Z',
      clock_out: '2026-10-01T22:00:00.000Z',
      net_minutes: 480,
      net_hours_decimal: 8,
      status: 'complete',
      flags: [],
    });
    expect(noche).toMatchObject({ net_minutes: 210, net_hours_decimal: 3.5 });
    for (const fila of filas) {
      expect(typeof fila.employee_name).toBe('string');
      expect(typeof fila.work_date).toBe('string');
      expect(typeof fila.net_hours_decimal).toBe('number');
    }
  });

  it('las pausas de Reportes son las de los días de la sede', async () => {
    const filas = (await correr(
      viewBreakTimeByReason,
      {
        filters: [
          { field: 'location_id', op: 'eq', value: SEDE },
          { field: 'work_date', op: 'gte', value: '2026-10-01' },
          { field: 'work_date', op: 'lte', value: '2026-10-06' },
        ],
      },
      GERENTE,
    )) as Record<string, unknown>[];
    expect(filas.map((fila) => [fila.work_date, fila.minutes])).toEqual([['2026-10-06', 20]]);
  });
});
