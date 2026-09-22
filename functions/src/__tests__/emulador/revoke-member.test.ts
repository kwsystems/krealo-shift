import { revokeMember } from '../../members';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * `revokeMember`: quitarle el acceso al panel a alguien.
 *
 * POR QUE AHORA. Tenia una guarda que decia proteger el invariante mas importante de la
 * organizacion —que nunca se quede sin nadie que la administre— y que NO SE EJECUTABA
 * NUNCA: para llegar hasta ella hay que estar uno mismo entre los que mandan y no ser el
 * objetivo, asi que siempre habia dos o mas. Se borro el 22-sep-2026 por decision de
 * Joseph, y esta prueba es la contrapartida: fija lo que de verdad sostiene el
 * invariante, que es el «no te quitas el acceso a ti mismo».
 *
 * La diferencia importa. Una prueba sobre la guarda inalcanzable habria pasado siempre,
 * pasara lo que pasara con el codigo. Esta falla si alguien quita la regla que si
 * funciona, que es exactamente el riesgo que dejaba la guarda muerta: invitar a
 * quitar el control bueno creyendo que el otro lo cubria.
 *
 * Y lo otro que se prueba aqui es lo que distingue «quitar el acceso» de «marcarlo en
 * una fila»: que se revoquen las sesiones. Sin eso, quien acaba de perder el acceso
 * sigue dentro hasta que caduque su token —hasta una hora— y en ese rato puede leer
 * horas y aprobar periodos.
 */

const ORG = 'org-revocar';
const PROYECTO = 'demo-krealo-shift';

const DUENO = 'uid-dueno-rev';
const ADMIN = 'uid-admin-rev';
const GERENTE = 'uid-gerente-rev';
const EMPLEADO = 'uid-empleado-rev';

const revocadas: string[] = [];

/*
 * `revokeRefreshTokens` habla con Firebase Auth, y el emulador de Auth no esta levantado
 * en este arnes —solo Firestore y Storage—. Se simula para poder COMPROBAR que se llama,
 * que es lo que importa: la funcion ya captura su error, asi que sin el doble la prueba
 * pasaria igual sin haberse llamado nunca.
 */
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

const llamar = (data: unknown, uid: string | null): Promise<unknown> =>
  (revokeMember as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === null ? undefined : { uid, token: {} },
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

const estadoDe = async (uid: string): Promise<unknown> =>
  (await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).get()).data()?.status;

/** Cuantos pueden administrar la organizacion AHORA MISMO. Es el invariante. */
async function alMando(): Promise<number> {
  const filas = await db
    .collection(COLLECTIONS.memberships)
    .where('organization_id', '==', ORG)
    .where('status', '==', 'active')
    .get();
  return filas.docs.filter((d) => ['owner', 'admin'].includes(String(d.data().role))).length;
}

async function ponerMiembro(uid: string, rol: string): Promise<void> {
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${uid}`)
    .set({
      id: `${ORG}_${uid}`,
      organization_id: ORG,
      user_id: uid,
      role: rol,
      status: 'active',
      managed_location_ids: rol === 'manager' ? ['sede-1'] : [],
    });
}

beforeEach(async () => {
  revocadas.length = 0;
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await ponerMiembro(DUENO, 'owner');
  await ponerMiembro(ADMIN, 'admin');
  await ponerMiembro(GERENTE, 'manager');
  await ponerMiembro(EMPLEADO, 'employee');
});

describe('revokeMember', () => {
  it('un admin le quita el acceso a un gerente, y le tira la sesión', async () => {
    await llamar({ organizationId: ORG, userId: GERENTE }, ADMIN);

    expect(await estadoDe(GERENTE)).toBe('suspended');
    // Quitar el acceso tiene que quitar el acceso, no marcarlo para dentro de una hora.
    expect(revocadas).toContain(GERENTE);
  });

  /**
   * EL INVARIANTE, y la razon de ser de esta prueba: la organizacion nunca puede
   * quedarse sin nadie que la administre.
   */
  it('el último que administra no puede quitarse el acceso a sí mismo', async () => {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${ADMIN}`).delete();
    expect(await alMando()).toBe(1);

    expect(await codigoDelFallo(llamar({ organizationId: ORG, userId: DUENO }, DUENO))).toBe(
      'failed-precondition',
    );

    // Lo que importa no es el codigo del error: es que la empresa conserva su llave.
    expect(await alMando()).toBe(1);
    expect(await estadoDe(DUENO)).toBe('active');
    expect(revocadas).toHaveLength(0);
  });

  it('con dos al mando, quitarle el acceso a uno sí se puede: queda el otro', async () => {
    expect(await alMando()).toBe(2);
    await llamar({ organizationId: ORG, userId: ADMIN }, DUENO);
    expect(await alMando()).toBe(1);
  });

  it('nadie por debajo reparte accesos: ni el gerente ni el empleado', async () => {
    for (const quien of [GERENTE, EMPLEADO]) {
      expect(await codigoDelFallo(llamar({ organizationId: ORG, userId: EMPLEADO }, quien))).toBe(
        'permission-denied',
      );
    }
    expect(await estadoDe(EMPLEADO)).toBe('active');
  });

  it('un admin no puede quitarle el acceso a un dueño: nadie toca por encima', async () => {
    expect(await codigoDelFallo(llamar({ organizationId: ORG, userId: DUENO }, ADMIN))).toBe(
      'permission-denied',
    );
    expect(await estadoDe(DUENO)).toBe('active');
  });

  it('sin sesión no se quita el acceso a nadie', async () => {
    expect(await codigoDelFallo(llamar({ organizationId: ORG, userId: GERENTE }, null))).not.toBe(
      '(no fallo)',
    );
    expect(await estadoDe(GERENTE)).toBe('active');
  });

  it('alguien de otra organización no toca esta', async () => {
    expect(
      await codigoDelFallo(llamar({ organizationId: 'otra-empresa', userId: GERENTE }, ADMIN)),
    ).toBe('permission-denied');
    expect(await estadoDe(GERENTE)).toBe('active');
  });

  it('a quien no tiene acceso no se le puede quitar', async () => {
    expect(await codigoDelFallo(llamar({ organizationId: ORG, userId: 'nadie' }, ADMIN))).toBe(
      'not-found',
    );
  });
});
