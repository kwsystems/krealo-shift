import { deleteEmployee } from '../../eliminar-empleado';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Eliminar a un empleado de prueba con todo su historial, y NADA MÁS.
 *
 * Lo que más importa de esta prueba es la última mitad de cada caso: que la compañera que
 * sí trabaja de verdad sigue entera. Andree lo dijo al pedirlo: «no borres lo demás,
 * porque ya lo están usando».
 */

const ORG = 'org-borrado';
const OTRA_ORG = 'org-ajena';
const ADMIN = 'uid-admin';
const GERENTE = 'uid-gerente';
const PRUEBA = 'emp-prueba';
const REAL = 'emp-real';
const PROYECTO = 'demo-krealo-shift';

const llamar = (uid: string, data: unknown): Promise<unknown> =>
  (deleteEmployee as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function sembrarPersona(employeeId: string, organizationId: string, status: string) {
  await db
    .collection(COLLECTIONS.employees)
    .doc(employeeId)
    .set({
      id: employeeId,
      organization_id: organizationId,
      full_name: employeeId === PRUEBA ? 'Persona De Prueba' : 'Compañera Real',
      status,
    });
  const comun = { organization_id: organizationId, employee_id: employeeId };
  await db
    .collection(COLLECTIONS.timeEvents)
    .doc(`${employeeId}-ev1`)
    .set({ ...comun, event_type: 'clock_in' });
  await db
    .collection(COLLECTIONS.timeEvents)
    .doc(`${employeeId}-ev2`)
    .set({ ...comun, event_type: 'clock_out' });
  await db
    .collection(COLLECTIONS.workSessions)
    .doc(`${employeeId}-s1`)
    .set({ ...comun, status: 'complete' });
  await db
    .collection(COLLECTIONS.shifts)
    .doc(`${employeeId}-t1`)
    .set({ ...comun, status: 'published' });
  await db
    .collection(COLLECTIONS.restDays)
    .doc(`${employeeId}-d1`)
    .set({ ...comun, date_key: '2026-09-28' });
  await db
    .collection(COLLECTIONS.timeEditRequests)
    .doc(`${employeeId}-r1`)
    .set({ ...comun, status: 'pending' });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${employeeId}-l1`)
    .set({ ...comun, location_id: 'sede' });
  await db.collection(COLLECTIONS.pinCredentials).doc(employeeId).set({ pin_hash: 'x' });
  await db
    .collection(COLLECTIONS.timeAdjustments)
    .doc(`${employeeId}-a1`)
    .set({
      organization_id: organizationId,
      work_session_id: `${employeeId}-s1`,
      target_type: 'work_session',
      target_id: `${employeeId}-s1`,
    });
}

async function cuantos(employeeId: string): Promise<number> {
  const colecciones = [
    COLLECTIONS.timeEvents,
    COLLECTIONS.workSessions,
    COLLECTIONS.shifts,
    COLLECTIONS.restDays,
    COLLECTIONS.timeEditRequests,
    COLLECTIONS.employeeLocations,
  ];
  let total = 0;
  for (const c of colecciones) {
    total += (await db.collection(c).where('employee_id', '==', employeeId).get()).size;
  }
  total += (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).exists ? 1 : 0;
  total += (await db.collection(COLLECTIONS.pinCredentials).doc(employeeId).get()).exists ? 1 : 0;
  total += (await db.collection(COLLECTIONS.timeAdjustments).doc(`${employeeId}-a1`).get()).exists
    ? 1
    : 0;
  return total;
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${ADMIN}`).set({
    organization_id: ORG,
    user_id: ADMIN,
    role: 'admin',
    status: 'active',
    managed_location_ids: [],
  });
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${GERENTE}`)
    .set({
      organization_id: ORG,
      user_id: GERENTE,
      role: 'manager',
      status: 'active',
      managed_location_ids: ['sede'],
    });
  await sembrarPersona(PRUEBA, ORG, 'inactive');
  await sembrarPersona(REAL, ORG, 'active');
});

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'sin error';
  } catch (error) {
    const e = error as { code?: string; details?: { code?: string } };
    return e.details?.code ?? e.code ?? 'desconocido';
  }
}

describe('eliminar a un empleado de prueba', () => {
  it('primero dice cuánto va a borrar, sin borrar nada', async () => {
    const r = (await llamar(ADMIN, { employeeId: PRUEBA, dryRun: true })) as {
      nombre: string;
      recuento: Record<string, number>;
    };
    expect(r.nombre).toBe('Persona De Prueba');
    expect(r.recuento).toMatchObject({
      fichajes: 2,
      jornadas: 1,
      turnos: 1,
      descansosLibres: 1,
      solicitudes: 1,
      correcciones: 1,
    });
    expect(await cuantos(PRUEBA)).toBe(10);
  });

  it('borra todo lo suyo y deja entera a la compañera real', async () => {
    await llamar(ADMIN, { employeeId: PRUEBA, confirmName: 'persona de prueba' });

    expect(await cuantos(PRUEBA)).toBe(0);
    // Lo que de verdad importa: nadie más pierde nada.
    expect(await cuantos(REAL)).toBe(10);

    const auditoria = await db
      .collection(COLLECTIONS.auditLogs)
      .where('action', '==', 'employee.deleted')
      .get();
    expect(auditoria.size).toBe(1);
  });

  it('no borra a alguien activo: primero hay que desactivarlo', async () => {
    expect(await codigoDe(llamar(ADMIN, { employeeId: REAL, confirmName: 'Compañera Real' }))).toBe(
      'must_be_inactive',
    );
    expect(await cuantos(REAL)).toBe(10);
  });

  it('no borra si el nombre escrito no coincide', async () => {
    expect(await codigoDe(llamar(ADMIN, { employeeId: PRUEBA, confirmName: 'Otra Persona' }))).toBe(
      'name_mismatch',
    );
    expect(await cuantos(PRUEBA)).toBe(10);
  });

  it('un gerente no puede borrar, solo dueño o administrador', async () => {
    expect(
      await codigoDe(llamar(GERENTE, { employeeId: PRUEBA, confirmName: 'Persona De Prueba' })),
    ).toBe('permission-denied');
    expect(await cuantos(PRUEBA)).toBe(10);
  });

  it('no toca lo de otra empresa aunque el id coincida', async () => {
    // Un documento de otra organización con el mismo employee_id.
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc('ajeno-ev')
      .set({ organization_id: OTRA_ORG, employee_id: PRUEBA, event_type: 'clock_in' });

    await llamar(ADMIN, { employeeId: PRUEBA, confirmName: 'Persona De Prueba' });

    expect((await db.collection(COLLECTIONS.timeEvents).doc('ajeno-ev').get()).exists).toBe(true);
  });
});
