import { applyPlannedBreak, reopenSessionDecision, resolveSessionCase } from '../../casos';
import { creditShiftAsWorked, undoShiftCredit } from '../../cumplido-especial';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { registerMissedAttendance } from '../../vino-y-no-marco';

/**
 * LO QUE CAMBIA HORAS DE UNA SEMANA YA APROBADA QUEDA ANOTADO EN ELLA (26-oct).
 *
 * Solo lo anotaban las correcciones de `manager.ts` («Corregir hora», «Agregar fichaje
 * manual»). Descontar el refrigerio, cambiar esa decisión, «vino y no marcó», dar un turno por
 * cumplido o deshacerlo también cambian las horas que se exportaron, y la semana seguía
 * diciendo «Aprobada» sin más. Aquí se comprueba con la semana aprobada escrita tal cual, y
 * que lo que no toca horas —volver a preguntar una salida dada por buena— no anota nada.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-tras-aprobar';
const SEDE = 'sede-tras-aprobar';
const GERENTE = 'uid-gerente-tras-aprobar';
const PERSONA = 'emp-tras-aprobar';
const PERIODO = `${SEDE}_2026-09-21_2026-09-27`;

// Lima, UTC-5: la semana del lunes 21-sep, ya pasada.
const L = (dia: number, hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, dia, hora + 5, minuto)).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid: GERENTE, token: {} },
    rawRequest: {},
  });

async function turno(id: string, dia: number) {
  await db
    .collection(COLLECTIONS.shifts)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: L(dia, 10),
      ends_at: L(dia, 19),
      planned_unpaid_break_minutes: 60,
      status: 'published',
      publication_version: 1,
    });
}

async function fichar(tipo: 'clock_in' | 'clock_out', cuando: string, shiftId: string) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    shiftId,
    source: 'kiosk',
  });
}

const jornadaDel = async (dia: number) => {
  const docs = (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs.filter((doc) => String(doc.data().starts_at).startsWith(`2026-09-${dia}`));
  expect(docs).toHaveLength(1);
  return docs[0]!.id;
};

const periodo = async () =>
  (await db.collection(COLLECTIONS.timesheetPeriods).doc(PERIODO).get()).data();

const motivosAnotados = async () =>
  (await db.collection(COLLECTIONS.auditLogs).get()).docs
    .map((doc) => doc.data())
    .filter((fila) => fila.action === 'timesheet_period_changed_after_approval')
    .map((fila) => String((fila.after_data as Record<string, unknown>).motivo))
    .sort();

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima', settings: {} });
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
  await db
    .collection(COLLECTIONS.employees)
    .doc(PERSONA)
    .set({ id: PERSONA, organization_id: ORG, full_name: PERSONA, status: 'active' });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
  // La semana, ya aprobada: lo que deja `approveTimesheetPeriod`.
  await db.collection(COLLECTIONS.timesheetPeriods).doc(PERIODO).set({
    id: PERIODO,
    organization_id: ORG,
    location_id: SEDE,
    starts_on: '2026-09-21',
    ends_on: '2026-09-27',
    status: 'approved',
    approved_by: GERENTE,
    changes_after_approval: 0,
    changed_after_approval_at: null,
    changed_after_approval_by: null,
  });
});

describe('cambios después de aprobar, fuera de «Corregir hora»', () => {
  it('descontar el refrigerio y deshacerlo anotan uno cada uno', async () => {
    await turno('t-martes', 22);
    await fichar('clock_in', L(22, 10), 't-martes');
    await fichar('clock_out', L(22, 18, 50), 't-martes');
    const id = await jornadaDel(22);

    await correr(applyPlannedBreak, { p_work_session_id: id });
    expect(await periodo()).toMatchObject({
      status: 'approved',
      changes_after_approval: 1,
      changed_after_approval_by: GERENTE,
    });

    await correr(reopenSessionDecision, {
      p_work_session_id: id,
      p_decision: 'refrigerio_del_turno',
    });
    expect(await periodo()).toMatchObject({ changes_after_approval: 2 });
    expect(await motivosAnotados()).toEqual(['planned_break_applied', 'planned_break_reopened']);
  });

  it('cambiar un «le debe» anota; volver a preguntar una salida dada por buena, no', async () => {
    await turno('t-martes', 22);
    await fichar('clock_in', L(22, 10), 't-martes');
    await fichar('clock_out', L(22, 15), 't-martes');
    const id = await jornadaDel(22);

    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'salida_dudosa',
      p_decision: 'confirmed',
    });
    await correr(reopenSessionDecision, { p_work_session_id: id, p_decision: 'salida_dudosa' });
    expect(await periodo()).toMatchObject({ changes_after_approval: 0 });

    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'faltan_horas',
      p_decision: 'owes',
      p_minutes: 180,
    });
    await correr(reopenSessionDecision, { p_work_session_id: id, p_decision: 'faltan_horas' });
    expect(await periodo()).toMatchObject({ changes_after_approval: 1 });
    expect(await motivosAnotados()).toEqual(['owed_hours_decision_reopened']);
  });

  it('«vino y no marcó» anota', async () => {
    await turno('t-miercoles', 23);
    await correr(registerMissedAttendance, {
      p_shift_id: 't-miercoles',
      p_starts_at: L(23, 10),
      p_ends_at: L(23, 19),
      p_reason: 'El reloj no tenía batería',
    });
    expect(await periodo()).toMatchObject({ changes_after_approval: 1 });
    expect(await motivosAnotados()).toEqual(['missed_attendance_registered']);
  });

  it('dar un turno por cumplido y deshacerlo anotan uno cada uno', async () => {
    await turno('t-jueves', 24);
    await correr(creditShiftAsWorked, { p_shift_id: 't-jueves', p_reason: 'election_duty' });
    await correr(undoShiftCredit, { p_shift_id: 't-jueves' });
    expect(await periodo()).toMatchObject({ changes_after_approval: 2 });
    expect(await motivosAnotados()).toEqual(['shift_credit_undone', 'shift_credited_as_worked']);
  });

  it('lo mismo en una semana sin aprobar no anota nada', async () => {
    await turno('t-otra-semana', 29);
    await correr(creditShiftAsWorked, { p_shift_id: 't-otra-semana', p_reason: 'election_duty' });
    expect(await periodo()).toMatchObject({ changes_after_approval: 0 });
    expect(await motivosAnotados()).toEqual([]);
  });
});
