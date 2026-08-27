import { create } from 'zustand';

import { DEFAULT_LANGUAGE, changeLanguage, resolveDeviceLanguage, type SupportedLanguage } from '@/i18n';
import { SECURE_KEYS, secureStorage } from '@/lib/security/secure-storage';
import type { TimeFormatPreference } from '@/utils/time';

/**
 * Preferencias visuales del dispositivo (§4: Zustand solo para estado local pequeño).
 *
 * Los datos de Supabase NO se duplican aquí: esto es solo idioma, formato de hora
 * y si el usuario ya vio los avisos de permisos.
 */

type PersistedPreferences = {
  language: SupportedLanguage;
  timeFormat: TimeFormatPreference;
};

type PreferencesState = PersistedPreferences & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  toggleLanguage: () => Promise<void>;
  setTimeFormat: (format: TimeFormatPreference) => Promise<void>;
};

/** es-PE arranca en 24 horas (§2). */
const DEFAULTS: PersistedPreferences = {
  language: DEFAULT_LANGUAGE,
  timeFormat: '24h',
};

async function persist(next: PersistedPreferences): Promise<void> {
  await secureStorage.setJson(SECURE_KEYS.preferences, next);
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  hydrate: async () => {
    const stored = await secureStorage.getJson<Partial<PersistedPreferences>>(
      SECURE_KEYS.preferences,
    );
    // Sin preferencia guardada seguimos el idioma del dispositivo.
    const language = stored?.language ?? resolveDeviceLanguage();
    const timeFormat = stored?.timeFormat ?? DEFAULTS.timeFormat;

    await changeLanguage(language);
    set({ language, timeFormat, hydrated: true });
  },

  setLanguage: async (language) => {
    await changeLanguage(language);
    set({ language });
    await persist({ language, timeFormat: get().timeFormat });
  },

  toggleLanguage: async () => {
    const next: SupportedLanguage = get().language === 'es-PE' ? 'en' : 'es-PE';
    await get().setLanguage(next);
  },

  setTimeFormat: async (timeFormat) => {
    set({ timeFormat });
    await persist({ language: get().language, timeFormat });
  },
}));
