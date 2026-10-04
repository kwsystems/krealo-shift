import { dischargeEmployee } from '../../baja-de-empleado';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Dar de baja con el último día (4-oct). Andree: «su último día fue el miércoles 30 de
 * setiembre, ya no está en octubre. No quiero que se borren sus datos».
 *
 * Lo que se comprueba es la frontera del último día: lo de antes se queda ENTERO —incluido
 * el turno de esa misma noche, que en UTC ya es el día siguiente— y lo de después deja de
 * existir para el horario, cancelado y no borrado.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-baja';
const SEDE = 'sede-baja';
const ADMIN = 'uid-admin-baja';
const VENDEDORA = 'uid-vendedora-baja';
const PERSONA = 'emp-baja';

// Lima, UTC-5.
const lima = (dia: string, hora: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + (hora + 5) * 3600_000).toISOString();

const correr = (uid: string, data: Record<string, unknown>): Promise<unknown> =>
  (dischargeEmployee as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function fallo(promesa: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await promesa;
    return { code: '(no fallo)', details: null };
  } catch (error) {
    const e = error as { code?: string; details?: unknown };
    return { code: e.code ?? String(error), details: e.details ?? null };
  }
}

async function turno(id: string, desde: string, hasta: string, status = 'published') {
  await db
    .collection(COLLECTIONS.shifts)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: desde,
      ends_at: hasta,
      timezone: 'America/Lima',
      status,
      publication_version: status === 'published' ? 1 : 0,
    });
}

const estado = async (id: string) =>
  (await db.collection(COLLECTIONS.shifts).doc(id).get()).data()?.status;

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db
    .collection(COLLECTIONS.organizations)
    .doc(ORG)
    .set({ id: ORG, name: 'Tienda', default_timezone: 'America/Lima' });
  for (const [uid, role] of [
    [ADMIN, 'admin'],
    [VENDEDORA, 'employee'],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({ organization_id: ORG, user_id: uid, role, status: 'active' });
  }
  await db.collection(COLLECTIONS.employees).doc(PERSONA).set({
    id: PERSONA,
    organization_id: ORG,
    full_name: 'Quien Se Fue',
    status: 'active',
  });

  await turno('t-29', lima('2026-09-29', 10), lima('2026-09-29', 18));
  // El último turno que SÍ hizo: 30-sep de 13:00 a 22:00, que en UTC acaba el 1-oct.
  await turno('t-30-noche', lima('2026-09-30', 13), lima('2026-09-30', 22));
  await turno('t-01', lima('2026-10-01', 10), lima('2026-10-01', 18));
  // Uno de la noche del 1-oct que en UTC ya es 2-oct: también se va.
  await turno('t-01-noche', lima('2026-10-01', 21), lima('2026-10-02', 3));
  await turno('t-02-borrador', lima('2026-10-02', 10), lima('2026-10-02', 18), 'draft');
  await turno('t-03-cancelado', lima('2026-10-03', 10), lima('2026-10-03', 18), 'cancelled');

  for (const dia of ['2026-09-28', '2026-10-04']) {
    await db.collection(COLLECTIONS.restDays).doc(`${SEDE}_${PERSONA}_${dia}`).set({
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      date_key: dia,
    });
  }

  await db
    .collection(COLLECTIONS.workSessions)
    .doc(`${PERSONA}_s30`)
    .set({
      id: `${PERSONA}_s30`,
      organization_id: ORG,
      employee_id: PERSONA,
      location_id: SEDE,
      starts_at: lima('2026-09-30', 12.9),
      ends_at: lima('2026-09-30', 22),
      status: 'complete',
      net_minutes: 480,
    });
});

describe('dar de baja con su último día', () => {
  it('sin escribir nada, dice cuántos turnos se quitan y cuándo marcó por última vez', async () => {
    const resumen = (await correr(ADMIN, {
      employeeId: PERSONA,
      lastDay: '2026-09-30',
      dryRun: true,
    })) as Record<string, unknown>;
    expect(resumen).toMatchObject({ turnos: 3, descansos: 1, ultimoDiaMarcado: '2026-09-30' });
    expect((await db.collection(COLLECTIONS.employees).doc(PERSONA).get()).data()?.status).toBe(
      'active',
    );
    expect(await estado('t-01')).toBe('published');
  });

  it('lo de antes se queda entero; lo de después se cancela, no se borra', async () => {
    await correr(ADMIN, { employeeId: PERSONA, lastDay: '2026-09-30' });

    const ficha = (await db.collection(COLLECTIONS.employees).doc(PERSONA).get()).data();
    expect(ficha).toMatchObject({ status: 'inactive', end_date: '2026-09-30' });

    expect(await estado('t-29')).toBe('published');
    expect(await estado('t-30-noche')).toBe('published');
    expect(await estado('t-01')).toBe('cancelled');
    expect(await estado('t-01-noche')).toBe('cancelled');
    expect(await estado('t-02-borrador')).toBe('cancelled');
    expect(await estado('t-03-cancelado')).toBe('cancelled');
    // Ningún turno se borró.
    expect(
      (await db.collection(COLLECTIONS.shifts).where('employee_id', '==', PERSONA).get()).size,
    ).toBe(6);

    const descansos = await db
      .collection(COLLECTIONS.restDays)
      .where('employee_id', '==', PERSONA)
      .get();
    expect(descansos.docs.map((d) => d.data().date_key)).toEqual(['2026-09-28']);

    // Su jornada sigue ahí.
    expect((await db.collection(COLLECTIONS.workSessions).doc(`${PERSONA}_s30`).get()).exists).toBe(
      true,
    );
    const auditoria = await db
      .collection(COLLECTIONS.auditLogs)
      .where('action', '==', 'employee_discharged')
      .get();
    expect(auditoria.size).toBe(1);
  });

  it('el último día no puede ser futuro', async () => {
    const resultado = await fallo(correr(ADMIN, { employeeId: PERSONA, lastDay: '2999-01-01' }));
    expect(resultado.code).toBe('invalid-argument');
    expect(resultado.details).toEqual({ code: 'future_last_day' });
  });

  it('una cuenta de empleado no puede dar de baja a nadie', async () => {
    const resultado = await fallo(
      correr(VENDEDORA, { employeeId: PERSONA, lastDay: '2026-09-30' }),
    );
    expect(resultado.code).toBe('permission-denied');
    expect(await estado('t-01')).toBe('published');
  });
});
