/*
 * LAS SESIONES DE CORREO SE PIDEN AL EMULADOR DE AUTH, NO SE ESCRIBEN A MANO (30-sep).
 * Estas pruebas usaban un token con `sign_in_provider: 'emailLink'` inventado. Firebase no
 * lo manda nunca —el del enlace dice 'password'—, así que pasaban mientras en producción
 * la administradora invitada no podía canjear su invitación. Un token escrito a mano
 * prueba lo que uno cree que manda Firebase; este prueba lo que manda.
 */
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const API = `${AUTH}/identitytoolkit.googleapis.com/v1`;
const PROYECTO = 'demo-krealo-shift';

function cargaDelToken(idToken: string): Record<string, unknown> {
  const parte = idToken.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(parte, 'base64url').toString()) as Record<string, unknown>;
}

/** Pedir el enlace y abrirlo, como hace la invitada con su correo de Microsoft. */
export async function sesionPorEnlace(
  correo: string,
): Promise<{ uid: string; token: Record<string, unknown> }> {
  const pedido = await fetch(`${API}/accounts:sendOobCode?key=clave-falsa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      requestType: 'EMAIL_SIGNIN',
      email: correo,
      continueUrl: 'http://localhost/sign-in',
      canHandleCodeInApp: true,
      returnOobLink: true,
      targetProjectId: PROYECTO,
    }),
  });
  const { oobLink } = (await pedido.json()) as { oobLink: string };
  const oobCode = new URL(oobLink).searchParams.get('oobCode');
  const abierto = await fetch(`${API}/accounts:signInWithEmailLink?key=clave-falsa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, oobCode }),
  });
  const { localId, idToken } = (await abierto.json()) as { localId: string; idToken: string };
  return { uid: localId, token: cargaDelToken(idToken) };
}

/** Darse de alta con contraseña por la API, que la app no ofrece pero Firebase acepta. */
export async function altaConContrasena(
  correo: string,
  contrasena: string,
): Promise<{ uid: string; token: Record<string, unknown> }> {
  const alta = await fetch(`${API}/accounts:signUp?key=clave-falsa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: contrasena, returnSecureToken: true }),
  });
  const { localId, idToken } = (await alta.json()) as { localId: string; idToken: string };
  return { uid: localId, token: cargaDelToken(idToken) };
}
