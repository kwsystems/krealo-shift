import { claimInvitation } from '../../invitations';
import { COLLECTIONS, auth, db } from '../../shared/admin';
import { altaConContrasena, sesionPorEnlace } from './sesiones-de-auth';

/**
 * Canjear una invitación entrando por el ENLACE AL CORREO, sin Google.
 *
 * Encender el acceso por enlace enciende también «correo y contraseña» en la API, aunque
 * la app no lo ofrezca. Lo que se prueba es que eso no abre ninguna puerta:
 *
 *   - una alta con contraseña no canjea nada —no tiene el correo verificado—;
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

/** Solo para Google, que el emulador no puede dar: el resto de sesiones son DE VERDAD. */
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
  it('el token del enlace dice «password» y viene verificado: es lo que hay que aceptar', async () => {
    const { token: delEnlace } = await sesionPorEnlace(CORREO);
    expect(delEnlace).toMatchObject({
      email: CORREO,
      email_verified: true,
      firebase: expect.objectContaining({ sign_in_provider: 'password' }),
    });
  });

  it('por enlace se canjea igual que por Google', async () => {
    const { uid, token: delEnlace } = await sesionPorEnlace(CORREO);
    const r = await llamar(uid, delEnlace);
    expect(r).toMatchObject({ claimed: true, organizationId: ORG, role: 'admin' });
    expect(await membresia(uid)).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('con Google, como siempre', async () => {
    const r = await llamar('uid-google', token('google.com'));
    expect(r).toMatchObject({ claimed: true });
  });

  it('una alta con contraseña NO canjea, y la invitación sigue esperando', async () => {
    const { uid, token: deContrasena } = await altaConContrasena(CORREO, 'la-del-intruso');
    expect(deContrasena.email_verified).toBe(false);
    expect(await codigoDelFallo(llamar(uid, deContrasena))).toBe('failed-precondition');
    expect(await membresia(uid)).toBeUndefined();
    const invitacion = await db.collection(COLLECTIONS.invitations).doc(`${ORG}_${CORREO}`).get();
    expect(invitacion.data()?.status).toBe('pending');
  });

  it('el secuestro previo se cierra: la contraseña de quien creó la cuenta deja de servir', async () => {
    // Alguien se da de alta con el correo de la invitada ANTES de que ella entre.
    const intruso = await altaConContrasena(CORREO, 'la-del-intruso');
    expect(await entraConContrasena(CORREO, 'la-del-intruso')).toBe(true);

    // Ella abre su enlace: Firebase la mete en esa misma cuenta —un correo, una cuenta—.
    const antes = (await auth.getUser(intruso.uid)).tokensValidAfterTime;
    await new Promise((listo) => setTimeout(listo, 1100));
    const ella = await sesionPorEnlace(CORREO);
    expect(ella.uid).toBe(intruso.uid);
    const r = await llamar(ella.uid, ella.token);
    expect(r).toMatchObject({ claimed: true });

    // La contraseña del intruso ya no entra, y sus sesiones abiertas quedan cerradas.
    expect(await entraConContrasena(CORREO, 'la-del-intruso')).toBe(false);
    const despues = (await auth.getUser(intruso.uid)).tokensValidAfterTime;
    expect(Date.parse(despues ?? '')).toBeGreaterThan(Date.parse(antes ?? ''));
  });

  it('a una cuenta de enlace sin contraseña no se le toca nada', async () => {
    const { uid, token: delEnlace } = await sesionPorEnlace(CORREO);
    const antes = (await auth.getUser(uid)).tokensValidAfterTime;
    await llamar(uid, delEnlace);
    const despues = await auth.getUser(uid);
    expect(despues.passwordHash ?? '').toBe('');
    expect(despues.tokensValidAfterTime).toBe(antes);
  });
});
