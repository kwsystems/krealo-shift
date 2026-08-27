import { create } from 'zustand';

import { deactivateRememberedPushToken } from '@/features/notifications/api';
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

type SessionState = {
  phase: SessionPhase;
  user: SessionUser | null;
  /** Se resuelve tras cargar la membresía; `null` mientras no se conoce. */
  role: AppRole | null;
  organizationId: string | null;

  hydrate: () => Promise<void>;
  setMembership: (params: { role: AppRole; organizationId: string }) => void;
  signOut: () => Promise<void>;
  /** Suscripción a los cambios de sesión de Supabase. Devuelve el limpiador. */
  subscribe: () => () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  phase: 'unknown',
  user: null,
  role: null,
  organizationId: null,

  hydrate: async () => {
    const supabase = getSupabase();
    if (supabase === null) {
      // Sin configuración no hay sesión posible; la app mostrará el aviso de
      // configuración en lugar de quedarse en "unknown" para siempre.
      set({ phase: 'signedOut', user: null, role: null, organizationId: null });
      return;
    }

    const { data } = await supabase.auth.getSession();
    const session = data.session;

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

  signOut: async () => {
    // ANTES de cerrar la sesión, y no después: la política RLS de `push_tokens`
    // exige `auth.uid()`, así que en cuanto la sesión se cierra ya no hay forma de
    // apagar el token. Sin esto, un iPhone que cambia de manos sigue recibiendo las
    // alertas de la tienda. No lanza: cerrar sesión funciona aunque falle.
    await deactivateRememberedPushToken();

    const supabase = getSupabase();
    if (supabase !== null) await supabase.auth.signOut();
    set({ phase: 'signedOut', user: null, role: null, organizationId: null });
  },

  subscribe: () => {
    const supabase = getSupabase();
    if (supabase === null) return () => undefined;

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session === null) {
        set({ phase: 'signedOut', user: null, role: null, organizationId: null });
        return;
      }
      set({
        phase: 'signedIn',
        user: { userId: session.user.id, email: session.user.email ?? null },
      });
    });

    return () => data.subscription.unsubscribe();
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
