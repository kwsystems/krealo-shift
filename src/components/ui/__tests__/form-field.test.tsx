import { fireEvent, screen } from '@testing-library/react-native';

import { FormField } from '@app/(auth)/sign-in';
import { renderWithProviders } from '@/test-utils/render';

/**
 * Esta prueba existe por dos motivos, y el segundo importa más que el primero.
 *
 * 1. `FormField` es el campo de formulario que usan el acceso y todas las hojas
 *    del panel administrativo. Que muestre su error y propague lo que se escribe
 *    es lo mínimo.
 *
 * 2. FIJA LA CONFIGURACIÓN DE JEST. `FormField` vive en `app/(auth)/sign-in.tsx`,
 *    así que importarlo arrastra `expo-router` y, por debajo, `standard-navigation`.
 *    Antes de añadir los dos a `transformIgnorePatterns`, cualquier prueba de un
 *    componente de `app/` fallaba con un error de sintaxis que no decía de dónde
 *    venía, y por eso las pantallas con formulario se quedaron sin cobertura.
 *
 *    Si alguien recorta ese patrón, esta prueba falla y explica por qué.
 */

describe('FormField', () => {
  it('se puede importar desde app/ sin romper la transformación de módulos', () => {
    expect(typeof FormField).toBe('function');
  });

  it('muestra la etiqueta y propaga lo que se escribe', async () => {
    const onChangeText = jest.fn();
    await renderWithProviders(
      <FormField label="Correo" testID="campo-correo" onChangeText={onChangeText} />,
    );

    expect(screen.getByText('Correo')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('campo-correo'), 'hola@ejemplo.test');
    expect(onChangeText).toHaveBeenCalledWith('hola@ejemplo.test');
  });

  it('muestra el mensaje de error cuando lo hay', async () => {
    await renderWithProviders(<FormField label="Contraseña" error="Falta la contraseña" />);
    expect(screen.getByText('Falta la contraseña')).toBeTruthy();
  });

  it('sin error no pinta ningún mensaje', async () => {
    await renderWithProviders(<FormField label="Contraseña" />);
    expect(screen.queryByText('Falta la contraseña')).toBeNull();
  });
});
