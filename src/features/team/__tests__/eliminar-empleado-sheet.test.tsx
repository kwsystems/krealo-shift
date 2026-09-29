import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { EliminarEmpleadoSheet } from '../eliminar-empleado-sheet';
import type { TeamMember } from '../hooks';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La hoja de «Eliminar definitivamente»: dice cuánto se va a borrar ANTES de pedir nada, y
 * el botón no se habilita hasta escribir el nombre completo. El resto del equipo ya está
 * usando la app; un toque en la fila equivocada no puede borrar a nadie.
 */

jest.mock('../api', () => ({
  previewDeleteEmployee: jest.fn(async () => ({
    nombre: 'Ana Prueba Lara',
    recuento: {
      fichajes: 5,
      jornadas: 2,
      turnos: 3,
      descansosLibres: 1,
      solicitudes: 0,
      correcciones: 0,
      otros: 1,
    },
  })),
}));

const ana = {
  id: 'e1',
  full_name: 'Ana Prueba Lara',
  displayName: 'Ana',
  status: 'inactive',
} as unknown as TeamMember;

async function pintar(onConfirm = jest.fn()) {
  // `gcTime: Infinity`: sin él la caché deja un temporizador vivo y Jest no termina nunca.
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await renderWithProviders(
    <QueryClientProvider client={cliente}>
      <EliminarEmpleadoSheet
        member={ana}
        busy={false}
        error={null}
        onConfirm={onConfirm}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
  return onConfirm;
}

describe('eliminar a un empleado de prueba', () => {
  it('dice cuánto se va a borrar', async () => {
    await pintar();
    expect(await screen.findByTestId('employee-delete-counts')).toBeTruthy();
    expect(screen.getByText('Jornadas')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('no borra hasta escribir el nombre completo, y entonces sí', async () => {
    const onConfirm = await pintar();
    await screen.findByTestId('employee-delete-counts');

    await fireEvent.press(screen.getByTestId('employee-delete-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('employee-delete-name'), 'Ana');
    await fireEvent.press(screen.getByTestId('employee-delete-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    // Sin distinguir mayúsculas ni espacios de más: lo que importa es el nombre.
    await fireEvent.changeText(screen.getByTestId('employee-delete-name'), ' ana prueba lara ');
    await fireEvent.press(screen.getByTestId('employee-delete-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(' ana prueba lara ');
  });
});
