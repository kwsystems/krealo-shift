import { View, type ViewProps } from 'react-native';

/**
 * En la web no hace falta la raíz de gesture-handler (28-oct): ninguna pantalla web usa sus
 * gestos, y su raíz arrastraba el paquete entero a la primera carga. Ver `metro.config.js`.
 */
export function RaizDeGestos(props: ViewProps) {
  return <View {...props} />;
}
