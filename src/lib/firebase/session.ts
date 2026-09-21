import { onAuthStateChanged } from 'firebase/auth';

import { getDemoClient } from '@/lib/demo/client';
import { isDemoMode } from '@/lib/demo/config';

import { getFirebaseAuth } from './client';

/**
 * De donde sale la sesion: de Firebase, o de la demostracion.
 *
 * ESTO EXISTE PARA QUE EL RESTO DE LA APP NO TENGA QUE PREGUNTARLO. El acceso a
 * datos ya tenia su desvio unico en `getDataClient()`, pero la sesion no pasa por
 * ahi: el store habla con el auth directamente. Sin esta fachada, el modo
 * demostracion obligaria a sembrar `if (isDemoMode)` en el store, en la pantalla de
 * acceso y en el arranque — y el dia que uno se olvide, la demostracion intentara
 * hablar con un proyecto de Firebase que no existe.
 */

export type SessionUserInfo = { uid: string; email: string | null };

export type AuthSource = {
  /** Resuelve cuando la sesion guardada ya se leyo (o se supo que no hay). */
  ready: () => Promise<void>;
  currentUser: () => SessionUserInfo | null;
  subscribe: (onChange: (user: SessionUserInfo | null) => void) => () => void;
  signOut: () => Promise<void>;
  /** Solo en demostracion: entrar sin pasar por Google. */
  signInDemo: (() => Promise<void>) | null;
};

type DemoAuth = {
  getSession: () => Promise<{ data: { session: { user: { id: string; email: string } } | null } }>;
  onAuthStateChange: (
    callback: (evento: string, sesion: { user: { id: string; email: string } } | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
  signInWithPassword: (credenciales: { email: string; password: string }) => Promise<unknown>;
  signOut: () => Promise<unknown>;
};

function demoSource(): AuthSource {
  const auth = (getDemoClient() as unknown as { auth: DemoAuth }).auth;
  let cached: SessionUserInfo | null = null;

  const leer = async () => {
    const { data } = await auth.getSession();
    cached =
      data.session === null ? null : { uid: data.session.user.id, email: data.session.user.email };
  };

  return {
    ready: leer,
    currentUser: () => cached,
    subscribe: (onChange) => {
      const { data } = auth.onAuthStateChange((_evento, sesion) => {
        cached = sesion === null ? null : { uid: sesion.user.id, email: sesion.user.email };
        onChange(cached);
      });
      return () => data.subscription.unsubscribe();
    },
    signOut: async () => {
      await auth.signOut();
    },
    signInDemo: async () => {
      await auth.signInWithPassword({ email: 'demo@krealomedia.com', password: 'demostracion' });
    },
  };
}

export function authSource(): AuthSource | null {
  if (isDemoMode) return demoSource();

  const auth = getFirebaseAuth();
  if (auth === null) return null;

  return {
    ready: () => auth.authStateReady(),
    currentUser: () =>
      auth.currentUser === null
        ? null
        : { uid: auth.currentUser.uid, email: auth.currentUser.email },
    subscribe: (onChange) =>
      onAuthStateChanged(auth, (user) =>
        onChange(user === null ? null : { uid: user.uid, email: user.email }),
      ),
    signOut: () => auth.signOut(),
    signInDemo: null,
  };
}
