import { approveTimesheetPeriod, managerAdjustTime, reopenTimesheetPeriod } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Aprobar y reabrir un periodo de horas (30-sep).
 *
 * «Aprobar periodo» nunca había funcionado para una semana nueva: el panel creaba el
 * periodo escribiendo directo, las reglas no lo dejan, y la pantalla decía «Hay fichajes que
 * necesitan revisión» fuera cual fuera el error. Ahora lo hace el servidor, y la única
 * negativa es la que tiene sentido y dice a quién.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-periodo';
const SEDE = 'sede-periodo';
const GERENTE = 'uid-gerente-periodo';
const VENDEDOR = 'uid-vendedor-periodo';

const H = (dia: number, hora: number) => new Date(Date.UTC(2026, 8, dia, hora + 5)).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>, uid = GERENTE): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function fallo(p: Promise<unknown>) {
  try {
    await p;
    return { code: '(no fallo)' } as { code: string; details?: Record<string, unknown> };
  } catch (error) {
    const e = error as { code?: string; details?: Record<string, unknown> };
    return { code: e.code ?? String(error), details: e.details };
  }
}

async function sesion(id: string, empleado: string, desde: string, hasta: string | null) {
  await db
    .collection(COLLECTIONS.workSessions)
    .doc(id)
    .set({
      organization_id: ORG,
      location_id: SEDE,
      employee_id: empleado,
      starts_at: desde,
      ends_at: hasta,
      status: hasta === null ? 'open' : 'complete',
      // Lo que lleva toda jornada de verdad: corregirla lo copia en la fila del ajuste.
      gross_minutes: hasta === null ? null : (Date.parse(hasta) - Date.parse(desde)) / 60_000,
      net_minutes: hasta === null ? null : (Date.parse(hasta) - Date.parse(desde)) / 60_000,
      unpaid_break_minutes: 0,
      updated_at: desde,
    });
}

const periodos = async () =>
  (await db.collection(COLLECTIONS.timesheetPeriods).get()).docs.map((d) => d.data());

const semana = { p_location_id: SEDE, p_from: '2026-09-21', p_to: '2026-09-27' };

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima', settings: {} });
  for (const [uid, rol] of [
    [GERENTE, 'admin'],
    [VENDEDOR, 'employee'],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({
        organization_id: ORG,
        user_id: uid,
        role: rol,
        status: 'active',
        managed_location_ids: [SEDE],
      });
  }
  for (const [id, nombre] of [
    ['emp-a', 'Persona A'],
    ['emp-b', 'Persona B'],
  ]) {
    await db
      .collection(COLLECTIONS.employees)
      .doc(id)
      .set({ full_name: nombre, preferred_name: null });
  }
});

describe('aprobar un periodo', () => {
  it('crea el periodo si no existía y lo aprueba', async () => {
    await sesion('s-1', 'emp-a', H(22, 10), H(22, 19));
    const r = await correr(approveTimesheetPeriod, semana);
    expect(r).toMatchObject({ status: 'approved' });
    expect(await periodos()).toEqual([
      expect.objectContaining({
        location_id: SEDE,
        starts_on: '2026-09-21',
        ends_on: '2026-09-27',
        status: 'approved',
        approved_by: GERENTE,
      }),
    ]);
  });

  it('no aprueba con jornadas abiertas, y dice de quién', async () => {
    await sesion('s-1', 'emp-a', H(22, 10), H(22, 19));
    await sesion('s-2', 'emp-b', H(26, 10), null);
    const f = await fallo(correr(approveTimesheetPeriod, semana));
    expect(f.code).toBe('failed-precondition');
    expect(f.details).toEqual({ motivo: 'JORNADAS_ABIERTAS', nombres: ['Persona B'] });
    expect(await periodos()).toEqual([]);
  });

  it('una jornada abierta de otra semana no la bloquea', async () => {
    await sesion('s-3', 'emp-a', H(28, 10), null);
    expect(await correr(approveTimesheetPeriod, semana)).toMatchObject({ status: 'approved' });
  });

  it('reabrir la devuelve a edición y dos aprobaciones no duplican el periodo', async () => {
    await correr(approveTimesheetPeriod, semana);
    await correr(reopenTimesheetPeriod, semana);
    await correr(approveTimesheetPeriod, semana);
    const [unico, ...otros] = await periodos();
    expect(otros).toHaveLength(0);
    expect(unico).toMatchObject({ status: 'approved' });
    await correr(reopenTimesheetPeriod, { p_period_id: `${SEDE}_2026-09-21_2026-09-27` });
    expect((await periodos())[0]).toMatchObject({ status: 'reopened', approved_at: null });
  });

  it('quien no gestiona no aprueba', async () => {
    expect((await fallo(correr(approveTimesheetPeriod, semana, VENDEDOR))).code).toBe(
      'permission-denied',
    );
  });
});

/**
 * CAMBIAR HORAS DE UNA SEMANA YA APROBADA QUEDA ANOTADO EN ELLA (auditoría, 4-oct): Horas lo
 * enseña al lado de «Aprobada», que es donde se mira antes de exportar la nómina.
 */
describe('cambios después de aprobar', () => {
  const periodo = async () => (await periodos())[0];

  it('una corrección en la semana aprobada la anota, y volver a aprobar pone la cuenta a cero', async () => {
    await sesion('s-1', 'emp-a', H(22, 10), H(22, 19));
    await correr(approveTimesheetPeriod, semana);
    expect(await periodo()).toMatchObject({ changes_after_approval: 0 });

    await correr(managerAdjustTime, {
      p_work_session_id: 's-1',
      p_reason: 'Salió a las 18:00',
      p_new_ends_at: H(22, 18),
    });
    await correr(managerAdjustTime, {
      p_work_session_id: 's-1',
      p_reason: 'Entró a las 11:00',
      p_new_starts_at: H(22, 11),
    });
    expect(await periodo()).toMatchObject({
      status: 'approved',
      changes_after_approval: 2,
      changed_after_approval_by: GERENTE,
      changed_after_approval_at: expect.any(String),
    });
    const auditoria = (await db.collection(COLLECTIONS.auditLogs).get()).docs
      .map((d) => d.data())
      .filter((d) => d.action === 'timesheet_period_changed_after_approval');
    expect(auditoria).toHaveLength(2);

    await correr(reopenTimesheetPeriod, semana);
    await correr(approveTimesheetPeriod, semana);
    expect(await periodo()).toMatchObject({
      changes_after_approval: 0,
      changed_after_approval_at: null,
    });
  });

  it('una corrección en una semana sin aprobar, o en otra semana, no anota nada', async () => {
    await sesion('s-1', 'emp-a', H(22, 10), H(22, 19));
    await sesion('s-2', 'emp-a', H(29, 10), H(29, 19));
    await correr(approveTimesheetPeriod, semana);
    await correr(managerAdjustTime, {
      p_work_session_id: 's-2',
      p_reason: 'Otra semana',
      p_new_ends_at: H(29, 18),
    });
    expect(await periodo()).toMatchObject({ changes_after_approval: 0 });
  });
});
