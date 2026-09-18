import { StyleSheet } from 'react-native';

import { useTheme } from './use-theme';
import type { ColorSet } from './tokens';

/**
 * Hojas de estilo que sí se enteran del tema.
 *
 * EL PROBLEMA QUE RESUELVE, QUE NO AVISA DE NINGUNA FORMA
 * `StyleSheet.create({ card: { backgroundColor: colors.surface } })` en el cuerpo de un
 * módulo se evalúa UNA VEZ, cuando el módulo se carga. El color queda congelado ahí para
 * el resto de la vida del proceso. Cambiar el tema después no lo toca.
 *
 * Y no se rompe nada: no lanza, no se queda en blanco, no sale en consola. La pantalla
 * simplemente aparece a medias —una tarjeta blanca en un fondo oscuro— y solo se ve
 * mirándola. Con 20 archivos así, «mirar» no es un método.
 *
 * CÓMO FUNCIONA
 * La hoja se declara como una FUNCIÓN del juego de color, y esto devuelve un hook que la
 * resuelve. La hoja ya construida se guarda por juego de color, así que cada tema paga
 * su `StyleSheet.create` una sola vez en toda la vida de la app —no en cada render, que
 * es el error que suele sustituir a este otro—.
 *
 * La clave del caché es la IDENTIDAD del objeto de color, no una cadena: `lightColors` y
 * `darkColors` son constantes de módulo, así que solo pueden existir dos entradas. Con
 * una clave de texto habría que inventar un nombre y mantenerlo sincronizado, que es una
 * tercera cosa que se puede desalinear.
 *
 * ```ts
 * const useEstilos = estilosDelTema((colors) => ({
 *   tarjeta: { backgroundColor: colors.surface },
 * }));
 *
 * function Componente() {
 *   const estilos = useEstilos();
 *   return <View style={estilos.tarjeta} />;
 * }
 * ```
 */
export function estilosDelTema<T extends StyleSheet.NamedStyles<T>>(
  fabrica: (colors: ColorSet) => T & StyleSheet.NamedStyles<T>,
): () => T {
  const cache = new Map<ColorSet, T>();

  return function useEstilos(): T {
    const { colors } = useTheme();
    const guardada = cache.get(colors);
    if (guardada !== undefined) return guardada;
    const hoja = StyleSheet.create(fabrica(colors));
    cache.set(colors, hoja);
    return hoja;
  };
}
