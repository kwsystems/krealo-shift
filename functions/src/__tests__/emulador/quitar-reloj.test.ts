import { removeKioskDevice } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { viewKioskDevicesAdmin } from '../../views';

/**
 * QUITAR UN RELOJ DE LA LISTA (1-oct): los de prueba, que Andree quiere fuera de Ajustes.
 * Lo que tiene que ser cierto: deja de verse, deja de funcionar —sin su secreto no abre—,
 * el documento se queda para el historial, y solo puede quien gestiona esa sede.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-relojes';
const SEDE = 'sede-relojes';
const OTRA = 'sede-otra';
const GERENTE = 'uid-gerente-relojes';
const AJENO = 'uid-gerente-otra';

const correr = (fn: unknown, data: Record<string, unknown>, uid: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no falló)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

const lista = async (uid = GERENTE) =>
  (
    (await correr(
      viewKioskDevicesAdmin,
      { filters: [{ field: 'organization_id', op: 'eq', value: ORG }] },
      uid,
    )) as { id: string; status: string }[]
  ).map((d) => `${d.id}:${d.status}`);

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  for (const [uid, sede] of [
    [GERENTE, SEDE],
    [AJENO, OTRA],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({
        organization_id: ORG,
        user_id: uid,
        role: 'manager',
        status: 'active',
        managed_location_ids: [sede],
      });
  }
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ organization_id: ORG, name: 'Tienda' });
  for (const [id, status] of [
    ['reloj-prueba', 'active'],
    ['reloj-viejo', 'revoked'],
    ['reloj-tienda', 'active'],
  ] as const) {
    await db.collection(COLLECTIONS.kioskDevices).doc(id).set({
      organization_id: ORG,
      location_id: SEDE,
      display_name: id,
      status,
      created_at: '2026-09-20T00:00:00.000Z',
    });
    await db.collection(COLLECTIONS.kioskDeviceSecrets).doc(id).set({ hash: 'x' });
  }
});

describe('quitar un reloj de la lista', () => {
  it('el activo deja de funcionar y de verse; el documento se queda', async () => {
    await correr(removeKioskDevice, { p_device_id: 'reloj-prueba' }, GERENTE);
    await correr(removeKioskDevice, { p_device_id: 'reloj-viejo' }, GERENTE);

    expect(await lista()).toEqual(['reloj-tienda:active']);
    const quitado = (
      await db.collection(COLLECTIONS.kioskDevices).doc('reloj-prueba').get()
    ).data();
    expect(quitado).toMatchObject({ status: 'revoked', removed_by: GERENTE });
    expect(
      (await db.collection(COLLECTIONS.kioskDeviceSecrets).doc('reloj-prueba').get()).exists,
    ).toBe(false);
    // El que sigue en la tienda no se toca.
    expect(
      (await db.collection(COLLECTIONS.kioskDeviceSecrets).doc('reloj-tienda').get()).exists,
    ).toBe(true);
  });

  it('quien gestiona otra sede no puede', async () => {
    expect(
      await codigoDelFallo(correr(removeKioskDevice, { p_device_id: 'reloj-prueba' }, AJENO)),
    ).toBe('permission-denied');
    expect(await lista()).toContain('reloj-prueba:active');
  });
});
