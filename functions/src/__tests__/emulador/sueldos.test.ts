import { COLLECTIONS, db } from '../../shared/admin';
import { setEmployeePay } from '../../sueldos';

/**
 * EL SUELDO DE CADA PERSONA (13-oct). Lo que tiene que ser cierto: solo el dueño o un
 * administrador lo guarda —un gerente de sede no—; guardarlo otra vez lo cambia; un monto
 * sin sentido no se guarda; y sin sueldo se borra.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-sueldos';
const DUENO = 'uid-dueno-sueldos';
const GERENTE = 'uid-gerente-sueldos';
const PERSONA = 'emp-sueldos';

const correr = (data: Record<string, unknown>, uid: string): Promise<unknown> =>
  (setEmployeePay as unknown as { run: (r: unknown) => Promise<unknown> }).run({
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

const leer = async () => (await db.collection(COLLECTIONS.employeePay).doc(PERSONA).get()).data();

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  for (const [uid, role] of [
    [DUENO, 'owner'],
    [GERENTE, 'manager'],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({
        organization_id: ORG,
        user_id: uid,
        role,
        status: 'active',
        managed_location_ids: ['sede-sueldos'],
        employee_id: null,
      });
  }
  await db
    .collection(COLLECTIONS.employees)
    .doc(PERSONA)
    .set({ id: PERSONA, organization_id: ORG, full_name: 'Persona', status: 'active' });
});

describe('el sueldo de cada persona', () => {
  it('el dueño lo guarda, y guardarlo otra vez lo cambia', async () => {
    await correr(
      {
        p_employee_id: PERSONA,
        p_monthly_salary: 1500,
        p_family_allowance: true,
        p_pension: 'onp',
      },
      DUENO,
    );
    expect(await leer()).toMatchObject({
      organization_id: ORG,
      employee_id: PERSONA,
      monthly_salary: 1500,
      family_allowance: true,
      pension: 'onp',
    });
    await correr({ p_employee_id: PERSONA, p_monthly_salary: 1650.5, p_pension: null }, DUENO);
    expect(await leer()).toMatchObject({
      monthly_salary: 1650.5,
      family_allowance: false,
      pension: null,
    });
  });

  it('un gerente de sede no lo guarda', async () => {
    expect(
      await motivoDelFallo(correr({ p_employee_id: PERSONA, p_monthly_salary: 1500 }, GERENTE)),
    ).toBe('permission-denied');
    expect(await leer()).toBeUndefined();
  });

  it('un monto sin sentido o una pensión que no existe no se guardan', async () => {
    for (const p_monthly_salary of [0, -10, 'mil', 1_000_000]) {
      expect(
        await motivoDelFallo(correr({ p_employee_id: PERSONA, p_monthly_salary }, DUENO)),
      ).toBe('invalid-argument:SUELDO');
    }
    expect(
      await motivoDelFallo(
        correr({ p_employee_id: PERSONA, p_monthly_salary: 1500, p_pension: 'otra' }, DUENO),
      ),
    ).toBe('invalid-argument:PENSION');
    expect(await leer()).toBeUndefined();
  });

  it('sin sueldo se borra', async () => {
    await correr({ p_employee_id: PERSONA, p_monthly_salary: 1500 }, DUENO);
    await correr({ p_employee_id: PERSONA, p_monthly_salary: null }, DUENO);
    expect(await leer()).toBeUndefined();
  });
});
