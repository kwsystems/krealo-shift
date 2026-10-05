import { fireEvent, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ErrorDeMembresia } from '../sin-acceso';
import { AdminError } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { renderWithProviders } from '@/test-utils/render';

/**
 * Una cuenta que entró y no tiene acceso a ninguna empresa (30-sep).
 *
 * Una administradora recién invitada veía «Sin permiso · Tu rol no permite ver esto.
 * Pídeselo a un administrador» —falso: no tenía rol, y quien la invitó ya lo había
 * hecho—, sin saber con qué correo había entrado y sin forma de salir. Se fija que ahora
 * lo diga como es, con su correo, y con las dos salidas.
 */
describe('cuenta sin acceso a ninguna empresa', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: { userId: 'uid-x', email: 'invitada@example.com' } });
  });

  it('dice con qué correo entró y qué hacer, no «tu rol no permite»', async () => {
    await renderWithProviders(
      <ErrorDeMembresia error={new AdminError('forbidden', 'NO_MEMBERSHIP')} onRetry={() => {}} />,
    );
    expect(screen.getByTestId('sin-acceso')).toBeTruthy();
    expect(screen.getByTestId('sin-acceso-correo')).toHaveTextContent(/invitada@example\.com/);
    expect(screen.queryByText(/Tu rol no permite/)).toBeNull();
  });

  it('reintentar vuelve a probar el canje, y hay forma de entrar con otro correo', async () => {
    const reintentar = jest.fn();
    await renderWithProviders(
      <ErrorDeMembresia
        error={new AdminError('forbidden', 'NO_MEMBERSHIP')}
        onRetry={reintentar}
      />,
    );
    fireEvent.press(screen.getByTestId('sin-acceso-retry'));
    expect(reintentar).toHaveBeenCalled();
    expect(screen.getByTestId('sin-acceso-sign-out')).toBeTruthy();
  });

  /*
   * Y POR QUÉ NO SE UNIÓ A SU FICHA (5-oct): el motivo viaja en el código del error. Con
   * el correo en dos fichas no se le habla de invitaciones: eso la mandaba a pedir lo que
   * ya estaba hecho.
   */
  it('dice el motivo cuando el servidor lo sabe', async () => {
    await renderWithProviders(
      <ErrorDeMembresia
        error={new AdminError('forbidden', 'NO_MEMBERSHIP', 'correo-repetido')}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId('sin-acceso-motivo-correo-repetido')).toHaveTextContent(
      /está en dos fichas[\s\S]*invitada@example\.com/,
    );
    expect(screen.queryByText(/Si te invitaron/)).toBeNull();
  });

  it('a quien se le quitó el acceso se lo dice', async () => {
    await renderWithProviders(
      <ErrorDeMembresia
        error={new AdminError('forbidden', 'NO_MEMBERSHIP', 'acceso-retirado')}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId('sin-acceso-motivo-acceso-retirado')).toHaveTextContent(
      /Te quitaron el acceso/,
    );
  });

  it('un motivo desconocido no rompe nada: queda el texto de siempre', async () => {
    await renderWithProviders(
      <ErrorDeMembresia
        error={new AdminError('forbidden', 'NO_MEMBERSHIP', 'motivo-del-futuro')}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Si te invitaron/)).toBeTruthy();
  });

  it('cualquier otro fallo sigue siendo el error de siempre', async () => {
    await renderWithProviders(
      <ErrorDeMembresia error={new AdminError('offline')} onRetry={() => {}} />,
    );
    expect(screen.queryByTestId('sin-acceso')).toBeNull();
  });

  it('las tres guardas de arranque la usan', () => {
    for (const ruta of [
      'app/index.tsx',
      'app/(manager)/_layout.tsx',
      'app/(employee)/_layout.tsx',
    ]) {
      const codigo = readFileSync(join(__dirname, '../../../..', ruta), 'utf8');
      expect(codigo).toContain('ErrorDeMembresia');
    }
  });
});
