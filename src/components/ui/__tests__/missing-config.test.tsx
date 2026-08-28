import { screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MissingConfigScreen } from '../missing-config';
import { renderWithProviders } from '@/test-utils/render';

jest.mock('@/lib/env', () => ({
  isEnvConfigured: false,
  missingEnvKeys: ['EXPO_PUBLIC_SUPABASE_ANON_KEY'],
}));

/**
 * Falta configuración del entorno (§20).
 *
 * ESTA PRUEBA EXISTE POR UN FALLO CONCRETO: esta comprobación vivía SOLO en
 * `app/index.tsx`, o sea en la ruta `/`, y cualquier otra ruta la saltaba entera.
 * Abrir `/kiosk` directamente en una app sin credenciales de Supabase pintaba el
 * kiosco completo —reloj, teclado, todo— y al teclear el PIN respondía "No pudimos
 * completar la acción. Inténtalo otra vez.", que es un consejo imposible: reintentar
 * no arregla que la app no tenga servidor.
 *
 * Se llega ahí por un enlace directo, por la restauración de ruta al reiniciar la
 * app, y sobre todo por la previsualización web, que es como se revisa esto desde
 * Windows.
 *
 * Lo que se fija aquí son las dos mitades: que la pantalla dice QUÉ falta, y que la
 * comprobación vive en el LAYOUT y no en una ruta. La segunda se comprueba leyendo el
 * archivo, que es feo, y es la única forma sin montar el router entero.
 */
describe('pantalla de configuración faltante', () => {
  it('nombra la clave que falta, no un error genérico', async () => {
    await renderWithProviders(<MissingConfigScreen />);

    expect(screen.getByTestId('missing-config')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_SUPABASE_ANON_KEY/)).toBeTruthy();
  });

  it('dice qué hacer, no solo qué pasó', async () => {
    // §20: "indica qué ocurrió y qué se puede hacer".
    await renderWithProviders(<MissingConfigScreen />);
    expect(screen.getByText(/\.env/)).toBeTruthy();
  });

  it('el guardián vive en el layout raíz, que cubre TODAS las rutas', () => {
    const layout = readFileSync(join(__dirname, '../../../../app/_layout.tsx'), 'utf8');
    expect(layout).toContain('isEnvConfigured');
    expect(layout).toContain('MissingConfigScreen');
  });

  it('y ya NO está duplicado en la ruta de inicio', () => {
    // Dos comprobaciones de la misma precondición se separan: una se actualiza y la
    // otra no. La del layout cubre la ruta de inicio también.
    const index = readFileSync(join(__dirname, '../../../../app/index.tsx'), 'utf8');
    expect(index).not.toContain('isEnvConfigured');
  });
});
