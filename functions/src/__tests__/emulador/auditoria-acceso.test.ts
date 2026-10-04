import { claimInvitation, inviteMember } from '../../invitations';
import { setMemberLocations, setMemberRole } from '../../members';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * LO QUE ENCONTRÓ LA AUDITORÍA DEL 4-OCT EN EL ACCESO:
 *
 *   - e04: un gerente nunca recibía sedes, así que casi todo el panel le decía «Falta un
 *     permiso». Ahora se eligen al invitarlo, se conservan al cambiar de rol y se pueden
 *     cambiar en Ajustes (`setMemberLocations`).
 *   - e31: una cuenta de empleado sin ficha no se ligaba nunca; una cuenta retirada
 *     bloqueaba a la nueva; volver a invitar a alguien le borraba su ficha.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-acceso';
const SEDE = 'sede-acceso-1';
const SEDE2 = 'sede-acceso-2';
const ADMIN = 'uid-admin-acceso';
const CORREO = 'gerente@example.com';

const correr = (fn: unknown, data: Record<string, unknown>, uid = ADMIN): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

const entrar = (uid: string, correo: string): Promise<unknown> =>
  (claimInvitation as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data: {},
    auth: {
      uid,
      token: { email: correo, email_verified: true, firebase: { sign_in_provider: 'google.com' } },
    },
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

const membresia = async (uid: string) =>
  (await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).get()).data();

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  for (const sede of [SEDE, SEDE2]) {
    await db
      .collection(COLLECTIONS.locations)
      .doc(sede)
      .set({ id: sede, organization_id: ORG, timezone: 'America/Lima', settings: {} });
  }
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${ADMIN}`)
    .set({
      organization_id: ORG,
      user_id: ADMIN,
      role: 'admin',
      status: 'active',
      managed_location_ids: [SEDE, SEDE2],
    });
});

describe('e04: las sedes de un gerente', () => {
  it('invitarlo sin sedes no vale; con sedes, las gestiona al entrar', async () => {
    const sinSedes = await fallo(
      correr(inviteMember, { organizationId: ORG, email: CORREO, role: 'manager' }),
    );
    expect(sinSedes.details).toEqual({ motivo: 'SIN_SEDES' });

    await correr(inviteMember, {
      organizationId: ORG,
      email: CORREO,
      role: 'manager',
      locationIds: [SEDE, 'sede-de-otra-empresa'],
    });
    await entrar('uid-gerente', CORREO);
    expect(await membresia('uid-gerente')).toMatchObject({
      role: 'manager',
      managed_location_ids: [SEDE],
    });
  });

  it('se cambian en Ajustes, y pasar a gerente no las borra', async () => {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_uid-g`)
      .set({
        organization_id: ORG,
        user_id: 'uid-g',
        role: 'manager',
        status: 'active',
        managed_location_ids: [SEDE],
      });
    await correr(setMemberLocations, {
      organizationId: ORG,
      userId: 'uid-g',
      locationIds: [SEDE, SEDE2],
    });
    expect((await membresia('uid-g'))?.managed_location_ids).toEqual([SEDE, SEDE2]);

    const vacio = await fallo(
      correr(setMemberLocations, { organizationId: ORG, userId: 'uid-g', locationIds: [] }),
    );
    expect(vacio.details).toEqual({ motivo: 'SIN_SEDES' });

    await correr(setMemberRole, { organizationId: ORG, userId: 'uid-g', role: 'manager' });
    expect((await membresia('uid-g'))?.managed_location_ids).toEqual([SEDE, SEDE2]);
  });
});

describe('e31: ligar la cuenta de empleado a su ficha', () => {
  const VENDEDORA = 'vendedora@example.com';
  beforeEach(async () => {
    await db.collection(COLLECTIONS.employees).doc('emp-1').set({
      id: 'emp-1',
      organization_id: ORG,
      full_name: 'Vendedora',
      email: VENDEDORA,
      status: 'active',
    });
  });

  it('invitada como Empleado y con su correo puesto después en la ficha: se liga', async () => {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_uid-v`).set({
      organization_id: ORG,
      user_id: 'uid-v',
      role: 'employee',
      status: 'active',
      managed_location_ids: [],
      employee_id: null,
    });
    await entrar('uid-v', VENDEDORA);
    expect(await membresia('uid-v')).toMatchObject({ role: 'employee', employee_id: 'emp-1' });
  });

  it('una cuenta retirada no bloquea a la nueva', async () => {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_uid-vieja`).set({
      organization_id: ORG,
      user_id: 'uid-vieja',
      role: 'employee',
      status: 'suspended',
      managed_location_ids: [],
      employee_id: 'emp-1',
    });
    expect(await entrar('uid-nueva', VENDEDORA)).toMatchObject({ claimed: true });
    expect(await membresia('uid-nueva')).toMatchObject({ employee_id: 'emp-1' });
  });

  it('volver a invitar a alguien no le borra su ficha', async () => {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_uid-v`).set({
      organization_id: ORG,
      user_id: 'uid-v',
      role: 'employee',
      status: 'active',
      managed_location_ids: [],
      employee_id: 'emp-1',
    });
    await correr(inviteMember, { organizationId: ORG, email: VENDEDORA, role: 'employee' });
    await entrar('uid-v', VENDEDORA);
    expect(await membresia('uid-v')).toMatchObject({ employee_id: 'emp-1' });
  });
});
