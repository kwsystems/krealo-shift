import { Platform } from 'react-native';

/**
 * LO QUE ES MARCO (13-oct): la cabecera, el menú lateral, la banda del saludo del celular y
 * el panel de la esfera del acceso son oscuros EN LOS DOS TEMAS, a propósito —la carcasa del
 * reloj marcador; ver `marco` en `tokens.ts`—. Se marcan con `data-marco` para que
 * `tema-check` los reconozca, igual que reconoce un `role="img"` como marca de datos: una
 * superficie oscura en el tema claro que NO lleve esta marca sigue siendo un fallo.
 */
export function propsDelMarco(): Record<string, unknown> {
  return Platform.OS === 'web' ? { dataSet: { marco: 'si' } } : {};
}
