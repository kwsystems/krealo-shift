import { viewEmployeesWorkingNow } from '../../views';
import { managerAddTimeEvent, managerAdjustTime } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { attendanceStateAt, recordTimeEvent } from '../../shared/attendance';

/**
 * LA SALIDA QUE PONE QUIEN GESTIONA LLEGA A TODAS PARTES (1-oct).
 *
 * Andree arregló la salida de una vendedora que se fue sin marcar y al día siguiente Inicio
 * y Horario seguían diciendo «Trabajando desde 16:50». Lo que tiene que ser cierto después
 * de corregir una salida, en las tres cosas que la leen: la jornada (cerrada y con sus
 * horas), «quién está trabajando ahora» (ya no está) y el reloj (la cree fuera, así que al
 * llegar le ofrece «Marcar entrada»).
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-salida';
const SEDE = 'sede-salida';
const GERENTE = 'uid-gerente-salida';
const PERSONA = 'emp-salida';

// Lima, UTC-5: el lunes 21-sep y el martes 22-sep.
const H = (dia: number, hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, dia, hora + 5, minuto)).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>, uid = GERENTE): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function motivoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no falló)';
  } catch (error) {
    const e = error as { code?: string; details?: { motivo?: string } };
    return `${e.code}:${e.details?.motivo ?? ''}`;
  }
}

async function fichar(tipo: 'clock_in' | 'clock_out', cuando: string, source = 'kiosk') {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    source: source as 'kiosk' | 'manager',
  });
}

const jornadas = async () =>
  (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);

const salidas = async () =>
  (await db.collection(COLLECTIONS.timeEvents).where('employee_id', '==', PERSONA).get()).docs
    .map((d) => d.data())
    .filter((e) => e.event_type === 'clock_out');

const dentroAhora = async () =>
  (await correr(viewEmployeesWorkingNow, {
    filters: [{ field: 'location_id', op: 'eq', value: SEDE }],
  })) as unknown[];

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db.collection(COLLECTIONS.locations).doc(SEDE).set({
    id: SEDE,
    organization_id: ORG,
    timezone: 'America/Lima',
  });
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

describe('corregir la salida de quien se fue sin marcar', () => {
  it('cierra la jornada, la quita de «trabajando ahora» y el reloj la cree fuera', async () => {
    await fichar('clock_in', H(21, 16, 50));
    const [abierta] = await jornadas();
    expect(abierta).toMatchObject({ status: 'open', ends_at: null });
    expect(await dentroAhora()).toHaveLength(1);

    await correr(managerAdjustTime, {
      p_work_session_id: abierta!.id,
      p_reason: 'Se fue al cerrar la tienda y no marcó.',
      p_new_ends_at: H(21, 21),
    });

    const [cerrada, ...otras] = await jornadas();
    expect(otras).toEqual([]);
    expect(cerrada).toMatchObject({
      id: abierta!.id,
      status: 'complete',
      ends_at: H(21, 21),
      gross_minutes: 250,
      net_minutes: 250,
    });
    expect(await dentroAhora()).toEqual([]);
    expect(await attendanceStateAt(PERSONA, new Date().toISOString())).toBe('OFF_SHIFT');
    const [salida] = await salidas();
    expect(salida).toMatchObject({
      source: 'manager',
      created_by: GERENTE,
      occurred_at: H(21, 21),
    });

    // Y queda en el historial de correcciones, a su nombre.
    const ajustes = (
      await db.collection(COLLECTIONS.timeAdjustments).where('employee_id', '==', PERSONA).get()
    ).docs.map((d) => d.data());
    expect(ajustes).toEqual([
      expect.objectContaining({
        target_type: 'time_event',
        work_session_id: abierta!.id,
        created_by: GERENTE,
        after_value: { event_type: 'clock_out', occurred_at: H(21, 21) },
      }),
    ]);
  });

  it('una salida puesta el día equivocado se mueve, no se apila otra', async () => {
    await fichar('clock_in', H(21, 16, 50));
    // El error de verdad: «hoy a las 21:00» escrito pasada la medianoche.
    await correr(managerAddTimeEvent, {
      p_employee_id: PERSONA,
      p_location_id: SEDE,
      p_event_type: 'clock_out',
      p_occurred_at: H(22, 21),
      p_reason: 'Se fue sin marcar.',
    });
    const [larga] = await jornadas();
    expect(larga).toMatchObject({ ends_at: H(22, 21), gross_minutes: 1690 });

    await correr(managerAdjustTime, {
      p_work_session_id: larga!.id,
      p_reason: 'Era el día anterior.',
      p_new_ends_at: H(21, 21),
    });

    expect(await salidas()).toHaveLength(1);
    expect((await salidas())[0]).toMatchObject({ occurred_at: H(21, 21), source: 'manager' });
    const [corregida] = await jornadas();
    expect(corregida).toMatchObject({ status: 'complete', ends_at: H(21, 21), gross_minutes: 250 });
  });

  it('la salida que marcó la persona en el reloj no se toca: se corrige la jornada', async () => {
    await fichar('clock_in', H(21, 10));
    await fichar('clock_out', H(21, 19));
    const [jornada] = await jornadas();
    await correr(managerAdjustTime, {
      p_work_session_id: jornada!.id,
      p_reason: 'Se quedó a cerrar.',
      p_new_ends_at: H(21, 19, 30),
    });
    expect((await salidas())[0]).toMatchObject({ occurred_at: H(21, 19), source: 'kiosk' });
    expect((await jornadas())[0]).toMatchObject({ ends_at: H(21, 19, 30), gross_minutes: 570 });
  });

  it('una entrada ya corregida se conserva al poner la salida', async () => {
    await fichar('clock_in', H(21, 16, 50));
    const [abierta] = await jornadas();
    await correr(managerAdjustTime, {
      p_work_session_id: abierta!.id,
      p_reason: 'Entró antes y marcó tarde.',
      p_new_starts_at: H(21, 16, 30),
    });
    await correr(managerAdjustTime, {
      p_work_session_id: abierta!.id,
      p_reason: 'Se fue sin marcar.',
      p_new_ends_at: H(21, 21),
    });
    expect((await jornadas())[0]).toMatchObject({
      status: 'complete',
      starts_at: H(21, 16, 30),
      ends_at: H(21, 21),
      gross_minutes: 270,
    });
  });
});

describe('no se aceptan horas que todavía no llegaron', () => {
  const manana = () => new Date(Date.now() + 20 * 3600_000).toISOString();

  it('ni al corregir una jornada ni al agregar un fichaje', async () => {
    await fichar('clock_in', H(21, 16, 50));
    const [abierta] = await jornadas();
    expect(
      await motivoDelFallo(
        correr(managerAdjustTime, {
          p_work_session_id: abierta!.id,
          p_reason: 'x',
          p_new_ends_at: manana(),
        }),
      ),
    ).toBe('invalid-argument:FUTURO');
    expect(
      await motivoDelFallo(
        correr(managerAddTimeEvent, {
          p_employee_id: PERSONA,
          p_location_id: SEDE,
          p_event_type: 'clock_out',
          p_occurred_at: manana(),
          p_reason: 'x',
        }),
      ),
    ).toBe('invalid-argument:FUTURO');
    expect(await salidas()).toEqual([]);
    expect((await jornadas())[0]).toMatchObject({ status: 'open', ends_at: null });
  });
});

describe('las jornadas que ya quedaron mal', () => {
  it('«abierta» con su salida puesta a mano: se registra el fichaje y deja de estar dentro', async () => {
    await fichar('clock_in', H(21, 16, 50));
    const [abierta] = await jornadas();
    // Lo que dejaba «Corregir hora» antes del arreglo: la hora en la jornada y nada más.
    await db
      .collection(COLLECTIONS.workSessions)
      .doc(abierta!.id)
      .update({
        ends_at: H(21, 21),
        gross_minutes: 250,
        net_minutes: 250,
      });
    await db.collection(COLLECTIONS.timeAdjustments).add({
      organization_id: ORG,
      employee_id: PERSONA,
      work_session_id: abierta!.id,
      target_type: 'work_session',
      created_by: GERENTE,
      created_at: H(22, 1),
    });
    expect(await attendanceStateAt(PERSONA, new Date().toISOString())).toBe('WORKING');

    expect(await dentroAhora()).toEqual([]);

    expect((await jornadas())[0]).toMatchObject({ status: 'complete', ends_at: H(21, 21) });
    expect((await salidas())[0]).toMatchObject({ occurred_at: H(21, 21), created_by: GERENTE });
    expect(await attendanceStateAt(PERSONA, new Date().toISOString())).toBe('OFF_SHIFT');
    // Y la segunda vez no hace nada más.
    expect(await dentroAhora()).toEqual([]);
    expect(await salidas()).toHaveLength(1);
  });
});
