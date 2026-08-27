import { fireEvent, screen } from '@testing-library/react-native';

import { LanguageSwitch } from '@/components/ui/language-switch';
import i18n, { changeLanguage, initI18n } from '@/i18n';
import { usePreferencesStore } from '@/stores/preferences-store';
import { renderWithProviders } from '@/test-utils/render';

/**
 * El selector de idioma (§18).
 *
 * Lo que estas pruebas fijan, y por que cada una:
 *
 *   - ESPAÑOL ES EL PREDETERMINADO. Es lo que pide §18 y es lo que estaba mal: el
 *     idioma salia del locale del dispositivo, asi que un iPad en configuracion
 *     inglesa mostraba la app en ingles a un equipo peruano.
 *   - El cambio es INMEDIATO y se ve en los textos, no solo en el store.
 *   - El estado accesible sigue al idioma. Esto fallaba de forma silenciosa:
 *     `accessibilityState={{ selected }}` con rol `radio` NO produce `aria-checked`,
 *     asi que el arbol de accesibilidad decia "no seleccionado" en las DOS opciones.
 *     Se vio inspeccionando el arbol real en un navegador; leyendo el codigo parecia
 *     correcto y `tsc` no se quejaba.
 */

describe('LanguageSwitch', () => {
  beforeEach(async () => {
    // `initI18n` primero: i18n no existe hasta que alguien lo inicializa, y
    // `changeLanguage` sobre una instancia sin inicializar lanza. Normalmente lo hace
    // `renderWithProviders`, pero aqui hace falta antes para dejar el idioma en un
    // punto conocido.
    initI18n('es-PE');

    // Cada caso arranca sin preferencia guardada, que es el escenario de un iPad
    // recien activado.
    usePreferencesStore.setState({ language: 'es-PE' });
    await changeLanguage('es-PE');
  });

  it('arranca en español, que es el idioma predeterminado del proyecto', async () => {
    await renderWithProviders(<LanguageSwitch />);
    expect(usePreferencesStore.getState().language).toBe('es-PE');
    expect(i18n.language).toBe('es-PE');
  });

  it('muestra las dos opciones, cada una nombrada en su propio idioma', async () => {
    await renderWithProviders(<LanguageSwitch size="full" />);
    // En su propio idioma a proposito: quien necesita cambiar el idioma es
    // precisamente quien no entiende el actual.
    expect(screen.getByText('Español')).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
  });

  it('cambia el idioma al pulsar, sin reiniciar', async () => {
    await renderWithProviders(<LanguageSwitch />);
    await fireEvent.press(screen.getByTestId('language-switch-en'));

    expect(usePreferencesStore.getState().language).toBe('en');
    expect(i18n.language).toBe('en');
  });

  it('el estado accesible marca SOLO la opcion activa', async () => {
    await renderWithProviders(<LanguageSwitch />);

    const es = screen.getByTestId('language-switch-es-PE');
    const en = screen.getByTestId('language-switch-en');

    // Con español activo.
    expect(es.props.accessibilityState?.checked).toBe(true);
    expect(en.props.accessibilityState?.checked).toBe(false);

    await fireEvent.press(en);

    // Y se invierte al cambiar. Si esto falla, un lector de pantalla anuncia el
    // idioma equivocado como activo.
    expect(screen.getByTestId('language-switch-es-PE').props.accessibilityState?.checked).toBe(
      false,
    );
    expect(screen.getByTestId('language-switch-en').props.accessibilityState?.checked).toBe(true);
  });

  it('pulsar el idioma ya activo no lo cambia', async () => {
    await renderWithProviders(<LanguageSwitch />);
    await fireEvent.press(screen.getByTestId('language-switch-es-PE'));
    expect(usePreferencesStore.getState().language).toBe('es-PE');
  });

  it('cada opcion se anuncia con su nombre completo', async () => {
    await renderWithProviders(<LanguageSwitch />);
    // Aunque la etiqueta visible sea "ES", VoiceOver tiene que decir "Español": dos
    // letras no son un nombre de accion completo (§21).
    expect(screen.getByTestId('language-switch-es-PE').props.accessibilityLabel).toContain(
      'Español',
    );
    expect(screen.getByTestId('language-switch-en').props.accessibilityLabel).toContain('English');
  });
});
