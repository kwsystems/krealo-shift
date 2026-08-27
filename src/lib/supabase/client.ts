import 'react-native-url-polyfill/auto';

import { Platform } from 'react-native';
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';

import { env, isEnvConfigured } from '@/lib/env';
import { secureStorage } from '@/lib/security/secure-storage';
import type { Database } from './types';

/**
 * Cliente de Supabase (§4, §22).
 *
 * En el cliente solo viven `SUPABASE_URL` y `SUPABASE_ANON_KEY`, que son públicas.
 * La `service_role` nunca entra en la app: las operaciones sensibles pasan por
 * Edge Functions.
 *
 * La sesión se guarda en SecureStore, no en AsyncStorage (§22).
 */

const secureStorageAdapter: SupportedStorage = {
  getItem: (key) => secureStorage.get(key),
  setItem: (key, value) => secureStorage.set(key, value),
  removeItem: (key) => secureStorage.remove(key),
};

/**
 * El cliente se tipa con `Database` (ver ./types.ts). Sin ese tipo, supabase-js
 * infiere `never` para los cuerpos de insert y update, y toda escritura falla el
 * typecheck con un mensaje que no apunta a la causa.
 */
export type AppSupabaseClient = SupabaseClient<Database, 'public'>;

let client: AppSupabaseClient | null = null;

/**
 * Devuelve el cliente, creándolo la primera vez. Devuelve `null` cuando falta
 * configuración: la app muestra entonces una pantalla explicativa en vez de
 * reventar con un error técnico (§20).
 */
export function getSupabase(): AppSupabaseClient | null {
  if (!isEnvConfigured) return null;
  if (client !== null) return client;

  client = createClient<Database, 'public'>(
    env.EXPO_PUBLIC_SUPABASE_URL,
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        storage: secureStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        // En nativo no hay URL de retorno que parsear; en web sí.
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
      global: {
        headers: { 'x-app-name': 'krealo-shift' },
      },
    },
  );

  return client;
}

/** Igual que `getSupabase` pero lanza: para usar donde la configuración ya se validó. */
export function requireSupabase(): AppSupabaseClient {
  const supabase = getSupabase();
  if (supabase === null) {
    throw new Error('Supabase no está configurado. Revisa las variables EXPO_PUBLIC_SUPABASE_*.');
  }
  return supabase;
}
