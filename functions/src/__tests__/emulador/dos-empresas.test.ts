import { createOrganization } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { viewTimeAdjustmentsWithAuthor } from '../../views';

/**
 * Pertenecer a DOS empresas, que es lo que nunca se probo.
 *
 * Hasta el 2026-09-23 el servidor resolvia «¿de que organizacion me hablas?» con
 * `soleMembership`: leia tus membresias activas y se quedaba con la mas vieja. Con una
 * organizacion es correcto. Con dos CONTESTA SOBRE LA EQUIVOCADA, y ninguna prueba del
 * proyecto lo habria notado porque en todas hay exactamente un usuario en exactamente
 * una organizacion. Por eso este archivo empieza por ahi: un usuario en DOS.
 *
 * Las dos mitades que cubre:
 *
 *  1. `createOrganization` — antes no habia nada que creara una empresa. La regla de
 *     Firestore es `allow create: if false` sobre `organizations` y en el servidor no
 *     existia ninguna funcion: la empresa de hoy se escribio a mano en la consola.
 *  2. `viewTimeAdjustmentsWithAuthor` — el unico uso de `soleMembership` que filtraba
 *     datos por organizacion. El caso que importa no es que falle: es que devuelve
 *     `[]` sin error, o sea «esta correccion no existe», mirando la empresa buena.
 */

const PROYECTO = 'demo-krealo-shift';

const correr = (fn: unknown, data: unknown, uid?: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === undefined ? undefined : { uid, token: {} },
    rawRequest: {},
  });

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

const membresia = (orgId: string, uid: string, role: string, status = 'active') =>
  db.collection(COLLECTIONS.memberships).doc(`${orgId}_${uid}`).set({
    user_id: uid,
    organization_id: orgId,
    role,
    status,
    managed_location_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
  });

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
});

describe('createOrganization', () => {
  const DATOS = {
    p_name: 'Univers Toutou',
    p_timezone: 'America/Toronto',
    p_first_location_name: 'Montreal Centre',
    p_locale: 'fr-CA',
    p_week_starts_on: 0,
  };

  it('crea empresa, sede y membresia de dueño en una sola pasada', async () => {
    await membresia('org-pe', 'andree', 'owner');

    const r = (await correr(createOrganization, DATOS, 'andree')) as {
      organizationId: string;
      locationId: string;
    };

    const empresa = (
      await db.collection(COLLECTIONS.organizations).doc(r.organizationId).get()
    ).data();
    expect(empresa).toMatchObject({
      name: 'Univers Toutou',
      default_locale: 'fr-CA',
      default_timezone: 'America/Toronto',
      week_starts_on: 0,
      created_by: 'andree',
    });

    const sede = (await db.collection(COLLECTIONS.locations).doc(r.locationId).get()).data();
    expect(sede).toMatchObject({
      organization_id: r.organizationId,
      name: 'Montreal Centre',
      timezone: 'America/Toronto',
      is_active: true,
    });

    /*
     * EL ID DE LA MEMBRESIA ES `{orgId}_{uid}` Y ESO NO ES DECORATIVO: las reglas de
     * Firestore comprueban la pertenencia leyendo ESE documento por id, en vez de con
     * una consulta. Una membresia correcta con otro id dejaria al dueño fuera de su
     * propia empresa, y el sintoma seria «no tengo permiso» sin nada roto a la vista.
     */
    const suya = (
      await db.collection(COLLECTIONS.memberships).doc(`${r.organizationId}_andree`).get()
    ).data();
    expect(suya).toMatchObject({ role: 'owner', status: 'active', user_id: 'andree' });
  });

  it('deja a la persona con DOS membresias activas, que es el punto', async () => {
    await membresia('org-pe', 'andree', 'owner');
    await correr(createOrganization, DATOS, 'andree');

    const suyas = await db
      .collection(COLLECTIONS.memberships)
      .where('user_id', '==', 'andree')
      .where('status', '==', 'active')
      .get();

    expect(suyas.size).toBe(2);
  });

  it('solo puede llamarla quien ya es owner de una empresa activa', async () => {
    // Gerente de la suya: no basta. Crear empresas no es una atribucion de gerente.
    await membresia('org-pe', 'gerente', 'manager');
    expect(await codigoDelFallo(correr(createOrganization, DATOS, 'gerente'))).toBe(
      'permission-denied',
    );

    // Dueño, pero de una empresa que ya no esta activa.
    await membresia('org-vieja', 'exdueño', 'owner', 'revoked');
    expect(await codigoDelFallo(correr(createOrganization, DATOS, 'exdueño'))).toBe(
      'permission-denied',
    );

    // Sin sesion.
    expect(await codigoDelFallo(correr(createOrganization, DATOS))).toBe('unauthenticated');

    // Y no escribio nada por el camino.
    expect((await db.collection(COLLECTIONS.organizations).get()).size).toBe(0);
  });

  it('rechaza una zona horaria que Intl no acepta, y canoniza la que si', async () => {
    await membresia('org-pe', 'andree', 'owner');

    expect(
      await codigoDelFallo(correr(createOrganization, { ...DATOS, p_timezone: 'Lima' }, 'andree')),
    ).toBe('invalid-argument');
    expect(
      await codigoDelFallo(correr(createOrganization, { ...DATOS, p_timezone: 'GMT-5' }, 'andree')),
    ).toBe('invalid-argument');
    expect((await db.collection(COLLECTIONS.organizations).get()).size).toBe(0);

    /*
     * `America/Montreal` SI EXISTE —es un alias IANA que resuelve a `America/Toronto`— y
     * esta prueba esta aqui porque yo afirme lo contrario y me desmintio. Se guarda
     * resuelta, no como la escribio quien la mando, para que dos sedes con la misma zona
     * escrita distinto agrupen las jornadas por el mismo dia.
     */
    const r = (await correr(
      createOrganization,
      { ...DATOS, p_timezone: 'America/Montreal' },
      'andree',
    )) as { organizationId: string };
    const empresa = (
      await db.collection(COLLECTIONS.organizations).doc(r.organizationId).get()
    ).data();
    expect(empresa?.default_timezone).toBe('America/Toronto');
  });

  it('exige nombre, sede y un inicio de semana de 0 a 6', async () => {
    await membresia('org-pe', 'andree', 'owner');

    for (const malo of [
      { ...DATOS, p_name: '   ' },
      { ...DATOS, p_first_location_name: '' },
      { ...DATOS, p_week_starts_on: 7 },
      { ...DATOS, p_week_starts_on: 1.5 },
    ]) {
      expect(await codigoDelFallo(correr(createOrganization, malo, 'andree'))).toBe(
        'invalid-argument',
      );
    }
    expect((await db.collection(COLLECTIONS.organizations).get()).size).toBe(0);
  });
});

describe('viewTimeAdjustmentsWithAuthor con un usuario en dos empresas', () => {
  const PE = 'org-pe';
  const CA = 'org-ca';

  /**
   * El escenario minimo que rompia: Andree es dueño de las DOS, la correccion esta en la
   * de Canada, y Peru es la membresia mas vieja —la que `soleMembership` devolvia—.
   */
  beforeEach(async () => {
    await membresia(PE, 'andree', 'owner');
    await db.collection(COLLECTIONS.memberships).doc(`${CA}_andree`).set({
      user_id: 'andree',
      organization_id: CA,
      role: 'owner',
      status: 'active',
      managed_location_ids: [],
      created_at: '2026-09-23T00:00:00.000Z',
    });

    await db
      .collection(COLLECTIONS.workSessions)
      .doc('ses-ca')
      .set({ id: 'ses-ca', organization_id: CA, employee_id: 'emp-ca' });

    await db.collection(COLLECTIONS.timeAdjustments).doc('aj-ca').set({
      organization_id: CA,
      work_session_id: 'ses-ca',
      created_by: 'andree',
      reason: 'olvido marcar salida',
    });

    await db.collection(COLLECTIONS.profiles).doc('andree').set({ full_name: 'Andree' });
  });

  const pedir = (ids: string[], uid: string | null = 'andree') =>
    correr(
      viewTimeAdjustmentsWithAuthor,
      { filters: [{ field: 'work_session_id', op: 'in', value: ids }] },
      uid ?? undefined,
    );

  it('devuelve la correccion de la empresa de la SESION, no la de la membresia mas vieja', async () => {
    const filas = (await pedir(['ses-ca'])) as Record<string, unknown>[];

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      organization_id: CA,
      work_session_id: 'ses-ca',
      author_name: 'Andree',
    });
  });

  it('sigue atando el filtro a UNA organizacion: no mezcla las dos', async () => {
    await db
      .collection(COLLECTIONS.workSessions)
      .doc('ses-pe')
      .set({ id: 'ses-pe', organization_id: PE, employee_id: 'emp-pe' });
    await db.collection(COLLECTIONS.timeAdjustments).doc('aj-pe').set({
      organization_id: PE,
      work_session_id: 'ses-pe',
      created_by: 'andree',
      reason: 'de Peru',
    });

    /*
     * Se piden las dos sesiones a la vez. La organizacion sale de la PRIMERA, asi que
     * vuelve una sola fila: la de esa empresa. Es una limitacion consciente —una hoja de
     * horas es siempre de una sede, o sea de una empresa— y se prueba para que quede
     * escrita: si algun dia una pantalla mezcla sesiones de dos empresas, esto lo dice.
     */
    const filas = (await pedir(['ses-ca', 'ses-pe'])) as Record<string, unknown>[];
    expect(filas.map((f) => f.work_session_id)).toEqual(['ses-ca']);
  });

  it('a quien no pertenece a la empresa de la sesion le niega el permiso', async () => {
    await membresia('org-ajena', 'extraño', 'owner');
    expect(await codigoDelFallo(pedir(['ses-ca'], 'extraño'))).toBe('permission-denied');
  });

  it('contesta vacio —sin reventar— si la sesion pedida no existe', async () => {
    expect(await pedir(['no-existe'])).toEqual([]);
  });
});
