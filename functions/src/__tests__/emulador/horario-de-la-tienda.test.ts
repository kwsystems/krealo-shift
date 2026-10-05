import { viewStoreSchedule } from '../../horario-de-la-tienda';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * El horario de toda la tienda en el celular de cada persona (5-oct). Lo que tiene que ser
 * cierto: ve los turnos publicados de SUS sedes, con nombre, puesto y horas; nunca un
 * borrador sin publicar, ni otra sede, ni una nota; y quien ya no está activa no ve nada.
 */

const ORG = 'org-tienda';
const OTRA_ORG = 'org-ajena';
const PROYECTO = 'demo-krealo-shift';
const VENDEDORA = 'uid-vendedora-tienda';
const SIN_FICHA = 'uid-sin-ficha-tienda';
const SEDE = 'sede-principal';
const OTRA_SEDE = 'sede-lejana';
const DESDE = '2026-10-05T05:00:00.000Z';
const HASTA = '2026-10-12T05:00:00.000Z';

const correr = (data: unknown, uid: string): Promise<unknown> =>
  (viewStoreSchedule as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

type Respuesta = {
  turnos: Record<string, unknown>[];
  sedes: { id: string; name: string }[];
};

async function ficha(id: string, extra: Record<string, unknown> = {}) {
  await db
    .collection(COLLECTIONS.employees)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      full_name: `Nombre Completo ${id}`,
      preferred_name: null,
      status: 'active',
      ...extra,
    });
}

async function asignar(employeeId: string, locationId: string) {
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${employeeId}_${locationId}`)
    .set({ organization_id: ORG, employee_id: employeeId, location_id: locationId });
}

async function turno(id: string, extra: Record<string, unknown>) {
  await db
    .collection(COLLECTIONS.shifts)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      location_id: SEDE,
      job_role_id: 'puesto-caja',
      starts_at: '2026-10-06T14:00:00.000Z',
      ends_at: '2026-10-06T22:00:00.000Z',
      status: 'published',
      publication_version: 1,
      employee_note: 'Trae tu uniforme nuevo',
      manager_note: 'Revisar su puntualidad',
      ...extra,
    });
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${VENDEDORA}`).set({
    organization_id: ORG,
    user_id: VENDEDORA,
    role: 'employee',
    status: 'active',
    managed_location_ids: [],
    employee_id: 'emp-ana',
  });
  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${SIN_FICHA}`).set({
    organization_id: ORG,
    user_id: SIN_FICHA,
    role: 'employee',
    status: 'active',
    managed_location_ids: [],
    employee_id: null,
  });
  await db.collection(COLLECTIONS.locations).doc(SEDE).set({
    id: SEDE,
    organization_id: ORG,
    name: 'Sede Principal',
  });
  await db.collection(COLLECTIONS.locations).doc(OTRA_SEDE).set({
    id: OTRA_SEDE,
    organization_id: ORG,
    name: 'Sede Lejana',
  });
  await db.collection(COLLECTIONS.jobRoles).doc('puesto-caja').set({
    id: 'puesto-caja',
    organization_id: ORG,
    name: 'Cajero',
    color: '#6D4AFF',
  });
  await ficha('emp-ana', { preferred_name: 'Ana' });
  await ficha('emp-bruno');
  await ficha('emp-lejos');
  await asignar('emp-ana', SEDE);
  await asignar('emp-bruno', SEDE);
  await asignar('emp-lejos', OTRA_SEDE);

  await turno('t-ana', { employee_id: 'emp-ana' });
  await turno('t-bruno', {
    employee_id: 'emp-bruno',
    starts_at: '2026-10-06T16:00:00.000Z',
    ends_at: '2026-10-07T00:00:00.000Z',
  });
  // Ya se le publicó y se está cambiando: sale, marcado.
  await turno('t-bruno-cambiando', {
    employee_id: 'emp-bruno',
    starts_at: '2026-10-08T14:00:00.000Z',
    ends_at: '2026-10-08T22:00:00.000Z',
    status: 'draft',
    publication_version: 2,
  });
  // Borrador nunca publicado: no existe para nadie.
  await turno('t-borrador', {
    employee_id: 'emp-bruno',
    starts_at: '2026-10-09T14:00:00.000Z',
    status: 'draft',
    publication_version: 0,
  });
  await turno('t-cancelado', { employee_id: 'emp-bruno', status: 'cancelled' });
  // Otra sede, donde ella no trabaja.
  await turno('t-lejos', { employee_id: 'emp-lejos', location_id: OTRA_SEDE });
  // Fuera de la semana pedida.
  await turno('t-otra-semana', { employee_id: 'emp-bruno', starts_at: '2026-10-13T14:00:00.000Z' });
});

describe('el horario de toda la tienda', () => {
  it('trae los turnos publicados de sus sedes, con nombre, puesto y quién es ella', async () => {
    const r = (await correr(
      { p_organization_id: ORG, p_from: DESDE, p_to: HASTA },
      VENDEDORA,
    )) as Respuesta;
    expect(r.turnos.map((t) => t.id)).toEqual(['t-ana', 't-bruno', 't-bruno-cambiando']);
    const [ana, bruno, cambiando] = r.turnos;
    expect(ana).toMatchObject({
      nombre: 'Ana',
      puesto: 'Cajero',
      es_mio: true,
      por_confirmar: false,
    });
    expect(bruno).toMatchObject({ nombre: 'Nombre Completo emp-bruno', es_mio: false });
    expect(cambiando).toMatchObject({ por_confirmar: true });
    expect(r.sedes).toEqual([{ id: SEDE, name: 'Sede Principal' }]);
  });

  it('ninguna nota sale del servidor, ni la de la persona ni la privada', async () => {
    const r = (await correr(
      { p_organization_id: ORG, p_from: DESDE, p_to: HASTA },
      VENDEDORA,
    )) as Respuesta;
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('uniforme');
    expect(texto).not.toContain('puntualidad');
    for (const t of r.turnos) {
      expect(Object.keys(t).sort()).toEqual(
        [
          'color',
          'employee_id',
          'ends_at',
          'es_mio',
          'id',
          'location_id',
          'nombre',
          'por_confirmar',
          'puesto',
          'starts_at',
        ].sort(),
      );
    }
  });

  it('una ficha borrada no aparece con un nombre inventado', async () => {
    await db.collection(COLLECTIONS.employees).doc('emp-bruno').delete();
    const r = (await correr(
      { p_organization_id: ORG, p_from: DESDE, p_to: HASTA },
      VENDEDORA,
    )) as Respuesta;
    expect(r.turnos.map((t) => t.id)).toEqual(['t-ana']);
  });

  it('quien está dada de baja no ve el horario', async () => {
    await ficha('emp-ana', { status: 'inactive' });
    await expect(
      correr({ p_organization_id: ORG, p_from: DESDE, p_to: HASTA }, VENDEDORA),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('una cuenta sin ficha, o de otra empresa, no ve nada', async () => {
    await expect(
      correr({ p_organization_id: ORG, p_from: DESDE, p_to: HASTA }, SIN_FICHA),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      correr({ p_organization_id: OTRA_ORG, p_from: DESDE, p_to: HASTA }, VENDEDORA),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('como mucho 16 días, y el final después del inicio', async () => {
    await expect(
      correr(
        { p_organization_id: ORG, p_from: DESDE, p_to: '2026-11-05T05:00:00.000Z' },
        VENDEDORA,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      correr({ p_organization_id: ORG, p_from: HASTA, p_to: DESDE }, VENDEDORA),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
