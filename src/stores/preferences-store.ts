import { create } from 'zustand';

import { DEFAULT_LANGUAGE, changeLanguage, type SupportedLanguage } from '@/i18n';
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
    // SIN PREFERENCIA GUARDADA, ESPAÑOL. Y no el idioma del dispositivo.
    //
    // §18 lo dice literal: "Idioma predeterminado: español (es-PE). Segundo idioma
    // completo: inglés". Antes esto seguia el locale del dispositivo, y el efecto
    // practico era que un iPad en configuracion inglesa mostraba la app en ingles a
    // un equipo peruano sin que nadie hubiera elegido eso.
    //
    // NO se hace ninguna excepcion por dispositivo en ingles, aunque suene razonable:
    // el español es el idioma del proyecto, y quien quiera ingles lo tiene a un toque
    // —el conmutador del kiosco en reposo y el selector de Ajustes— y su eleccion se
    // guarda. Adivinar a partir del locale es lo que producia el problema.
    const language = stored?.language ?? DEFAULT_LANGUAGE;
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
