import { claimInvitation } from '../../invitations';
import { COLLECTIONS, auth, db } from '../../shared/admin';

/**
 * Canjear una invitación entrando por el ENLACE AL CORREO, sin Google.
 *
 * Encender el acceso por enlace enciende también «correo y contraseña» en la API, aunque
 * la app no lo ofrezca. Lo que se prueba es que eso no abre ninguna puerta:
 *
 *   - una sesión de contraseña no canjea nada;
 *   - una de enlace canjea como una de Google;
 *   - y el secuestro previo —alguien crea la cuenta con contraseña ANTES de que la persona
 *     invitada entre— se cierra: al canjear por enlace, esa contraseña deja de servir.
 *
 * Necesita los emuladores de Firestore y de Auth. El porqué de cada regla está en
 * `acceso-por-correo.ts`.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-correo';
const CORREO = 'invitada@example.com';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const llamar = (uid: string, token: Record<string, unknown>): Promise<unknown> =>
  (claimInvitation as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data: {},
    auth: { uid, token },
    rawRequest: {},
  });

const token = (proveedor: string, extra: Record<string, unknown> = {}) => ({
  email: CORREO,
  email_verified: true,
  firebase: { sign_in_provider: proveedor },
  ...extra,
});

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no falló)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

/** Entrar con contraseña contra el emulador, como lo haría quien la creó. */
async function entraConContrasena(correo: string, contrasena: string): Promise<boolean> {
  const res = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=clave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: contrasena, returnSecureToken: true }),
    },
  );
  return res.ok;
}

const membresia = async (uid: string) =>
  (await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).get()).data();

beforeEach(async () => {
  const firestore = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const vaciar = [
    fetch(firestore, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } }),
    fetch(`${AUTH}/emulator/v1/projects/${PROYECTO}/accounts`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer owner' },
    }),
  ];
  for (const res of await Promise.all(vaciar)) {
    if (!res.ok) throw new Error(`no se pudo vaciar un emulador: ${res.status}`);
  }

  await db.collection(COLLECTIONS.locations).doc('sede-1').set({
    id: 'sede-1',
    organization_id: ORG,
    name: 'Sede 1',
  });
  await db
    .collection(COLLECTIONS.invitations)
    .doc(`${ORG}_${CORREO}`)
    .set({
      id: `${ORG}_${CORREO}`,
      organization_id: ORG,
      email: CORREO,
      role: 'admin',
      status: 'pending',
      invited_by: 'uid-dueno',
      created_at: '2026-09-29T00:00:00.000Z',
    });
});

describe('canjear una invitación entrando por el enlace al correo', () => {
  it('por enlace se canjea igual que por Google', async () => {
    const usuario = await auth.createUser({ email: CORREO, emailVerified: true });
    const r = await llamar(usuario.uid, token('emailLink'));
    expect(r).toMatchObject({ claimed: true, organizationId: ORG, role: 'admin' });
    expect(await membresia(usuario.uid)).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('con Google, como siempre', async () => {
    const r = await llamar('uid-google', token('google.com'));
    expect(r).toMatchObject({ claimed: true });
  });

  it('una sesión abierta con contraseña NO canjea, y la invitación sigue esperando', async () => {
    expect(await codigoDelFallo(llamar('uid-contrasena', token('password')))).toBe(
      'failed-precondition',
    );
    expect(await membresia('uid-contrasena')).toBeUndefined();
    const invitacion = await db.collection(COLLECTIONS.invitations).doc(`${ORG}_${CORREO}`).get();
    expect(invitacion.data()?.status).toBe('pending');
  });

  it('sin correo verificado no canjea, entre como entre', async () => {
    const r = llamar('uid-sin-verificar', token('emailLink', { email_verified: false }));
    expect(await codigoDelFallo(r)).toBe('failed-precondition');
  });

  it('el secuestro previo se cierra: la contraseña de quien creó la cuenta deja de servir', async () => {
    // Alguien se da de alta con el correo de la invitada ANTES de que ella entre.
    const secuestrada = await auth.createUser({ email: CORREO, password: 'la-del-intruso' });
    expect(await entraConContrasena(CORREO, 'la-del-intruso')).toBe(true);

    // Ella entra por el enlace: Firebase la mete en esa misma cuenta, y canjea.
    const antes = (await auth.getUser(secuestrada.uid)).tokensValidAfterTime;
    await new Promise((listo) => setTimeout(listo, 1100));
    const r = await llamar(secuestrada.uid, token('emailLink'));
    expect(r).toMatchObject({ claimed: true });

    // La contraseña del intruso ya no entra, y sus sesiones abiertas quedan cerradas.
    expect(await entraConContrasena(CORREO, 'la-del-intruso')).toBe(false);
    const despues = (await auth.getUser(secuestrada.uid)).tokensValidAfterTime;
    expect(Date.parse(despues ?? '')).toBeGreaterThan(Date.parse(antes ?? ''));
  });

  it('a una cuenta de enlace sin contraseña no se le toca nada', async () => {
    const usuario = await auth.createUser({ email: CORREO, emailVerified: true });
    const antes = (await auth.getUser(usuario.uid)).tokensValidAfterTime;
    await llamar(usuario.uid, token('emailLink'));
    const despues = await auth.getUser(usuario.uid);
    expect(despues.passwordHash ?? '').toBe('');
    expect(despues.tokensValidAfterTime).toBe(antes);
  });
});
