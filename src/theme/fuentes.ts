import {
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

/**
 * Las fuentes de la app en iOS y Android. La web tiene las suyas: `fuentes.web.ts`.
 *
 * ARCHIVO es la cara de los títulos y del reloj (ver `fontFamily.display` en los tokens y
 * `docs/DISENO.md`). Van los TRES pesos que los tokens nombran: si falta uno, ese cae a la
 * fuente del sistema sin avisar y el título se ve en otra letra.
 */
export const FUENTES = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
};

/** En el teléfono el splash tapa la espera, y sin ella el primer texto saltaría de letra. */
export const ESPERAR_A_LAS_FUENTES = true;
