import { create } from 'zustand';

import {
  deactivateAllPushTokens,
  deactivateRememberedPushToken,
} from '@/features/notifications/api';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Sesión administrativa (§8).
 *
 * Solo owner, admin y manager tienen cuenta. Los empleados operativos no
 * necesitan una en P0/P1: fichan con su PIN en el iPad de la tienda.
 *
 * Este store guarda lo mínimo para decidir rutas y pintar la interfaz. Los datos
 * de negocio (membresías, ubicaciones) los sirve TanStack Query desde Supabase.
 */

export type AppRole = 'owner' | 'admin' | 'manager' | 'employee';

export type SessionUser = {
  userId: string;
  email: string | null;
};

export type SessionPhase = 'unknown' | 'signedOut' | 'signedIn';

/**
 * Por qué se acabó la sesión, cuando se acabó.
 *
 * `expired` es el caso que no se contaba: el refresh token caduca o se revoca, la app
 * cae a la pantalla de acceso y NO DICE NADA. La persona ve el formulario vacío y
 * supone que hizo algo mal, o que la app se rompió. Existían hasta los textos
 * traducidos —`states.sessionExpiredTitle` y `Body`— sin nadie que los mostrara.
 *
 * `signedOut` es cuando la persona lo pidió: ahí no hay nada que explicar, y mostrar
 * "tu sesión caducó" a quien acaba de pulsar "cerrar sesión" sería mentir.
 */
export type SessionEndReason = 'expired' | 'signedOut';

type SessionState = {
  phase: SessionPhase;
  user: SessionUser | null;
  /** Se resuelve tras cargar la membresía; `null` mientras no se conoce. */
  role: AppRole | null;
  organizationId: string | null;
  /** Motivo del último fin de sesión, para que el acceso lo pueda explicar. */
  endReason: SessionEndReason | null;

  hydrate: () => Promise<void>;
  setMembership: (params: { role: AppRole; organizationId: string }) => void;
  signOut: () => Promise<void>;
  /** Revoca la sesión en TODOS los dispositivos de la persona (§8). */
  signOutEverywhere: () => Promise<void>;
  /** Se llama al mostrar el aviso, para que no reaparezca en el siguiente acceso. */
  clearEndReason: () => void;
  /** Suscripción a los cambios de sesión de Supabase. Devuelve el limpiador. */
  subscribe: () => () => void;
};

/**
 * Cuánto se espera a que la sesión guardada se resuelva antes de seguir sin ella.
 *
 * Seis segundos: bastante para una lectura de Keychain y un refresco de token con
 * red lenta, y poco para que nadie mire una pantalla de carga preguntándose si el
 * iPad está roto. Pasado eso se sigue como `signedOut`, que no pierde nada: el kiosco
 * no necesita sesión personal y quien quiera el panel inicia sesión.
 */
const SESSION_TIMEOUT_MS = 6_000;

export const useSessionStore = create<SessionState>((set, get) => ({
  phase: 'unknown',
  user: null,
  role: null,
  organizationId: null,
  endReason: null,

  hydrate: async () => {
    const supabase = getSupabase();
    if (supabase === null) {
      // Sin configuración no hay sesión posible; la app mostrará el aviso de
      // configuración en lugar de quedarse en "unknown" para siempre.
      set({ phase: 'signedOut', user: null, role: null, organizationId: null });
      return;
    }

    /**
     * ESTO PODIA DEJAR LA APP ENTERA COLGADA, y es el fallo de mayor alcance que ha
     * tenido este proyecto.
     *
     * `getSession()` iba sin try/catch y sin límite de tiempo. Si rechazaba —o
     * simplemente no respondía— `hydrate` moría y `phase` se quedaba en `'unknown'`
     * para siempre. Y `phase === 'unknown'` es lo que bloquea `app/index.tsx` y
     * `app/(manager)/_layout.tsx`: los dos muestran "Preparando tu sesión" mientras
     * no se resuelve.
     *
     * Así que la app entera se quedaba en esa pantalla, y reiniciar sin red hacía lo
     * mismo. LO PEOR: el kiosco también, porque la app arranca en `/`. Un iPad de
     * tienda que arranca sin wifi nunca pasaba de la pantalla de carga y no podía
     * fichar a nadie — que es exactamente el escenario para el que existe toda la
     * arquitectura sin conexión.
     *
     * Los dos caminos de `getSession()` pueden fallar de verdad: lee del
     * almacenamiento, que aquí es `SecureStore` y puede rechazar, y refresca el token
     * si caducó, que necesita red.
     *
     * EL LIMITE DE TIEMPO ES LA MITAD QUE IMPORTA. Un catch no sirve de nada si la
     * llamada no rechaza sino que se queda esperando, y con red a medias —un portal
     * cautivo, un router que acepta la conexión y no enruta— eso es lo normal.
     */
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null;

    try {
      // EL TEMPORIZADOR SE LIMPIA. Sin esto queda uno pendiente por arranque
      // aunque `getSession()` gane la carrera: inofensivo en la practica, pero es
      // basura que se acumula y Jest lo reporta como una operacion sin cerrar. Un
      // `Promise.race` sin limpiar el perdedor es el descuido clasico aqui.
      let temporizador: ReturnType<typeof setTimeout> | undefined;

      const resultado = await Promise.race([
        supabase.auth.getSession(),
        new Promise<'agotado'>((resolve) => {
          temporizador = setTimeout(() => resolve('agotado'), SESSION_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (temporizador !== undefined) clearTimeout(temporizador);
      });

      if (resultado === 'agotado') {
        console.warn(
          '[krealo-shift] La sesión no se pudo resolver en ' +
            SESSION_TIMEOUT_MS / 1000 +
            ' s. Se sigue sin sesión: el kiosco funciona igual y quien necesite el ' +
            'panel puede iniciar sesión cuando vuelva la red.',
        );
        set({ phase: 'signedOut', user: null, role: null, organizationId: null });
        return;
      }

      session = resultado.data.session;
    } catch (error) {
      console.warn(
        '[krealo-shift] No se pudo leer la sesión guardada. Se sigue sin sesión. Motivo: ' +
          String(error),
      );
      set({ phase: 'signedOut', user: null, role: null, organizationId: null });
      return;
    }

    if (session === null) {
      set({ phase: 'signedOut', user: null, role: null, organizationId: null });
      return;
    }

    set({
      phase: 'signedIn',
      user: { userId: session.user.id, email: session.user.email ?? null },
    });
  },

  setMembership: ({ role, organizationId }) => set({ role, organizationId }),

  clearEndReason: () => set({ endReason: null }),

  signOut: async () => {
    /*
     * El motivo se marca ANTES de llamar al servidor, y no después, porque
     * `onAuthStateChange` se dispara DURANTE ese await: si el motivo se pusiera al
     * final, el listener llegaría primero y llamaría "sesión caducada" a un cierre que
     * la persona pidió. Marcarlo antes hace que el orden deje de importar.
     */
    set({ endReason: 'signedOut' });

    // ANTES de cerrar la sesión, y no después: la política RLS de `push_tokens`
    // exige `auth.uid()`, así que en cuanto la sesión se cierra ya no hay forma de
    // apagar el token. Sin esto, un iPhone que cambia de manos sigue recibiendo las
    // alertas de la tienda. No lanza: cerrar sesión funciona aunque falle.
    await deactivateRememberedPushToken();

    const supabase = getSupabase();
    if (supabase !== null) await supabase.auth.signOut();
    set({ phase: 'signedOut', user: null, role: null, organizationId: null });
  },

  /**
   * Cerrar sesión en TODOS los dispositivos (§8).
   *
   * Lo pedía la especificación desde el principio y existía hasta la etiqueta
   * traducida —`auth.signOutEverywhere`—, pero no había ni función ni botón. Y no
   * había NINGÚN cierre de sesión en la interfaz: quien entraba al panel no tenía
   * forma de salir.
   *
   * `scope: 'global'` revoca todos los refresh tokens de la persona, así que los demás
   * dispositivos caen a la pantalla de acceso en cuanto intentan refrescar. NO afecta a
   * los relojes de tienda: un kiosco no usa sesión personal, usa su propia credencial
   * de dispositivo, y se revoca desde Ajustes → Relojes.
   *
   * Los tokens de push se apagan TODOS y no solo el de aquí: revocar sesiones y dejar
   * el teléfono perdido vibrando con los avisos del negocio no es cerrar sesión en
   * todas partes.
   */
  signOutEverywhere: async () => {
    // Igual que arriba: el motivo primero, porque el listener se adelanta.
    set({ endReason: 'signedOut' });

    await deactivateAllPushTokens();

    const supabase = getSupabase();
    if (supabase !== null) await supabase.auth.signOut({ scope: 'global' });
    set({ phase: 'signedOut', user: null, role: null, organizationId: null });
  },

  subscribe: () => {
    const supabase = getSupabase();
    if (supabase === null) return () => undefined;

    // `onAuthStateChange` puede lanzar al registrarse si el cliente está en mal
    // estado. Sin este catch, el `return subscribeSession()` del efecto de arranque
    // reventaría el render de la ruta inicial: pantalla en blanco y nada más.
    let data: { subscription: { unsubscribe: () => void } };
    try {
      ({ data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session === null) {
          /*
           * Aquí es donde muere una sesión que SÍ existía: el refresh token caducó o se
           * revocó —incluido "cerrar sesión en todos los dispositivos" pulsado en otro
           * teléfono—. Antes esto dejaba a la persona en el formulario de acceso sin
           * una palabra, y lo que se lee ahí es "hice algo mal" o "la app se rompió".
           *
           * Si el cierre lo pidió la persona, `signOut` ya dejó el motivo puesto y no se
           * pisa: decirle "tu sesión caducó" a quien acaba de pulsar "cerrar sesión"
           * sería mentir.
           */
          set({
            phase: 'signedOut',
            user: null,
            role: null,
            organizationId: null,
            endReason: get().endReason ?? 'expired',
          });
          return;
        }
        set({
          phase: 'signedIn',
          user: { userId: session.user.id, email: session.user.email ?? null },
          // Entrar bien borra el motivo anterior: si no, el aviso reaparecería la
          // próxima vez que alguien vea el acceso.
          endReason: null,
        });
      }));
    } catch (error) {
      console.warn(
        '[krealo-shift] No se pudo suscribir a los cambios de sesión. Motivo: ' + String(error),
      );
      return () => undefined;
    }

    return () => {
      try {
        data.subscription.unsubscribe();
      } catch {
        // Al desmontar no hay nada que hacer con un fallo aquí.
      }
    };
  },
}));

/** Jerarquía de permisos. Ocultar un botón no sustituye una política RLS (§7). */
const ROLE_RANK: Record<AppRole, number> = { employee: 0, manager: 1, admin: 2, owner: 3 };

export function hasAtLeastRole(role: AppRole | null, minimum: AppRole): boolean {
  if (role === null) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Roles con acceso al panel administrativo (§6.3). */
export function canUseAdminPanel(role: AppRole | null): boolean {
  return hasAtLeastRole(role, 'manager');
}
