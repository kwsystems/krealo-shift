import { setMemberRole } from '../../members';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * `setMemberRole`, que es quien reparte el poder dentro de una organizacion (§14).
 *
 * POR QUE ESTA Y NO OTRA. Las Cloud Functions no tenian ni una prueba, y de las 29 hay
 * que empezar por donde mas duele equivocarse. Esta decide quien puede administrar la
 * empresa: las horas que se pagan, los PIN, las sedes. Y sus comprobaciones son la
 * UNICA barrera, porque el Admin SDK se salta `firestore.rules` por diseño — una regla
 * mal puesta aqui no la tapa nada.
 *
 * LO QUE SE PRUEBA ES EL PEGAMENTO, no la logica de dominio. La maquina de estados y el
 * calculo de horas viven en `src/domain` y ya tienen sus pruebas. Aqui lo que no estaba
 * cubierto es exactamente donde se cuelan los fallos de permisos: que exige sesion, que
 * comprueba el rol ANTES de escribir, que no se puede uno ascender, y que deja rastro.
 *
 * Se invoca con `.run()`, que es como firebase-functions deja llamar a una funcion
 * `onCall` sin levantar el emulador de Functions: se le pasa la peticion que le llegaria
 * y se ejecuta el mismo cuerpo que en produccion.
 */

const ORG = 'org-miembros';
const PROYECTO = 'demo-krealo-shift';

const DUENO = 'uid-dueno';
const ADMIN = 'uid-admin';
const GERENTE = 'uid-gerente';
const EMPLEADO = 'uid-empleado';

type Rol = 'owner' | 'admin' | 'manager' | 'employee';

/** `.run()` no esta en los tipos publicos de la funcion desplegable, pero existe. */
const llamar = (data: unknown, uid: string | null): Promise<unknown> =>
  (setMemberRole as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === null ? undefined : { uid, token: {} },
    rawRequest: {},
  });

async function ponerMiembro(uid: string, rol: Rol, estado = 'active'): Promise<void> {
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${uid}`)
    .set({
      id: `${ORG}_${uid}`,
      organization_id: ORG,
      user_id: uid,
      role: rol,
      status: estado,
      managed_location_ids: rol === 'manager' ? ['sede-1'] : [],
      created_at: '2026-01-01T00:00:00.000Z',
    });
}

const rolDe = async (uid: string): Promise<unknown> =>
  (await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).get()).data()?.role;

/** El codigo de un HttpsError, o el mensaje si lo que salio no fue uno. */
async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db.collection(COLLECTIONS.locations).doc('sede-1').set({
    id: 'sede-1',
    organization_id: ORG,
    name: 'Sede 1',
  });
  await ponerMiembro(DUENO, 'owner');
  await ponerMiembro(ADMIN, 'admin');
  await ponerMiembro(GERENTE, 'manager');
  await ponerMiembro(EMPLEADO, 'employee');
});

describe('setMemberRole', () => {
  it('un admin asciende a un empleado a gerente', async () => {
    await llamar({ organizationId: ORG, userId: EMPLEADO, role: 'manager' }, ADMIN);
    expect(await rolDe(EMPLEADO)).toBe('manager');
  });

  it('sin sesión no se puede', async () => {
    expect(
      await codigoDelFallo(llamar({ organizationId: ORG, userId: EMPLEADO, role: 'admin' }, null)),
    ).toBe('unauthenticated');
    expect(await rolDe(EMPLEADO)).toBe('employee');
  });

  /**
   * EL ROL QUE SE PIDE ES DEL MISMO RANGO QUE EL DEL GERENTE, y eso es deliberado.
   *
   * La primera version pedia `admin` y pasaba… por el motivo equivocado: lo frenaba la
   * comprobacion de rangos («no puedes dar un rol superior al tuyo»), no la de rol. Se
   * vio quitando `requireRole` a proposito: la prueba seguia en verde con la puerta
   * abierta. Pidiendo `manager` el rango no dice nada y solo queda `requireRole`, que
   * es lo que aqui se quiere fijar.
   */
  it('un gerente NO puede repartir roles, ni siquiera de su propio rango', async () => {
    expect(
      await codigoDelFallo(
        llamar({ organizationId: ORG, userId: EMPLEADO, role: 'manager' }, GERENTE),
      ),
    ).toBe('permission-denied');
    expect(await rolDe(EMPLEADO)).toBe('employee');
  });

  it('un empleado tampoco, ni para ascenderse a sí mismo', async () => {
    expect(
      await codigoDelFallo(
        llamar({ organizationId: ORG, userId: EMPLEADO, role: 'owner' }, EMPLEADO),
      ),
    ).toBe('permission-denied');
    expect(await rolDe(EMPLEADO)).toBe('employee');
  });

  /**
   * NI SIQUIERA UN ADMIN SE TOCA A SI MISMO, y la razon es que el mismo camino que
   * permite subirse permite bajarse por error y quedarse fuera de su propia empresa.
   */
  it('nadie se cambia el rol a sí mismo', async () => {
    expect(
      await codigoDelFallo(llamar({ organizationId: ORG, userId: ADMIN, role: 'owner' }, ADMIN)),
    ).toBe('failed-precondition');
    expect(await rolDe(ADMIN)).toBe('admin');
  });

  it('un admin no puede crear un dueño: no se da un rol por encima del propio', async () => {
    expect(
      await codigoDelFallo(llamar({ organizationId: ORG, userId: GERENTE, role: 'owner' }, ADMIN)),
    ).toBe('permission-denied');
    expect(await rolDe(GERENTE)).toBe('manager');
  });

  it('un admin no puede degradar a un dueño', async () => {
    expect(
      await codigoDelFallo(llamar({ organizationId: ORG, userId: DUENO, role: 'employee' }, ADMIN)),
    ).toBe('permission-denied');
    expect(await rolDe(DUENO)).toBe('owner');
  });

  /**
   * LA EMPRESA NUNCA SE QUEDA SIN LLAVES, y lo que lo garantiza NO es lo que parece.
   *
   * `setMemberRole` tiene una guarda explicita —«es la unica persona que administra
   * esta organizacion»— y resulta que no se alcanza nunca: para llegar hasta ella hay
   * que ser owner o admin (o sea, estar dentro de `quienesMandan`) y ademas no ser el
   * objetivo, asi que en ese punto `mandan` tiene dos entradas como minimo y la
   * condicion `<= 1` no puede cumplirse. Se comprobo desactivandola: las doce pruebas
   * siguieron en verde.
   *
   * Lo que de verdad sostiene el invariante es esta otra regla: el ultimo que manda no
   * puede tocarse a si mismo. Por eso la prueba fija ESTO, que es lo que pasa de
   * verdad, y no la guarda que nunca corre. Una prueba que afirma lo segundo da una
   * sensacion de seguridad que el codigo no respalda.
   */
  it('la última persona que administra no puede degradarse a sí misma', async () => {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${DUENO}`).delete();

    expect(
      await codigoDelFallo(llamar({ organizationId: ORG, userId: ADMIN, role: 'manager' }, ADMIN)),
    ).toBe('failed-precondition');
    expect(await rolDe(ADMIN)).toBe('admin');

    // Y con dos al mando, degradar al otro sí se puede: la empresa conserva una llave.
    await ponerMiembro(DUENO, 'owner');
    await llamar({ organizationId: ORG, userId: ADMIN, role: 'manager' }, DUENO);
    expect(await rolDe(ADMIN)).toBe('manager');
  });

  it('quien ya no está activo no manda, aunque su fila siga ahí', async () => {
    await ponerMiembro(ADMIN, 'admin', 'suspended');
    expect(
      await codigoDelFallo(
        llamar({ organizationId: ORG, userId: EMPLEADO, role: 'manager' }, ADMIN),
      ),
    ).toBe('permission-denied');
    expect(await rolDe(EMPLEADO)).toBe('employee');
  });

  it('alguien de otra organización no toca esta', async () => {
    expect(
      await codigoDelFallo(
        llamar({ organizationId: ORG, userId: EMPLEADO, role: 'admin' }, 'uid-ajeno'),
      ),
    ).toBe('permission-denied');
    expect(await rolDe(EMPLEADO)).toBe('employee');
  });

  /**
   * ASCENDER A ADMIN DA TODAS LAS SEDES, y degradar las quita. Si no se hiciera, un
   * admin recien nombrado no podria tocar nada hasta que alguien le asignara sedes a
   * mano, y un gerente degradado conservaria las suyas.
   */
  it('al ascender a admin se le dan todas las sedes, y al degradar se le quitan', async () => {
    await llamar({ organizationId: ORG, userId: EMPLEADO, role: 'admin' }, DUENO);
    const comoAdmin = (
      await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${EMPLEADO}`).get()
    ).data();
    expect(comoAdmin?.managed_location_ids).toEqual(['sede-1']);

    await llamar({ organizationId: ORG, userId: EMPLEADO, role: 'employee' }, DUENO);
    const comoEmpleado = (
      await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${EMPLEADO}`).get()
    ).data();
    expect(comoEmpleado?.managed_location_ids).toEqual([]);
  });

  /** Un cambio de poder sin rastro no se puede auditar, que es justo para lo que sirve. */
  it('deja constancia en audit_logs de quién cambió qué', async () => {
    await llamar({ organizationId: ORG, userId: EMPLEADO, role: 'manager' }, ADMIN);

    const registros = await db
      .collection(COLLECTIONS.auditLogs)
      .where('action', '==', 'member_role_changed')
      .get();

    expect(registros.size).toBe(1);
    const fila = registros.docs[0]?.data();
    expect(fila?.actor_user_id).toBe(ADMIN);
    expect(fila?.entity_id).toBe(`${ORG}_${EMPLEADO}`);
    expect(fila?.before_data).toEqual({ role: 'employee' });
    expect(fila?.after_data).toEqual({ role: 'manager' });
  });
});
