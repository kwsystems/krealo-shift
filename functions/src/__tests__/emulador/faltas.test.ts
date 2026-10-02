import { clearAbsenceResolution, resolveAbsence } from '../../faltas';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * POR QUÉ FALTÓ (2-oct). Lo que tiene que ser cierto: quien gestiona la sede del turno lo
 * dice —justificada o no, con su motivo— y decirlo otra vez lo cambia; un motivo que no
 * vale para ese tipo, «Otro» sin explicar o un turno que no terminó no se guardan; nadie de
 * otra sede ni la propia persona pueden escribirlo; y se puede volver a «sin revisar».
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-faltas';
const SEDE = 'sede-faltas';
const OTRA = 'sede-otra-faltas';
const GERENTE = 'uid-gerente-faltas';
const AJENO = 'uid-gerente-otra-faltas';
const VENDEDORA = 'uid-vendedora-faltas';
const TURNO = 'turno-faltado';
const TURNO_FUTURO = 'turno-futuro';

const correr = (fn: unknown, data: Record<string, unknown>, uid: string): Promise<unknown> =>
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
    return e.details?.motivo === undefined ? String(e.code) : `${e.code}:${e.details.motivo}`;
  }
}

const leer = async () =>
  (await db.collection(COLLECTIONS.absenceResolutions).doc(TURNO).get()).data();

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  const miembros: [string, string, string[], string | null][] = [
    [GERENTE, 'manager', [SEDE], null],
    [AJENO, 'manager', [OTRA], null],
    [VENDEDORA, 'employee', [], 'emp-faltas'],
  ];
  for (const [uid, role, sedes, empleado] of miembros) {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).set({
      organization_id: ORG,
      user_id: uid,
      role,
      status: 'active',
      managed_location_ids: sedes,
      employee_id: empleado,
    });
  }
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ organization_id: ORG, name: 'Sede', timezone: 'America/Lima' });
  const turno = (id: string, desde: string, hasta: string) =>
    db.collection(COLLECTIONS.shifts).doc(id).set({
      id,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: 'emp-faltas',
      starts_at: desde,
      ends_at: hasta,
      status: 'published',
    });
  // 20:00 del 30 de septiembre en Lima: en UTC ya es el 1 de octubre.
  await turno(TURNO, '2026-10-01T01:00:00.000Z', '2026-10-01T04:00:00.000Z');
  await turno(TURNO_FUTURO, '2099-01-01T15:00:00.000Z', '2099-01-01T23:00:00.000Z');
});

describe('decir por qué faltó', () => {
  it('quien gestiona la sede lo dice, con el día de la sede, y decirlo otra vez lo cambia', async () => {
    await correr(
      resolveAbsence,
      { p_shift_id: TURNO, p_kind: 'justified', p_reason: 'medical', p_note: 'Descanso médico' },
      GERENTE,
    );
    expect(await leer()).toMatchObject({
      employee_id: 'emp-faltas',
      location_id: SEDE,
      work_date: '2026-09-30',
      kind: 'justified',
      reason: 'medical',
      note: 'Descanso médico',
      decided_by: GERENTE,
    });
    await correr(
      resolveAbsence,
      { p_shift_id: TURNO, p_kind: 'unjustified', p_reason: 'no_notice' },
      GERENTE,
    );
    expect(await leer()).toMatchObject({ kind: 'unjustified', reason: 'no_notice', note: null });
  });

  it('lo que no tiene sentido no se guarda', async () => {
    expect(
      await motivoDelFallo(
        correr(
          resolveAbsence,
          { p_shift_id: TURNO, p_kind: 'justified', p_reason: 'no_notice' },
          GERENTE,
        ),
      ),
    ).toBe('invalid-argument:MOTIVO');
    expect(
      await motivoDelFallo(
        correr(
          resolveAbsence,
          { p_shift_id: TURNO, p_kind: 'unjustified', p_reason: 'other' },
          GERENTE,
        ),
      ),
    ).toBe('invalid-argument:NOTA');
    expect(
      await motivoDelFallo(
        correr(
          resolveAbsence,
          { p_shift_id: TURNO_FUTURO, p_kind: 'justified', p_reason: 'medical' },
          GERENTE,
        ),
      ),
    ).toBe('failed-precondition:NO_TERMINO');
    expect(await leer()).toBeUndefined();
  });

  it('ni quien gestiona otra sede ni la propia persona pueden decirlo', async () => {
    const datos = { p_shift_id: TURNO, p_kind: 'justified', p_reason: 'medical' };
    expect(await motivoDelFallo(correr(resolveAbsence, datos, AJENO))).toBe('permission-denied');
    expect(await motivoDelFallo(correr(resolveAbsence, datos, VENDEDORA))).toBe(
      'permission-denied',
    );
    expect(await leer()).toBeUndefined();
  });

  it('se puede volver a «sin revisar»', async () => {
    await correr(
      resolveAbsence,
      { p_shift_id: TURNO, p_kind: 'justified', p_reason: 'family' },
      GERENTE,
    );
    expect(await motivoDelFallo(correr(clearAbsenceResolution, { p_shift_id: TURNO }, AJENO))).toBe(
      'permission-denied',
    );
    await correr(clearAbsenceResolution, { p_shift_id: TURNO }, GERENTE);
    expect(await leer()).toBeUndefined();
  });
});
