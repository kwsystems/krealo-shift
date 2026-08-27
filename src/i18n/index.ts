/* eslint-disable import/no-named-as-default-member --
   `i18n` es la instancia por defecto de i18next: `use` y `changeLanguage` son sus
   metodos, no exportaciones nombradas del modulo. La regla da un falso positivo. */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import en from './locales/en.json';
import esPE from './locales/es-PE.json';

/**
 * Internacionalización (especificación §18).
 *
 * - Idioma predeterminado: es-PE. Segundo idioma completo: en.
 * - Las claves son semánticas, nunca la frase completa.
 * - El cambio de idioma es inmediato, sin reiniciar la app.
 * - La estructura admite agregar francés después sin tocar componentes:
 *   basta con añadir el JSON y registrarlo en `resources`.
 */

export const SUPPORTED_LANGUAGES = ['es-PE', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'es-PE';

const resources = {
  'es-PE': { translation: esPE },
  en: { translation: en },
} as const;

/** Resuelve el idioma del dispositivo a uno soportado; cae en es-PE. */
export function resolveDeviceLanguage(): SupportedLanguage {
  const locales = getLocales();
  for (const locale of locales) {
    const tag = locale.languageTag;
    if (SUPPORTED_LANGUAGES.includes(tag as SupportedLanguage)) {
      return tag as SupportedLanguage;
    }
    // es-MX, es-ES y cualquier otro español caen en es-PE.
    if (locale.languageCode === 'es') return 'es-PE';
    if (locale.languageCode === 'en') return 'en';
  }
  return DEFAULT_LANGUAGE;
}

let initialized = false;

export function initI18n(language?: SupportedLanguage): typeof i18n {
  if (initialized) return i18n;

  i18n.use(initReactI18next).init({
    resources,
    lng: language ?? resolveDeviceLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'translation',
    interpolation: {
      // React ya escapa el contenido; escapar dos veces rompe nombres con acentos.
      escapeValue: false,
    },
    returnNull: false,
    // En desarrollo queremos ver la clave faltante, no un texto en blanco.
    parseMissingKeyHandler: (key) => (__DEV__ ? `⟦${key}⟧` : key),
  });

  initialized = true;
  return i18n;
}

export async function changeLanguage(language: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(language);
}

export function currentLanguage(): SupportedLanguage {
  const lng = i18n.language;
  return SUPPORTED_LANGUAGES.includes(lng as SupportedLanguage)
    ? (lng as SupportedLanguage)
    : DEFAULT_LANGUAGE;
}

/** Alterna entre los dos idiomas: lo usa el selector ES | EN del kiosco (§9.1). */
export function nextLanguage(): SupportedLanguage {
  return currentLanguage() === 'es-PE' ? 'en' : 'es-PE';
}

export default i18n;
