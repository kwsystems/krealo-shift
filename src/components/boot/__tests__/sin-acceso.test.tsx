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
