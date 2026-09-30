import { claimInvitation } from '../../invitations';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * El correo de la ficha es la invitación del vendedor (30-sep). Al entrar con él, queda
 * ligado a su ficha como `employee` y ve solo lo suyo. Cada caso es una forma de que se
 * ligue a quien NO debe, que es lo que importa: vería las horas de otra persona.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-ficha';
const CORREO = 'vendedora@example.com';

const entrar = (uid: string, correo = CORREO): Promise<unknown> =>
  (claimInvitation as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data: {},
    auth: {
      uid,
      token: { email: correo, email_verified: true, firebase: { sign_in_provider: 'google.com' } },
    },
    rawRequest: {},
  });

const membresia = async (uid: string) =>
  (await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).get()).data();

async function ficha(id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await db
    .collection(COLLECTIONS.employees)
    .doc(id)
    .set({ id, organization_id: ORG, full_name: id, email: CORREO, status: 'active', ...extra });
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
});

describe('entrar con el correo de la ficha', () => {
  it('liga la cuenta a su ficha como empleado', async () => {
    await ficha('emp-1');
    expect(await entrar('uid-vendedora')).toMatchObject({
      claimed: true,
      organizationId: ORG,
      role: 'employee',
    });
    expect(await membresia('uid-vendedora')).toMatchObject({
      role: 'employee',
      status: 'active',
      employee_id: 'emp-1',
      managed_location_ids: [],
    });
  });

  it('una ficha inactiva no da acceso', async () => {
    await ficha('emp-1', { status: 'inactive' });
    expect(await entrar('uid-vendedora')).toMatchObject({ claimed: false });
    expect(await membresia('uid-vendedora')).toBeUndefined();
  });

  it('un correo en dos fichas de la misma empresa no liga ninguna', async () => {
    await ficha('emp-1');
    await ficha('emp-2');
    expect(await entrar('uid-vendedora')).toMatchObject({
      claimed: false,
      reason: 'correo-repetido',
    });
    expect(await membresia('uid-vendedora')).toBeUndefined();
  });

  it('una ficha ya ligada a otra cuenta no se liga a una segunda', async () => {
    await ficha('emp-1');
    await entrar('uid-primera');
    expect(await entrar('uid-segunda')).toMatchObject({ claimed: false, reason: 'ya-ligada' });
    expect(await membresia('uid-segunda')).toBeUndefined();
  });

  it('entrar otra vez con la misma cuenta no rompe nada', async () => {
    await ficha('emp-1');
    await entrar('uid-vendedora');
    await entrar('uid-vendedora');
    expect(await membresia('uid-vendedora')).toMatchObject({ employee_id: 'emp-1' });
  });

  it('si además hay una invitación, manda la invitación', async () => {
    await ficha('emp-1');
    await db
      .collection(COLLECTIONS.invitations)
      .doc(`${ORG}_${CORREO}`)
      .set({
        id: `${ORG}_${CORREO}`,
        organization_id: ORG,
        email: CORREO,
        role: 'manager',
        status: 'pending',
        created_at: '2026-09-30T00:00:00.000Z',
      });
    expect(await entrar('uid-vendedora')).toMatchObject({ claimed: true, role: 'manager' });
    expect(await membresia('uid-vendedora')).toMatchObject({ role: 'manager', employee_id: null });
  });

  it('a quien ya es miembro de esa empresa no se le cambia el rol', async () => {
    await ficha('emp-1');
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_uid-gerente`)
      .set({
        id: `${ORG}_uid-gerente`,
        organization_id: ORG,
        user_id: 'uid-gerente',
        role: 'manager',
        status: 'active',
        employee_id: null,
      });
    await entrar('uid-gerente');
    expect(await membresia('uid-gerente')).toMatchObject({ role: 'manager', employee_id: null });
  });
});
