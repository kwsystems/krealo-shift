/* eslint-disable import/no-named-as-default-member --
   `i18n` es la instancia por defecto de i18next: `use` y `changeLanguage` son sus
   metodos, no exportaciones nombradas del modulo. La regla da un falso positivo. */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

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

/*
 * AQUI HABIA UN `resolveDeviceLanguage()` que resolvia el locale del sistema. Se
 * quito, y conviene saber por que para no volver a ponerlo:
 *
 * §18 fija el español como idioma predeterminado. Mientras esa funcion existia, el
 * arranque y la hidratacion de preferencias la usaban, y el resultado era que un
 * iPad en configuracion inglesa mostraba la app en ingles a un equipo peruano sin
 * que nadie lo hubiera elegido.
 *
 * Dejarla ahi sin usar era peor que borrarla: una funcion con ese nombre invita a
 * recablearla y a reintroducir exactamente el mismo problema.
 *
 * Quien quiera ingles lo tiene a un toque —el conmutador del kiosco en reposo y el
 * selector de Ajustes— y su eleccion se guarda en el almacenamiento seguro. Eso es
 * mejor que adivinar, porque una eleccion explicita no se equivoca.
 */

let initialized = false;

export function initI18n(language?: SupportedLanguage): typeof i18n {
  if (initialized) return i18n;

  i18n.use(initReactI18next).init({
    resources,
    // ARRANCA EN ESPAÑOL, no en el idioma del dispositivo (§18).
    //
    // `app/_layout.tsx` llama a esto en el arranque, ANTES de que el store de
    // preferencias hidrate desde el almacenamiento seguro. Si aqui se resolviera el
    // locale del dispositivo, un iPad en ingles pintaria el primer fotograma en
    // ingles y despues saltaria a la preferencia guardada: un parpadeo de idioma en
    // la pantalla de arranque, que es de las cosas que hacen que una app parezca mal
    // hecha.
    //
    // Empezar en español y dejar que `hydrate()` aplique la preferencia real hace que
    // el unico salto posible sea hacia lo que la persona eligio, no hacia lo que el
    // sistema operativo adivino.
    lng: language ?? DEFAULT_LANGUAGE,
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
