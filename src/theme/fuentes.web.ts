import { FontDisplay, type FontSource } from 'expo-font';

import Archivo_500Medium from '../../assets/fonts/web/Archivo_500Medium.woff2';
import Archivo_600SemiBold from '../../assets/fonts/web/Archivo_600SemiBold.woff2';
import Archivo_700Bold from '../../assets/fonts/web/Archivo_700Bold.woff2';
import Inter_400Regular from '../../assets/fonts/web/Inter_400Regular.woff2';
import Inter_500Medium from '../../assets/fonts/web/Inter_500Medium.woff2';
import Inter_600SemiBold from '../../assets/fonts/web/Inter_600SemiBold.woff2';
import Inter_700Bold from '../../assets/fonts/web/Inter_700Bold.woff2';

/**
 * LAS FUENTES DE LA WEB (28-oct). Mismas caras y nombres que `fuentes.ts`, pero:
 *
 * - en WOFF2 y solo con los caracteres latinos (176 KB los siete pesos, en vez de 790 KB de
 *   TTF). Se recortaron con `pyftsubset --flavor=woff2 --layout-features='*'` y el rango
 *   «latin» de Google Fonts: tildes, ñ, ¿¡, € y las cifras tabulares siguen dentro;
 * - con `swap`: el texto se pinta enseguida con la fuente del sistema y cambia cuando llega
 *   la buena. Antes la app esperaba a las siete y la pantalla seguía en blanco, que es lo
 *   que PageSpeed medía como primer pintado tardío.
 */
const conIntercambio = (uri: number): FontSource => ({ uri, display: FontDisplay.SWAP });

export const FUENTES = {
  Inter_400Regular: conIntercambio(Inter_400Regular),
  Inter_500Medium: conIntercambio(Inter_500Medium),
  Inter_600SemiBold: conIntercambio(Inter_600SemiBold),
  Inter_700Bold: conIntercambio(Inter_700Bold),
  Archivo_500Medium: conIntercambio(Archivo_500Medium),
  Archivo_600SemiBold: conIntercambio(Archivo_600SemiBold),
  Archivo_700Bold: conIntercambio(Archivo_700Bold),
};

export const ESPERAR_A_LAS_FUENTES = false;
