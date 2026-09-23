import { create } from 'zustand';

import { DEFAULT_LANGUAGE, changeLanguage, type SupportedLanguage } from '@/i18n';
import type { ThemePreference } from '@/theme/use-theme';
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
  /** Claro, oscuro o seguir al sistema. Ver `@/theme/use-theme`. */
  theme: ThemePreference;
  /**
   * Cuál de tus empresas tenías abierta en el panel. `null` = la de siempre.
   *
   * SE GUARDA PORQUE UN SELECTOR QUE SE OLVIDA NO SIRVE: si cada recarga volviera a
   * la primera empresa, elegir la segunda sería un gesto que hay que repetir en cada
   * pestaña que abras, y el trabajo de verdad —mirar las horas de Canadá— pasaría por
   * volver a elegir cada vez. Es del dispositivo, no de la cuenta: es una comodidad
   * de esta pantalla, no un permiso.
   */
  managerOrganizationId: string | null;
};

type PreferencesState = PersistedPreferences & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  toggleLanguage: () => Promise<void>;
  setTimeFormat: (format: TimeFormatPreference) => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setManagerOrganizationId: (organizationId: string | null) => Promise<void>;
};

/** es-PE arranca en 24 horas (§2). */
const DEFAULTS: PersistedPreferences = {
  language: DEFAULT_LANGUAGE,
  timeFormat: '24h',
  /*
   * AUTOMÁTICO de fábrica, y aquí sí se sigue al dispositivo —al revés que el idioma.
   * No es incoherente: el idioma de un equipo peruano es una decisión del negocio que un
   * iPad configurado en inglés no debe cambiar, mientras que claro u oscuro es una
   * preferencia personal de quien mira la pantalla, y esa ya la expresó en su sistema.
   */
  theme: 'system',
  managerOrganizationId: null,
};

/**
 * Guarda TODO lo persistible leyéndolo del estado, no de una lista escrita a mano.
 *
 * ANTES CADA SETTER CONSTRUÍA EL OBJETO: `persist({ language, timeFormat, theme })`,
 * cuatro veces. Con tres campos ya era repetición; con el cuarto se convierte en una
 * trampa: el setter que olvidara uno no fallaría ni al compilar —el objeto sería
 * completo y válido— y el efecto sería BORRAR lo guardado de ese campo. O sea que
 * cambiar el tema te devolvería a la primera empresa, y el síntoma aparecería lejos
 * de la causa.
 *
 * Se llama DESPUÉS de `set`, porque en Zustand `set` es sincrónico y `get()` ya
 * devuelve el valor nuevo.
 */
async function persistirActual(state: PreferencesState): Promise<void> {
  const guardable: PersistedPreferences = {
    language: state.language,
    timeFormat: state.timeFormat,
    theme: state.theme,
    managerOrganizationId: state.managerOrganizationId,
  };
  await secureStorage.setJson(SECURE_KEYS.preferences, guardable);
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
    const theme = stored?.theme ?? DEFAULTS.theme;
    const managerOrganizationId = stored?.managerOrganizationId ?? DEFAULTS.managerOrganizationId;

    await changeLanguage(language);
    set({ language, timeFormat, theme, managerOrganizationId, hydrated: true });
  },

  setLanguage: async (language) => {
    await changeLanguage(language);
    set({ language });
    await persistirActual(get());
  },

  toggleLanguage: async () => {
    const next: SupportedLanguage = get().language === 'es-PE' ? 'en' : 'es-PE';
    await get().setLanguage(next);
  },

  setTimeFormat: async (timeFormat) => {
    set({ timeFormat });
    await persistirActual(get());
  },

  setTheme: async (theme) => {
    // Se aplica ANTES de guardar: el cambio de tema tiene que verse en el instante en
    // que se toca, no cuando el almacenamiento conteste. Si guardar falla, lo que se
    // pierde es que se recuerde mañana, no que funcione hoy.
    set({ theme });
    await persistirActual(get());
  },

  /*
   * Igual que el tema: se aplica antes de guardar. Si el almacenamiento falla, cambias
   * de empresa ahora y lo que se pierde es que se recuerde mañana.
   */
  setManagerOrganizationId: async (managerOrganizationId) => {
    set({ managerOrganizationId });
    await persistirActual(get());
  },
}));
