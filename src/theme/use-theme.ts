import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ColorSet } from './tokens';
import { usePreferencesStore } from '@/stores/preferences-store';

/**
 * Qué tema está activo, y por qué.
 *
 * TRES OPCIONES Y NO DOS. «Automático» sigue al sistema operativo y es el valor de
 * fábrica: quien puso su teléfono en oscuro a las nueve de la noche ya tomó esa decisión
 * y no tiene por qué volver a tomarla dentro de cada app. Claro y Oscuro fijos existen
 * porque el automático no siempre acierta —un iPad de pared en una tienda con las luces
 * encendidas todo el día no quiere seguir al horario del sistema— y porque hay gente que
 * simplemente prefiere uno.
 *
 * DEVUELVE EL JUEGO DE COLOR YA RESUELTO, no el nombre del tema. Si devolviera
 * `'dark'`, cada componente tendría que hacer su propio `tema === 'dark' ? x : y`, y
 * esa condición repetida cincuenta veces es exactamente donde se cuela la mitad
 * que alguien olvidó cambiar.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/**
 * `useColorScheme` no devuelve solo claro u oscuro: puede devolver `null` y también
 * `'unspecified'`. Se acepta el tipo entero a propósito, porque estrecharlo con un
 * `as` sería afirmar algo que la plataforma no garantiza, y los dos casos raros tienen
 * la misma respuesta correcta: quedarse en claro.
 */
export function resolveScheme(
  preference: ThemePreference,
  systemScheme: ResolvedScheme | 'unspecified' | null | undefined,
): ResolvedScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  /*
   * Sin dato del sistema, CLARO. Es el que la app ha tenido siempre, y ante la duda vale
   * más quedarse donde estaba que enseñar una pantalla oscura a alguien que no la pidió.
   * `useColorScheme` devuelve `null` de verdad: en web antes de que hidrate, y en
   * cualquier plataforma donde la preferencia no esté expuesta.
   */
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function colorsFor(scheme: ResolvedScheme): ColorSet {
  return scheme === 'dark' ? darkColors : lightColors;
}

export type Theme = {
  colors: ColorSet;
  /** El tema que de verdad se está pintando, ya resuelto. */
  scheme: ResolvedScheme;
  /** Lo que la persona eligió, que puede ser «automático». */
  preference: ThemePreference;
  isDark: boolean;
};

export function useTheme(): Theme {
  const systemScheme = useColorScheme();
  const preference = usePreferencesStore((state) => state.theme);
  const scheme = resolveScheme(preference, systemScheme);
  return { colors: colorsFor(scheme), scheme, preference, isDark: scheme === 'dark' };
}
