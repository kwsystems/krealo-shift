import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from './app-text';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { usePreferencesStore } from '@/stores/preferences-store';
import { borderWidth, colors, radii, sizes, spacing } from '@/theme/tokens';

/**
 * Selector de idioma (§18).
 *
 * POR QUE EXISTE COMO COMPONENTE Y NO COMO UN BOTON SUELTO
 * Antes el kiosco tenía un único botón con la etiqueta `ES | en`, que conmutaba al
 * pulsarlo. Funcionaba, pero tenía dos problemas de fondo:
 *
 *   1. La ÚNICA señal de qué idioma estaba activo eran las mayúsculas: `ES | en`
 *      frente a `es | EN`. §21 pide no depender de una sola indicación sutil, y unas
 *      mayúsculas son justo eso. Alguien que llega al iPad no sabe si está mirando
 *      "está en español" o "toca aquí para español".
 *   2. Un botón que dice dos cosas no dice cuál va a pasar al pulsarlo.
 *
 * Ahora son dos opciones visibles, la activa marcada con fondo, borde y peso de
 * letra —tres señales, no una— y con `accessibilityState.selected`, que es lo que
 * hace que VoiceOver diga "seleccionado" en vez de dejar a la persona adivinando.
 *
 * Cada idioma se nombra EN SU PROPIO IDIOMA ("Español", "English") y no traducido.
 * Es la convención de cualquier selector de idioma, y por un motivo práctico: quien
 * necesita cambiar de idioma es precisamente quien no entiende el actual.
 */

const NOMBRES: Record<SupportedLanguage, { largo: string; corto: string }> = {
  'es-PE': { largo: 'Español', corto: 'ES' },
  en: { largo: 'English', corto: 'EN' },
};

export function LanguageSwitch({
  size = 'compact',
  testID = 'language-switch',
}: {
  /**
   * `compact` para el pie del kiosco, donde el espacio es de nadie y el control es
   * secundario. `full` para Ajustes, donde el nombre completo es más claro.
   */
  size?: 'compact' | 'full';
  testID?: string;
}) {
  const { t } = useTranslation();
  const language = usePreferencesStore((state) => state.language);
  const setLanguage = usePreferencesStore((state) => state.setLanguage);

  return (
    <View style={styles.group} accessibilityRole="radiogroup" testID={testID}>
      {SUPPORTED_LANGUAGES.map((code) => {
        const activo = code === language;
        const nombre = size === 'full' ? NOMBRES[code].largo : NOMBRES[code].corto;

        return (
          <Pressable
            key={code}
            onPress={() => {
              // Sin `await`: cambiar de idioma no debe bloquear el toque. i18n
              // notifica a los componentes y el guardado en disco va detrás.
              if (!activo) void setLanguage(code);
            }}
            accessibilityRole="radio"
            // `checked` y NO `selected`, y la diferencia no es cosmética: para el rol
            // `radio`, el atributo que un lector de pantalla lee es `aria-checked`.
            // Con `selected` se emitía `role="radio"` SIN `aria-checked`, así que el
            // árbol de accesibilidad reportaba "no seleccionado" en las DOS opciones
            // —o sea, mentía sobre la que estaba activa—.
            //
            // Se descubrió inspeccionando el árbol de accesibilidad real en el
            // navegador. Leyendo el código parecía correcto: `accessibilityState`
            // acepta `selected` sin quejarse, y `tsc` no dice nada.
            accessibilityState={{ checked: activo, selected: activo }}
            // Y ADEMAS el atributo ARIA directo. `accessibilityState` es lo que lee
            // VoiceOver en iOS, pero react-native-web NO lo traduce a `aria-checked`
            // para el rol `radio`: se comprobo inspeccionando el arbol real y las dos
            // opciones salian como "no seleccionado". React Native acepta los props
            // `aria-*` en todas las plataformas desde 0.71, asi que poner los dos
            // cubre nativo y web sin ramificar por plataforma.
            aria-checked={activo}
            accessibilityLabel={`${t('common.language')}: ${NOMBRES[code].largo}`}
            style={[styles.option, size === 'full' && styles.optionFull, activo && styles.active]}
            testID={`${testID}-${code}`}
          >
            <AppText
              variant={size === 'full' ? 'body' : 'label'}
              tone={activo ? 'primary' : 'subtle'}
              style={activo ? styles.activeText : undefined}
            >
              {nombre}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  option: {
    minHeight: sizes.touchTargetMin,
    minWidth: sizes.touchTargetMin,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    borderWidth: borderWidth.hairline,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionFull: { paddingHorizontal: spacing.base },
  // Tres señales del estado activo, no una: fondo, borde y peso de letra.
  active: { backgroundColor: colors.primary50, borderColor: colors.primary500 },
  activeText: { fontWeight: '600' },
});
