import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  type UserCredential,
} from 'firebase/auth';

import { env } from '@/lib/env';

import { getFirebaseAuth } from './client';

/**
 * Entrar con Google (§8). Sustituye al correo y contraseña de Supabase.
 *
 * SON DOS CAMINOS DISTINTOS Y NO HAY UNO SOLO QUE SIRVA PARA LOS DOS.
 *
 * En web, `signInWithPopup` abre la ventana de Google y Firebase resuelve todo: usa
 * el cliente OAuth que el propio Firebase crea al habilitar el proveedor.
 *
 * En iPad no existe ventana emergente. Hay que abrir el navegador del sistema con
 * `expo-auth-session`, recoger el `id_token` que Google devuelve y canjearlo por una
 * sesión de Firebase. Eso necesita un cliente OAuth de iOS propio, que es un dato de
 * configuración más — y si falta, esto lo dice en vez de abrir un navegador que
 * terminaría en una página de error de Google que nadie sabe interpretar.
 *
 * LO QUE SE PERDIÓ EN EL CAMBIO, Y ES DELIBERADO: no hay «olvidé mi contraseña».
 * Con Google no hay contraseña nuestra que recuperar; si alguien no puede entrar, lo
 * resuelve en su cuenta de Google. Por eso `password-reset.ts` y la pantalla
 * `/restablecer` se borraron en lugar de quedarse como botones muertos.
 */

// Cierra la sesión del navegador emergente al volver a la app. Sin esto, en web
// queda la pestaña de Google abierta tras entrar.
void WebBrowser.maybeCompleteAuthSession();

export type GoogleSignInState = {
  /** Lanza el inicio de sesión. Resuelve cuando Firebase ya tiene la sesión. */
  signIn: () => Promise<void>;
  /** `false` mientras la petición nativa se prepara, o si falta configuración. */
  ready: boolean;
  /** Motivo por el que no se puede entrar, para que la pantalla lo explique. */
  unavailableReason: 'notConfigured' | 'missingIosClientId' | null;
  /** Fallo del canje del token nativo. La pantalla lo muestra como error de acceso. */
  error: unknown;
};

export function useGoogleSignIn(
  onSignedIn?: (credential: UserCredential) => void,
): GoogleSignInState {
  const isWeb = Platform.OS === 'web';
  const iosClientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const webClientId = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId ?? '',
    iosClientId,
  });

  const [error, setError] = useState<unknown>(null);

  /**
   * El canje del `id_token` va en un efecto y no dentro de `signIn` porque
   * `promptAsync` resuelve cuando se cierra el navegador, no cuando Google
   * responde: la respuesta llega por este canal. Encadenarlo al `await` de
   * `promptAsync` deja entrar a la mitad de los intentos, y el fallo parece
   * aleatorio.
   */
  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params.id_token;
    if (typeof idToken !== 'string') return;

    const auth = getFirebaseAuth();
    if (auth === null) return;

    signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
      .then((credential) => onSignedIn?.(credential))
      .catch((failure: unknown) => setError(failure));
  }, [response, onSignedIn]);

  const signIn = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth === null) throw new Error('Falta la configuración de Firebase.');

    setError(null);

    if (isWeb) {
      const provider = new GoogleAuthProvider();
      // Que siempre pregunte qué cuenta usar: en una tienda, el iPad y la laptop
      // los comparten varias personas y entrar con la cuenta de quien pasó antes
      // es un fichaje atribuido a quien no fue.
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      onSignedIn?.(credential);
      return;
    }

    await promptAsync();
  }, [isWeb, onSignedIn, promptAsync]);

  const unavailableReason: GoogleSignInState['unavailableReason'] = (() => {
    if (getFirebaseAuth() === null) return 'notConfigured';
    if (!isWeb && (iosClientId === undefined || iosClientId === '')) return 'missingIosClientId';
    return null;
  })();

  return {
    signIn,
    ready: unavailableReason === null && (isWeb || request !== null),
    unavailableReason,
    error,
  };
}
