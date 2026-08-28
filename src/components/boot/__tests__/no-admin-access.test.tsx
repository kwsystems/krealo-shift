import { screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NoAdminAccessScreen } from '../no-admin-access';
import { renderWithProviders } from '@/test-utils/render';

/**
 * Sesión válida que no lleva a ningún panel (§6.2, §20).
 *
 * ESTA PRUEBA EXISTE POR UN CALLEJÓN SIN SALIDA CONCRETO. Una cuenta con membresía
 * de rol `employee` tiene sesión válida y, por §6.2, ninguna navegación personal a
 * la que entrar. `app/index.tsx` no tenía destino para ella y la redirigía a la
 * pantalla de acceso; ahí iniciaba sesión, funcionaba, y la ruta raíz la devolvía al
 * acceso. Encerrada, intentando iniciar sesión en bucle contra una puerta que sí se
 * abría, sin un solo mensaje.
 *
 * Se fija lo que hace falta para que ese estado tenga salida: que se explique, y que
 * ofrezca las dos que existen de verdad.
 */
describe('pantalla de cuenta sin panel', () => {
  it('explica por qué no hay panel, en vez de rebotar al acceso', async () => {
    await renderWithProviders(<NoAdminAccessScreen />);

    expect(screen.getByTestId('no-admin-access')).toBeTruthy();
    // §20: qué ocurrió y qué se puede hacer. Lo segundo es lo que faltaba.
    expect(screen.getByText(/empleado/i)).toBeTruthy();
    expect(screen.getByText(/PIN/)).toBeTruthy();
  });

  it('ofrece las dos salidas reales: otra cuenta, o fichar en el iPad', async () => {
    await renderWithProviders(<NoAdminAccessScreen />);

    expect(screen.getByTestId('no-admin-sign-out')).toBeTruthy();
    expect(screen.getByTestId('no-admin-setup-kiosk')).toBeTruthy();
  });

  it('la ruta raíz la pinta en vez de redirigir al acceso', () => {
    const index = readFileSync(join(__dirname, '../../../../app/index.tsx'), 'utf8');
    expect(index).toContain('NoAdminAccessScreen');
  });

  it('la resolución de arranque no está duplicada en las dos rutas', () => {
    /*
     * El fallo nació de tener la misma cadena de decisiones escrita dos veces: se
     * mantiene una y la otra se queda atrás. Las dos rutas tienen que leer la misma
     * función, y por eso mismo no pueden rebotarse la una a la otra.
     */
    const index = readFileSync(join(__dirname, '../../../../app/index.tsx'), 'utf8');
    const panel = readFileSync(join(__dirname, '../../../../app/(manager)/_layout.tsx'), 'utf8');

    for (const archivo of [index, panel]) {
      expect(archivo).toContain('useBootResolution');
      // Ninguna de las dos vuelve a deducir el rol por su cuenta.
      expect(archivo).not.toContain('canUseAdminPanel');
      expect(archivo).not.toContain('useManagerMembership');
    }
  });
});
