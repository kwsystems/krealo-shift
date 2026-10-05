import { claimInvitation } from '../../invitations';
import { reactivateMember, unlinkMemberEmployee } from '../../members';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * «Reactivar» y «Desligar ficha» en Ajustes (5-oct). Lo que tiene que ser cierto: que a
 * quien se le quitó el acceso se le pueda devolver, que una cuenta se pueda separar de su
 * ficha para que otra la use, y que ninguna de las dos deje a dos cuentas leyendo la misma
 * ficha ni a alguien tocando a quien está por encima.
 */

const ORG = 'org-reactivar';
const PROYECTO = 'demo-krealo-shift';
const ADMIN = 'uid-admin-reac';
const GERENTE = 'uid-gerente-reac';
const VIEJA = 'uid-cuenta-vieja';
const NUEVA = 'uid-cuenta-nueva';
const CORREO = 'vendedora.reac@example.com';

const revocadas: string[] = [];
jest.mock('../../shared/admin', () => {
  const real = jest.requireActual('../../shared/admin');
  return {
    ...real,
    auth: {
      revokeRefreshTokens: (uid: string) => {
        revocadas.push(uid);
        return Promise.resolve();
      },
    },
  };
});

const correr = (fn: unknown, data: unknown, uid: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

const entrar = (uid: string): Promise<unknown> =>
  (claimInvitation as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data: {},
    auth: {
      uid,
      token: { email: CORREO, email_verified: true, firebase: { sign_in_provider: 'google.com' } },
    },
    rawRequest: {},
  });

const membresia = async (uid: string) =>
  (await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).get()).data();

async function miembro(uid: string, role: string, extra: Record<string, unknown> = {}) {
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${uid}`)
    .set({
      id: `${ORG}_${uid}`,
      organization_id: ORG,
      user_id: uid,
      role,
      status: 'active',
      managed_location_ids: [],
      employee_id: null,
      ...extra,
    });
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  revocadas.length = 0;
  await miembro(ADMIN, 'admin');
  await miembro(GERENTE, 'manager');
  await db.collection(COLLECTIONS.employees).doc('emp-1').set({
    id: 'emp-1',
    organization_id: ORG,
    full_name: 'Vendedora',
    email: CORREO,
    status: 'active',
  });
});

describe('desligar una cuenta de su ficha', () => {
  it('la cuenta vieja se queda sin ficha ni acceso, y la nueva se une sola', async () => {
    await entrar(VIEJA);
    expect(await entrar(NUEVA)).toMatchObject({ claimed: false, reason: 'ya-ligada' });

    await correr(unlinkMemberEmployee, { organizationId: ORG, userId: VIEJA }, ADMIN);
    expect(await membresia(VIEJA)).toMatchObject({ employee_id: null, status: 'suspended' });
    expect(revocadas).toEqual([VIEJA]);

    expect(await entrar(NUEVA)).toMatchObject({ claimed: true, role: 'employee' });
    expect(await membresia(NUEVA)).toMatchObject({ employee_id: 'emp-1', status: 'active' });
    // Y la vieja, al volver a entrar, no se la vuelve a llevar.
    expect(await entrar(VIEJA)).toMatchObject({ claimed: false, reason: 'acceso-retirado' });
  });

  it('a un gerente solo se le quita la ficha: su panel sigue', async () => {
    await miembro('uid-gerente-que-ficha', 'manager', { employee_id: 'emp-1' });
    await correr(
      unlinkMemberEmployee,
      { organizationId: ORG, userId: 'uid-gerente-que-ficha' },
      ADMIN,
    );
    expect(await membresia('uid-gerente-que-ficha')).toMatchObject({
      employee_id: null,
      status: 'active',
      role: 'manager',
    });
    expect(revocadas).toEqual([]);
  });

  it('un gerente no puede desligar ni reactivar', async () => {
    await entrar(VIEJA);
    await expect(
      correr(unlinkMemberEmployee, { organizationId: ORG, userId: VIEJA }, GERENTE),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      correr(reactivateMember, { organizationId: ORG, userId: VIEJA }, GERENTE),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('reactivar a quien se le quitó el acceso', () => {
  it('vuelve a estar activa con su ficha', async () => {
    await entrar(VIEJA);
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${VIEJA}`)
      .update({ status: 'suspended' });

    await correr(reactivateMember, { organizationId: ORG, userId: VIEJA }, ADMIN);
    expect(await membresia(VIEJA)).toMatchObject({ status: 'active', employee_id: 'emp-1' });
  });

  it('no si su ficha ya la usa otra cuenta activa', async () => {
    await entrar(VIEJA);
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${VIEJA}`)
      .update({ status: 'suspended' });
    await miembro(NUEVA, 'employee', { employee_id: 'emp-1' });

    await expect(
      correr(reactivateMember, { organizationId: ORG, userId: VIEJA }, ADMIN),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await membresia(VIEJA)).toMatchObject({ status: 'suspended' });
  });

  it('no a alguien por encima', async () => {
    await miembro('uid-dueno-reac', 'owner', { status: 'suspended' });
    await expect(
      correr(reactivateMember, { organizationId: ORG, userId: 'uid-dueno-reac' }, ADMIN),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
