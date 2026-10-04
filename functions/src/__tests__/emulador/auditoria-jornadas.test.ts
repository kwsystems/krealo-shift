import { managerAddTimeEvent, managerAdjustTime } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { registerMissedAttendance } from '../../vino-y-no-marco';

/**
 * LO QUE ENCONTRÓ LA AUDITORÍA DEL 4-OCT EN LAS JORNADAS, comprobado aquí:
 *
 *   - e01: una corrección de la entrada de una jornada abierta se perdía al marcar la salida.
 *   - e02: una entrada añadida antes de la que marcó el reloj dejaba la jornada vieja
 *     guardada: horas dos veces, o alguien «dentro» para siempre.
 *   - e05: una salida a más de 36 h de su entrada no cerraba la jornada.
 *   - e19: el fichaje manual no comprobaba que la persona fuera de esa sede.
 *   - e11: «Vino y no marcó» eran dos llamadas y podía quedar a medias.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-audit';
const SEDE = 'sede-audit';
const OTRA = 'sede-otra';
const GERENTE = 'uid-gerente-audit';
const PERSONA = 'emp-audit';
const DE_OTRA = 'emp-de-otra';

const ayer = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
// Lima, UTC-5.
const L = (hora: number, minuto = 0, dia = ayer) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + (hora + 5) * 3600_000 + minuto * 60_000).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid: GERENTE, token: {} },
    rawRequest: {},
  });

async function fallo(promesa: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await promesa;
    return { code: '(no falló)', details: null };
  } catch (error) {
    const e = error as { code?: string; details?: unknown };
    return { code: e.code ?? String(error), details: e.details ?? null };
  }
}

async function reloj(tipo: 'clock_in' | 'clock_out', cuando: string) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    source: 'kiosk',
  });
}

const jornadas = async () =>
  (await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()).docs
    .map((d) => d.data())
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  for (const sede of [SEDE, OTRA]) {
    await db
      .collection(COLLECTIONS.locations)
      .doc(sede)
      .set({ id: sede, organization_id: ORG, timezone: 'America/Lima', settings: {} });
  }
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
  for (const [persona, sede] of [
    [PERSONA, SEDE],
    [DE_OTRA, OTRA],
  ] as const) {
    await db
      .collection(COLLECTIONS.employees)
      .doc(persona)
      .set({ id: persona, organization_id: ORG, full_name: persona, status: 'active' });
    await db
      .collection(COLLECTIONS.employeeLocations)
      .doc(`${persona}_${sede}`)
      .set({ employee_id: persona, location_id: sede, organization_id: ORG });
  }
});

describe('auditoría de jornadas', () => {
  it('e01: corregir la entrada de una jornada abierta sobrevive a la salida del reloj', async () => {
    await reloj('clock_in', L(8, 31));
    const [abierta] = await jornadas();
    await correr(managerAdjustTime, {
      p_work_session_id: abierta?.id,
      p_reason: 'Llegó a las 8 y el reloj no le respondía',
      p_expected_updated_at: abierta?.updated_at,
      p_new_starts_at: L(8, 0),
      p_new_ends_at: null,
    });
    await reloj('clock_out', L(17, 0));
    const [jornada, ...otras] = await jornadas();
    expect(otras).toHaveLength(0);
    expect(jornada).toMatchObject({ starts_at: L(8, 0), status: 'complete', gross_minutes: 540 });
  });

  it('e02: una entrada añadida antes que la del reloj deja una sola jornada', async () => {
    await reloj('clock_in', L(11, 0));
    await reloj('clock_out', L(18, 0));
    await correr(managerAddTimeEvent, {
      p_employee_id: PERSONA,
      p_location_id: SEDE,
      p_event_type: 'clock_in',
      p_occurred_at: L(8, 0),
      p_reason: 'Entró a las 8',
    });
    const lista = await jornadas();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ starts_at: L(8, 0), ends_at: L(18, 0), gross_minutes: 600 });
  });

  it('e02: marcó al llegar tarde y luego se puso su entrada de antes: no queda nadie dentro', async () => {
    await reloj('clock_in', L(14, 0));
    await correr(managerAddTimeEvent, {
      p_employee_id: PERSONA,
      p_location_id: SEDE,
      p_event_type: 'clock_in',
      p_occurred_at: L(10, 0),
      p_reason: 'La tienda abrió tarde',
    });
    await reloj('clock_out', L(22, 0));
    const lista = await jornadas();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ starts_at: L(10, 0), status: 'complete' });
  });

  it('e05: una salida dos días después de su entrada cierra esa jornada', async () => {
    const hace3Dias = new Date(Date.now() - 3 * 24 * 3600_000).toISOString().slice(0, 10);
    await reloj('clock_in', L(9, 0, hace3Dias));
    await reloj('clock_out', L(9, 0));
    const lista = await jornadas();
    expect(lista).toHaveLength(1);
    expect(lista[0]?.status).toBe('complete');
  });

  it('e19: el fichaje manual no vale para alguien de otra sede', async () => {
    const resultado = await fallo(
      correr(managerAddTimeEvent, {
        p_employee_id: DE_OTRA,
        p_location_id: SEDE,
        p_event_type: 'clock_in',
        p_occurred_at: L(9, 0),
        p_reason: 'Prueba',
      }),
    );
    expect(resultado.code).toBe('permission-denied');
    expect(resultado.details).toEqual({ motivo: 'OTRA_SEDE' });
  });

  describe('e11: «Vino y no marcó» de una sola vez', () => {
    beforeEach(async () => {
      await db
        .collection(COLLECTIONS.shifts)
        .doc('t-falta')
        .set({
          id: 't-falta',
          organization_id: ORG,
          location_id: SEDE,
          employee_id: PERSONA,
          starts_at: L(10, 0),
          ends_at: L(19, 0),
          status: 'published',
          publication_version: 1,
          planned_unpaid_break_minutes: 60,
        });
    });

    const registrar = () =>
      correr(registerMissedAttendance, {
        p_shift_id: 't-falta',
        p_starts_at: L(10, 0),
        p_ends_at: L(19, 0),
        p_reason: 'El reloj no tenía batería',
      });

    it('deja una jornada cerrada, y repetirlo no duplica nada', async () => {
      expect(await registrar()).toMatchObject({ repetido: false });
      expect(await registrar()).toMatchObject({ repetido: true });
      const lista = await jornadas();
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        starts_at: L(10, 0),
        ends_at: L(19, 0),
        status: 'complete',
      });
      const eventos = await db
        .collection(COLLECTIONS.timeEvents)
        .where('employee_id', '==', PERSONA)
        .get();
      expect(eventos.size).toBe(2);
    });

    it('si ya hay marcas en medio, no pisa nada', async () => {
      await reloj('clock_in', L(15, 0));
      const resultado = await fallo(registrar());
      expect(resultado.details).toEqual({ motivo: 'CON_MARCAS' });
    });
  });
});
