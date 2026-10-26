import { cerrarJornadasOlvidadas } from '../../cierre-automatico';
import { managerAdjustTime } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { viewBreakTimeByReason } from '../../views';

/**
 * LA SALIDA DESDE EL DESCANSO CIERRA EL DESCANSO (26-oct).
 *
 * El reloj deja «Marcar salida» estando en descanso y avisa «Al marcar salida cerraremos tu
 * descanso», pero la jornada solo contaba las pausas con `break_end`: entrada 09:00,
 * refrigerio 13:00 y salida 14:00 pagaba 300 min en vez de 240. La salida automática que cae
 * en mitad de un refrigerio tenía el mismo agujero.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-salida-descanso';
const SEDE = 'sede-salida-descanso';
const GERENTE = 'uid-gerente-salida-descanso';
const PERSONA = 'emp-salida-descanso';

// Lima, UTC-5: el lunes 21-sep y el martes 22-sep de 2026.
const H = (dia: number, hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, dia, hora + 5, minuto)).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>, uid = GERENTE): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function fichar(
  eventType: 'clock_in' | 'break_start' | 'break_end' | 'clock_out',
  cuando: string,
  pausa?: { breakType: 'paid' | 'unpaid'; breakReason: string },
) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType,
    occurredAt: cuando,
    idempotencyKey: `${eventType}-${cuando}`,
    source: 'kiosk',
    ...(pausa ?? {}),
  });
}

const refrigerio = { breakType: 'unpaid', breakReason: 'meal' } as const;

const jornadas = async () =>
  (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima' });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
  await db.collection(COLLECTIONS.employees).doc(PERSONA).set({
    id: PERSONA,
    organization_id: ORG,
    full_name: 'Persona de prueba',
    status: 'active',
  });
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${GERENTE}`)
    .set({
      organization_id: ORG,
      user_id: GERENTE,
      role: 'manager',
      status: 'active',
      managed_location_ids: [SEDE],
    });
});

describe('marcar salida estando en descanso', () => {
  it('el refrigerio abierto se descuenta hasta la salida: 300 brutos, 240 netos', async () => {
    await fichar('clock_in', H(21, 9));
    await fichar('break_start', H(21, 13), refrigerio);
    await fichar('clock_out', H(21, 14));

    const [jornada, ...otras] = await jornadas();
    expect(otras).toEqual([]);
    expect(jornada).toMatchObject({
      status: 'complete',
      gross_minutes: 300,
      paid_break_minutes: 0,
      unpaid_break_minutes: 60,
      net_minutes: 240,
    });
  });

  it('una pausa pagada abierta al salir cuenta como pagada y no se descuenta', async () => {
    await fichar('clock_in', H(21, 9));
    await fichar('break_start', H(21, 13), { breakType: 'paid', breakReason: 'rest' });
    await fichar('clock_out', H(21, 13, 20));

    expect((await jornadas())[0]).toMatchObject({
      gross_minutes: 260,
      paid_break_minutes: 20,
      unpaid_break_minutes: 0,
      net_minutes: 260,
    });
  });

  it('las pausas cerradas antes siguen contando igual', async () => {
    await fichar('clock_in', H(21, 9));
    await fichar('break_start', H(21, 11), refrigerio);
    await fichar('break_end', H(21, 11, 30));
    await fichar('break_start', H(21, 16), refrigerio);
    await fichar('clock_out', H(21, 16, 45));

    expect((await jornadas())[0]).toMatchObject({
      gross_minutes: 465,
      unpaid_break_minutes: 75,
      net_minutes: 390,
    });
  });

  it('Reportes cuenta esa pausa con lo mismo que Horas', async () => {
    await fichar('clock_in', H(21, 9));
    await fichar('break_start', H(21, 13), refrigerio);
    await fichar('clock_out', H(21, 14));

    const filas = (await correr(viewBreakTimeByReason, {
      filters: [
        { field: 'location_id', op: 'eq', value: SEDE },
        { field: 'work_date', op: 'gte', value: '2026-09-21' },
        { field: 'work_date', op: 'lte', value: '2026-09-21' },
      ],
    })) as Record<string, unknown>[];
    expect(filas).toEqual([
      expect.objectContaining({
        employee_id: PERSONA,
        work_date: '2026-09-21',
        break_reason: 'meal',
        minutes: 60,
        pauses: 1,
      }),
    ]);
  });
});

describe('la salida automática en mitad de un refrigerio', () => {
  async function turno() {
    await db
      .collection(COLLECTIONS.shifts)
      .doc('t-dia')
      .set({
        id: 't-dia',
        organization_id: ORG,
        location_id: SEDE,
        employee_id: PERSONA,
        starts_at: H(21, 9),
        ends_at: H(21, 18),
        planned_unpaid_break_minutes: 60,
        status: 'published',
      });
  }

  it('se cierra a la hora del turno y lo que quedó de refrigerio no se paga', async () => {
    await turno();
    await fichar('clock_in', H(21, 9));
    await fichar('break_start', H(21, 13), refrigerio);

    await cerrarJornadasOlvidadas(Date.parse(H(22, 8)));

    // Fuera desde las 13:00 sin volver: 540 brutos, 300 de refrigerio abierto, 240 netos.
    expect((await jornadas())[0]).toMatchObject({
      status: 'complete',
      ends_at: H(21, 18),
      auto_clock_out: true,
      gross_minutes: 540,
      unpaid_break_minutes: 300,
      net_minutes: 240,
    });
  });

  it('si quien gestiona adelanta esa salida, el refrigerio acaba en la salida nueva', async () => {
    await turno();
    await fichar('clock_in', H(21, 9));
    await fichar('break_start', H(21, 13), refrigerio);
    await cerrarJornadasOlvidadas(Date.parse(H(22, 8)));
    const [cerrada] = await jornadas();

    await correr(managerAdjustTime, {
      p_work_session_id: cerrada!.id,
      p_reason: 'Se fue a las 14:00, desde el refrigerio.',
      p_new_ends_at: H(21, 14),
    });

    expect((await jornadas())[0]).toMatchObject({
      ends_at: H(21, 14),
      gross_minutes: 300,
      unpaid_break_minutes: 60,
      net_minutes: 240,
    });
  });
});
