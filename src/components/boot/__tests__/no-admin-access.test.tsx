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

/**
 * Guarda del grupo de acceso (§8).
 *
 * ES LA MISMA CLASE DE FALLO, y era el más visible de todos: iniciar sesión con
 * éxito no llevaba a ninguna parte. `sign-in.tsx` no navega a propósito, confiando en
 * que "la ruta raíz redirige según rol"; pero a `/sign-in` se llega con un
 * `<Redirect>`, o sea un `router.replace`, que DESMONTA la ruta raíz. La sesión se
 * creaba, el botón dejaba de girar, no había error, y la persona seguía mirando el
 * formulario.
 */
describe('guarda del grupo de acceso', () => {
  const layout = readFileSync(join(__dirname, '../../../../app/(auth)/_layout.tsx'), 'utf8');

  it('el layout del grupo saca de ahí a quien ya tiene sesión', () => {
    // Era un `<Stack>` pelado, sin una sola condición.
    expect(layout).toContain('useBootResolution');
    expect(layout).toContain('Redirect');
  });

  it('sale por la ruta raíz, que es el único sitio que mapea destinos a pantallas', () => {
    expect(layout).toContain('href="/"');
  });

  it('no puede entrar en bucle con la ruta raíz', () => {
    /*
     * `app/index.tsx` manda al acceso solo con el destino `signIn`, y el acceso sale
     * solo con cualquier otro. Al leer las dos la misma función, para un mismo estado
     * se cumple exactamente una de las dos condiciones. Si alguna de las dos dejara de
     * usar la resolución compartida, este par de aserciones se cae.
     */
    const index = readFileSync(join(__dirname, '../../../../app/index.tsx'), 'utf8');
    expect(index).toContain("case 'signIn':");
    expect(layout).toContain("destination.kind !== 'signIn'");
  });

  it('la pantalla de contraseña nueva vive FUERA del grupo de acceso', () => {
    /*
     * Un enlace de recuperación crea una sesión real, así que la guarda de arriba
     * echaría de la pantalla a la persona justo antes de dejarla escribir la
     * contraseña. Si alguien mueve el archivo dentro de `(auth)`, la recuperación deja
     * de funcionar sin que falle nada más.
     */
    const ruta = join(__dirname, '../../../../app/restablecer.tsx');
    expect(readFileSync(ruta, 'utf8')).toContain('exchangeRecoveryCode');
  });
});
