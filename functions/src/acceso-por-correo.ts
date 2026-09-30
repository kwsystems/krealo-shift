import { randomBytes } from 'node:crypto';

import type { Auth } from 'firebase-admin/auth';

/**
 * ENTRAR CON UN ENLACE AL CORREO, y lo que el servidor tiene que cuidar por ello.
 *
 * Desde el 29-sep se puede entrar sin Google: se escribe el correo, llega un enlace y al
 * abrirlo se entra. Lo pidió Andree porque una administradora tiene el correo en Microsoft
 * y no usa Google. El enlace demuestra que el correo es de quien lo abre, que es lo mismo
 * que demuestra Google, así que la invitación se canjea igual.
 *
 * PERO PARA OFRECER EL ENLACE, FIREBASE ENCIENDE TAMBIÉN «CORREO Y CONTRASEÑA». No se
 * pueden separar, y la app no ofrece contraseña en ningún sitio, pero la API sí la acepta:
 * cualquiera con la clave pública del proyecto puede darse de alta con un correo que no es
 * suyo y una contraseña. Eso abre dos caminos que hay que cerrar:
 *
 *   1. CANJEAR UNA INVITACIÓN CON ESA CUENTA. Lo cierra `email_verified`, que
 *      `claimInvitation` exige: una alta con contraseña lo tiene en false y abrir el enlace
 *      lo pone en true. NO se puede cerrar mirando el proveedor: el token del enlace dice
 *      `sign_in_provider: 'password'`, igual que el de una contraseña (medido contra el
 *      emulador de Auth el 30-sep). Rechazar `password` dejó fuera a quien entraba por
 *      enlace, que era justo para quien se hizo esto.
 *   2. EL SECUESTRO PREVIO. Alguien se da de alta con contraseña y con el correo de la
 *      persona invitada ANTES de que ella entre. Cuando ella entra por el enlace, Firebase
 *      la mete en ESA cuenta —un correo, una cuenta—, ella canjea la invitación, y quien
 *      creó la cuenta sigue teniendo su contraseña: entraría al panel como ella.
 *      `cerrarContrasenaAjena` lo cierra: la primera vez que se canjea por enlace, si la
 *      cuenta tiene contraseña, se sustituye por una al azar que nadie conoce y se cierran
 *      todas sus sesiones.
 *
 * En el caso normal —nadie creó nada antes— la cuenta de enlace no tiene contraseña y no
 * se toca. En el caso del secuestro, la persona legítima tendrá que volver a pedir un
 * enlace, porque también se cierra su sesión. Es el precio de echar a quien no debía estar.
 */

export type AuthParaCerrar = Pick<Auth, 'getUser' | 'updateUser' | 'revokeRefreshTokens'>;

/** Devuelve `true` si había una contraseña y se anuló. */
export async function cerrarContrasenaAjena(uid: string, auth: AuthParaCerrar): Promise<boolean> {
  const usuario = await auth.getUser(uid);
  // Una cuenta que solo entra por enlace no tiene contraseña: no hay nada que cerrar.
  if (usuario.passwordHash === undefined || usuario.passwordHash === '') return false;
  await auth.updateUser(uid, { password: randomBytes(32).toString('base64url') });
  await auth.revokeRefreshTokens(uid);
  return true;
}

/**
 * Cómo se abrió la sesión de quien llama: `google.com`, o `password` para la familia del
 * correo —con contraseña y TAMBIÉN por enlace, que Firebase no distingue en el token—.
 */
export function proveedorDeLaSesion(token: unknown): string | null {
  const firebase = (token as { firebase?: { sign_in_provider?: unknown } } | undefined)?.firebase;
  return typeof firebase?.sign_in_provider === 'string' ? firebase.sign_in_provider : null;
}
