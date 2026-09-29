import { Platform } from 'react-native';
import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink } from 'firebase/auth';

import { getFirebaseAuth } from './client';

/**
 * ENTRAR CON UN ENLACE AL CORREO, sin Google y sin contraseña.
 *
 * Lo pidió Andree el 29-sep: una administradora tiene el correo en Microsoft y no usa
 * Google. Se escribe el correo, Firebase manda un enlace, y al abrirlo se entra. Quien lo
 * abre demuestra que el correo es suyo —igual que con Google—, así que la invitación de
 * Ajustes se canjea igual. Lo que el servidor cuida por esto está en
 * `functions/src/acceso-por-correo.ts`.
 *
 * POR QUÉ UN ENLACE Y NO UN CÓDIGO DE SEIS DÍGITOS. El código necesitaría un servicio de
 * correo propio, con su cuenta y su clave; el enlace lo manda Firebase, que ya está
 * pagado y configurado. Para quien entra es lo mismo: mirar el correo y tocar.
 *
 * SOLO EN WEB. En el iPad el enlace abriría el navegador, no la app, y montar el salto de
 * vuelta es otra obra. El panel se usa en el navegador; el iPad es el reloj.
 */

/**
 * EL CORREO SE RECUERDA EN ESTE NAVEGADOR mientras llega el enlace. Al abrirlo, Firebase
 * pide el correo otra vez —el enlace solo no basta, a propósito: si alguien reenvía el
 * correo, quien lo abra en otro sitio tiene que saber para qué dirección era—. Si el
 * enlace se abre en el mismo navegador, se usa este y la persona no escribe nada.
 */
const CLAVE = 'krealo-shift.correo-del-enlace';

export const accesoPorCorreoDisponible = Platform.OS === 'web';

function almacen(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function correoRecordado(): string | null {
  try {
    return almacen()?.getItem(CLAVE) ?? null;
  } catch {
    return null;
  }
}

/** La dirección de esta pantalla, que es a donde vuelve el enlace. */
function direccionDeVuelta(): string {
  return `${window.location.origin}/sign-in`;
}

/** Manda el enlace. `idioma` decide el idioma del correo. */
export async function enviarEnlace(correo: string, idioma: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth === null) throw new Error('Falta la configuración de Firebase.');
  auth.languageCode = idioma.startsWith('en') ? 'en' : 'es';
  const limpio = correo.trim().toLowerCase();
  await sendSignInLinkToEmail(auth, limpio, { url: direccionDeVuelta(), handleCodeInApp: true });
  try {
    almacen()?.setItem(CLAVE, limpio);
  } catch {
    // Sin almacenamiento, al abrir el enlace se pedirá el correo otra vez. Nada más.
  }
}

/** La dirección de la pestaña, o `null` donde no hay pestaña (el iPad, las pruebas). */
export function direccionActual(): string | null {
  return typeof window !== 'undefined' && window.location !== undefined
    ? window.location.href
    : null;
}

/** ¿Esta dirección es la de un enlace de acceso? */
export function esEnlaceDeAcceso(href: string): boolean {
  const auth = getFirebaseAuth();
  return auth !== null && isSignInWithEmailLink(auth, href);
}

/**
 * Entra con el enlace. Después limpia la barra de direcciones: el enlace sirve UNA vez, y
 * recargar la página con él puesto daría «enlace ya usado» a quien acaba de entrar bien.
 *
 * UNA SOLA LLAMADA POR ENLACE aunque se pida dos veces —la pantalla que se monta dos
 * veces, un doble toque—: la segunda gastaría un código ya gastado y pintaría «enlace ya
 * usado» encima de una entrada que salió bien. Si falla, se olvida, para poder reintentar
 * con otro correo.
 */
const enCurso = new Map<string, Promise<void>>();

export function completarConEnlace(correo: string, href: string): Promise<void> {
  const clave = `${correo.trim().toLowerCase()} ${href}`;
  const yaVa = enCurso.get(clave);
  if (yaVa !== undefined) return yaVa;
  const promesa = entrarConEnlace(correo, href);
  enCurso.set(clave, promesa);
  promesa.catch(() => enCurso.delete(clave));
  return promesa;
}

async function entrarConEnlace(correo: string, href: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth === null) throw new Error('Falta la configuración de Firebase.');
  await signInWithEmailLink(auth, correo.trim().toLowerCase(), href);
  try {
    almacen()?.removeItem(CLAVE);
  } catch {
    // Nada que hacer: solo era para no volver a escribir el correo.
  }
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', window.location.pathname);
  }
}
