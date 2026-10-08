import { applyPlannedBreak, resolveSessionCase, settleOwedHours } from '../../casos';
import { managerAdjustTime } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';

/**
 * Los casos de Horas, resueltos a un toque (Andree, 1-oct). Uno por cada cosa que dijo:
 * «ella me debe horas» —la que se fue enferma—, «no marcó para comer» —la que salió con
 * 8:50 trabajadas sin refrigerio—, y que se pueda dar por bueno lo que lo es.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-casos';
const SEDE = 'sede-casos';
const GERENTE = 'uid-gerente-casos';
const PERSONA = 'emp-casos';
const TURNO = 'turno-casos';

// Lima, UTC-5: el martes 22-sep.
const H = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, 22, hora + 5, minuto)).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>, uid = GERENTE): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function fichar(tipo: 'clock_in' | 'clock_out', cuando: string) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    shiftId: TURNO,
    source: 'kiosk',
  });
}

const jornada = async () => {
  const docs = (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs;
  expect(docs).toHaveLength(1);
  return { id: docs[0]!.id, ...docs[0]!.data() } as Record<string, unknown>;
};

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({
      id: SEDE,
      organization_id: ORG,
      timezone: 'America/Lima',
      settings: { lateGraceMinutes: 5 },
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
  // Turno de 10:00 a 19:00 con una hora de refrigerio: ocho horas netas.
  await db
    .collection(COLLECTIONS.shifts)
    .doc(TURNO)
    .set({
      id: TURNO,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: H(10),
      ends_at: H(19),
      planned_unpaid_break_minutes: 60,
      status: 'published',
      publication_version: 1,
    });
});

describe('no marcó el refrigerio', () => {
  it('«descontar el del turno» pone la pausa en el centro y la jornada baja a lo trabajado', async () => {
    await fichar('clock_in', H(10));
    await fichar('clock_out', H(18, 50));
    const antes = await jornada();
    expect(antes).toMatchObject({ net_minutes: 530, unpaid_break_minutes: 0 });

    const r = (await correr(applyPlannedBreak, { p_work_session_id: antes.id })) as {
      desde: string;
      hasta: string;
    };
    expect([r.desde, r.hasta]).toEqual([H(14), H(15)]);

    const despues = await jornada();
    expect(despues).toMatchObject({ id: antes.id, net_minutes: 470, unpaid_break_minutes: 60 });
    // Los fichajes de la persona no se tocan: se añaden dos, a nombre de quien gestiona.
    const eventos = (
      await db.collection(COLLECTIONS.timeEvents).where('employee_id', '==', PERSONA).get()
    ).docs.map((d) => d.data());
    expect(
      eventos
        .filter((e) => e.source === 'manager')
        .map((e) => e.event_type)
        .sort(),
    ).toEqual(['break_end', 'break_start']);
    const ajustes = await db
      .collection(COLLECTIONS.timeAdjustments)
      .where('employee_id', '==', PERSONA)
      .get();
    expect(ajustes.size).toBe(2);
  });

  it('dos veces no pone dos pausas', async () => {
    await fichar('clock_in', H(10));
    await fichar('clock_out', H(18, 50));
    const { id } = await jornada();
    await correr(applyPlannedBreak, { p_work_session_id: id });
    await expect(correr(applyPlannedBreak, { p_work_session_id: id })).rejects.toMatchObject({
      details: { motivo: 'YA_TIENE_PAUSA' },
    });
    expect((await jornada()).unpaid_break_minutes).toBe(60);
  });

  /*
   * Antes se rechazaba (AJUSTADA) porque volver a calcular la jornada borraba la corrección.
   * Desde el 4-oct se conserva, y el rechazo dejaba el caso imposible de cerrar (8-oct).
   */
  it('sobre una hora corregida a mano descuenta el refrigerio y conserva la corrección', async () => {
    await fichar('clock_in', H(10));
    await fichar('clock_out', H(18, 50));
    const { id } = await jornada();
    await correr(managerAdjustTime, {
      p_work_session_id: id,
      p_new_starts_at: null,
      p_new_ends_at: H(19),
      p_reason: 'Se quedó cerrando',
    });
    const r = (await correr(applyPlannedBreak, { p_work_session_id: id })) as {
      desde: string;
      hasta: string;
    };
    // En el centro de lo que marcó (10:00 a 18:50), no de la jornada corregida.
    expect([r.desde, r.hasta]).toEqual([H(14), H(15)]);
    expect(await jornada()).toMatchObject({
      id,
      ends_at: H(19),
      gross_minutes: 540,
      unpaid_break_minutes: 60,
      net_minutes: 480,
    });
  });

  it('con la entrada corregida, también: la entrada sigue corregida', async () => {
    await fichar('clock_in', H(10, 20));
    await fichar('clock_out', H(19, 1));
    const { id } = await jornada();
    await correr(managerAdjustTime, {
      p_work_session_id: id,
      p_new_starts_at: H(10),
      p_new_ends_at: null,
      p_reason: 'Entró a su hora y marcó tarde',
    });
    await correr(applyPlannedBreak, { p_work_session_id: id });
    expect(await jornada()).toMatchObject({
      id,
      starts_at: H(10),
      ends_at: H(19, 1),
      unpaid_break_minutes: 60,
      net_minutes: 481,
    });
  });

  it('si la pausa que se puso quedó fuera tras corregir la salida, se mueve y vuelve a contar', async () => {
    await fichar('clock_in', H(10));
    await fichar('clock_out', H(18, 50));
    const { id } = await jornada();
    await correr(applyPlannedBreak, { p_work_session_id: id }); // 14:00 a 15:00
    // La salida se corrige a las 14:30: la vuelta de las 15:00 cae fuera.
    await correr(managerAdjustTime, {
      p_work_session_id: id,
      p_new_starts_at: null,
      p_new_ends_at: H(14, 30),
      p_reason: 'Se fue a las 14:30',
    });
    await correr(managerAdjustTime, {
      p_work_session_id: id,
      p_new_starts_at: null,
      p_new_ends_at: H(18, 50),
      p_reason: 'No, se fue a las 18:50',
    });
    const r = (await correr(applyPlannedBreak, { p_work_session_id: id }).catch(
      (e: unknown) => e,
    )) as { desde?: string; details?: { motivo?: string } };
    // O ya tenía su pausa (y lo dice), o la vuelve a poner: nunca «hecho» sin descontar.
    if (r.details?.motivo === 'YA_TIENE_PAUSA') {
      expect((await jornada()).unpaid_break_minutes).toBe(60);
    } else {
      expect(await jornada()).toMatchObject({ unpaid_break_minutes: 60, net_minutes: 470 });
    }
  });

  it('«trabajó sin refrigerio» lo deja como está y lo da por resuelto', async () => {
    await fichar('clock_in', H(10));
    await fichar('clock_out', H(18, 50));
    const { id } = await jornada();
    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'sin_refrigerio',
      p_decision: 'worked_through',
    });
    expect(await jornada()).toMatchObject({
      net_minutes: 530,
      casos_resueltos: ['sin_refrigerio'],
    });
  });
});

describe('salida dudosa', () => {
  // Una jornada larga de verdad (8-oct): se da por buena y no vuelve.
  it('«la salida está bien» la deja como está y la da por resuelta', async () => {
    await fichar('clock_in', H(6, 30));
    await fichar('clock_out', H(23));
    const { id } = await jornada();
    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'salida_dudosa',
      p_decision: 'confirmed',
    });
    expect(await jornada()).toMatchObject({ ends_at: H(23), casos_resueltos: ['salida_dudosa'] });
  });
});

describe('trabajó menos que su turno', () => {
  it('«le debe» deja las horas a su nombre, una vez por jornada, y se pueden saldar', async () => {
    await fichar('clock_in', H(9, 52));
    await fichar('clock_out', H(12, 4));
    const { id } = await jornada();

    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'faltan_horas',
      p_decision: 'owes',
      p_minutes: 289,
      p_note: 'Se enfermó',
    });
    let debe = (await db.collection(COLLECTIONS.owedHours).doc(id).get()).data();
    expect(debe).toMatchObject({
      employee_id: PERSONA,
      location_id: SEDE,
      work_date: '2026-09-22',
      minutes: 289,
      note: 'Se enfermó',
      status: 'pending',
    });
    expect((await jornada()).casos_resueltos).toEqual(['faltan_horas']);

    // Registrarla otra vez la corrige; no suma otra.
    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'faltan_horas',
      p_decision: 'owes',
      p_minutes: 300,
    });
    const todas = await db
      .collection(COLLECTIONS.owedHours)
      .where('employee_id', '==', PERSONA)
      .get();
    expect(todas.size).toBe(1);
    expect(todas.docs[0]!.data().minutes).toBe(300);

    await correr(settleOwedHours, { p_owed_id: id, p_status: 'compensated' });
    debe = (await db.collection(COLLECTIONS.owedHours).doc(id).get()).data();
    expect(debe).toMatchObject({ status: 'compensated', settled_by: GERENTE });
  });

  it('«está justificado» no deja horas debidas', async () => {
    await fichar('clock_in', H(9, 52));
    await fichar('clock_out', H(12, 4));
    const { id } = await jornada();
    await correr(resolveSessionCase, {
      p_work_session_id: id,
      p_case: 'faltan_horas',
      p_decision: 'justified',
      p_note: 'Permiso médico',
    });
    expect((await db.collection(COLLECTIONS.owedHours).doc(id).get()).exists).toBe(false);
    expect(await jornada()).toMatchObject({ casos_resueltos: ['faltan_horas'] });
  });

  it('no se resuelve una jornada abierta, ni con una decisión que no es de ese caso', async () => {
    await fichar('clock_in', H(9, 52));
    const { id } = await jornada();
    await expect(
      correr(resolveSessionCase, {
        p_work_session_id: id,
        p_case: 'faltan_horas',
        p_decision: 'owes',
        p_minutes: 60,
      }),
    ).rejects.toMatchObject({ details: { motivo: 'ABIERTA' } });
    await fichar('clock_out', H(12, 4));
    await expect(
      correr(resolveSessionCase, {
        p_work_session_id: id,
        p_case: 'faltan_horas',
        p_decision: 'worked_through',
      }),
    ).rejects.toThrow();
  });

  it('solo quien gestiona la sede', async () => {
    await fichar('clock_in', H(9, 52));
    await fichar('clock_out', H(12, 4));
    const { id } = await jornada();
    await expect(
      correr(
        resolveSessionCase,
        { p_work_session_id: id, p_case: 'faltan_horas', p_decision: 'owes', p_minutes: 60 },
        'uid-de-otra-tienda',
      ),
    ).rejects.toThrow();
    await expect(
      correr(applyPlannedBreak, { p_work_session_id: id }, 'uid-de-otra-tienda'),
    ).rejects.toThrow();
  });
});
