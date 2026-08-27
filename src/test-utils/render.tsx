import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

/* eslint-disable import/no-named-as-default-member --
   `i18n` es la instancia de i18next; `language` y `changeLanguage` son sus
   propiedades, no exportaciones nombradas del modulo. */
import i18n, { initI18n, type SupportedLanguage } from '@/i18n';

/**
 * Render para pruebas de componentes.
 *
 * Inicializa i18n de verdad en lugar de simular `t()`: las pruebas comprueban el
 * texto que el usuario ve, no una clave. Si una traducción falta, la prueba lo
 * detecta igual que lo detectaría una persona mirando la pantalla.
 */
export async function renderWithProviders(
  ui: ReactElement,
  { language = 'es-PE', ...options }: RenderOptions & { language?: SupportedLanguage } = {},
) {
  initI18n(language);
  // Solo se cambia si hace falta: llamar a changeLanguage con el idioma que ya
  // esta activo provoca un aviso de i18next en cada prueba.
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }

  // En React Native Testing Library 14 `render` es ASINCRONO: devuelve una
  // promesa, no el resultado. Sin el await, `screen` queda sin poblar y las
  // consultas fallan con "render function has not been called".
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>, options);
}

/**
 * Las pruebas importan `screen` y `fireEvent` directamente de
 * '@testing-library/react-native'. `screen` no se reexporta desde aqui: la
 * libreria lo reemplaza al renderizar y un reexport congelaria la version
 * inicial "sin render".
 */
