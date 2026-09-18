import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from './app-text';
import { usePreferencesStore } from '@/stores/preferences-store';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme, THEME_PREFERENCES, type ThemePreference } from '@/theme/use-theme';

/**
 * Selector de apariencia: Automático, Claro, Oscuro.
 *
 * TRES OPCIONES Y NO UN INTERRUPTOR DE DOS. Un conmutador «modo oscuro sí/no» obliga a
 * elegir uno de los dos para siempre, y eso es peor que no tener ajuste: quien puso su
 * teléfono en oscuro a las nueve de la noche ya tomó esa decisión, y la app debería
 * seguirla sola. «Automático» es el valor de fábrica por eso.
 *
 * Y los fijos existen porque el automático no siempre acierta: un iPad de pared en una
 * tienda con las luces encendidas hasta el cierre no quiere ponerse oscuro porque se
 * puso el sol.
 *
 * SE CALCA DEL SELECTOR DE IDIOMA, Y A PROPÓSITO. Es el mismo tipo de control —una
 * preferencia de este aparato, con opciones excluyentes— y `language-switch.tsx` ya
 * pagó dos lecciones que aquí se heredan en vez de volver a descubrirlas:
 *
 *   1. TRES SEÑALES DEL ESTADO ACTIVO, no una: fondo, borde y peso de letra. §21 pide
 *      no depender de una sola indicación sutil.
 *   2. `aria-checked` ADEMÁS de `accessibilityState`. Para el rol `radio`, lo que lee un
 *      lector de pantalla en web es `aria-checked`, y react-native-web NO lo deriva de
 *      `accessibilityState`: sin el atributo directo, el árbol de accesibilidad decía
 *      «no seleccionado» en las TRES opciones, o sea mentía sobre la activa.
 *
 * EL ICONO NO ES DECORACIÓN. Las tres etiquetas —«Automático», «Claro», «Oscuro»— son
 * palabras abstractas hasta que se prueban. El sol, la luna y el medio hacen que se
 * entienda de un vistazo cuál es cuál. Va CON su texto al lado, nunca solo: un icono a
 * secas es justo lo que §21 prohíbe.
 */

const ICONO: Record<ThemePreference, keyof typeof Ionicons.glyphMap> = {
  system: 'contrast-outline',
  light: 'sunny-outline',
  dark: 'moon-outline',
};

/**
 * Se exporta para que una prueba pueda comprobar que las tres opciones tienen etiqueta y
 * que esas claves existen en los dos idiomas. Sin eso, añadir una cuarta preferencia
 * compila igual y la opción nueva sale con la clave cruda —«settings.themeLoQueSea»— en
 * la pantalla, que es un fallo que nadie ve hasta que lo ve un cliente.
 */
export const CLAVE_DE_ETIQUETA: Record<ThemePreference, string> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
};

export function ThemeSwitch({ testID = 'theme-switch' }: { testID?: string }) {
  const styles = useEstilos();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const preference = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);

  return (
    <View style={styles.group} accessibilityRole="radiogroup" testID={testID}>
      {THEME_PREFERENCES.map((opcion) => {
        const activo = opcion === preference;
        const nombre = t(CLAVE_DE_ETIQUETA[opcion]);

        return (
          <Pressable
            key={opcion}
            onPress={() => {
              // Sin `await`: el store cambia el estado ANTES de guardar en disco, así
              // que la pantalla se repinta en el mismo toque. Esperar al guardado solo
              // metería un retraso visible en un cambio que tiene que ser instantáneo.
              if (!activo) void setTheme(opcion);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: activo, selected: activo }}
            aria-checked={activo}
            accessibilityLabel={`${t('settings.appTheme')}: ${nombre}`}
            style={[styles.option, activo ? styles.active : null]}
            testID={`${testID}-${opcion}`}
          >
            <Ionicons
              name={ICONO[opcion]}
              size={sizes.iconMobile}
              color={activo ? colors.primary600 : colors.ink500}
            />
            <AppText
              variant="body"
              tone={activo ? 'primary' : 'subtle'}
              style={activo ? styles.activeText : undefined}
              numberOfLines={1}
            >
              {nombre}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  /*
   * `flexWrap` y `flex: 1` con un ancho mínimo: tres opciones con nombre completo no
   * caben en una fila de teléfono estrecho. Sin esto, la tercera se corta o empuja a
   * las otras dos, que es el fallo que el arnés del teclado ya caza en el kiosco.
   */
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'stretch' },
  option: {
    flexGrow: 1,
    flexBasis: 104,
    minHeight: sizes.touchTargetMin,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    borderRadius: radii.button,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { backgroundColor: colors.primary50, borderColor: colors.primary500 },
  activeText: { fontWeight: '600' },
}));
