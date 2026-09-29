import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { EliminarVariosSheet } from '../eliminar-varios-sheet';
import type { TeamMember } from '../hooks';
import { renderWithProviders } from '@/test-utils/render';

/**
 * «Eliminar varios»: la lista con todos los nombres y lo que se borra de cada uno ANTES
 * de pedir nada, y el botón quieto hasta escribir la palabra. Que sean varios no afloja
 * lo que protege al resto del equipo.
 */

const recuentos: Record<string, number> = { e1: 2, e2: 3 };
jest.mock('../api', () => ({
  previewDeleteEmployee: jest.fn(async (id: string) => ({
    nombre: id,
    recuento: {
      fichajes: (recuentos[id] ?? 0) * 4,
      jornadas: recuentos[id] ?? 0,
      turnos: 1,
      descansosLibres: 0,
      solicitudes: 0,
      correcciones: 0,
      otros: 0,
    },
  })),
}));

const persona = (id: string, nombre: string) =>
  ({ id, full_name: nombre, displayName: nombre, status: 'inactive' }) as unknown as TeamMember;

const LOS_DOS = [persona('e1', 'Ana Prueba'), persona('e2', 'Joseph Prueba')];

async function pintar(extra: { progreso?: number | null; fallidos?: string[] } = {}) {
  const onConfirm = jest.fn();
  // `gcTime: Infinity`: sin él la caché deja un temporizador vivo y Jest no termina nunca.
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await renderWithProviders(
    <QueryClientProvider client={cliente}>
      <EliminarVariosSheet
        members={LOS_DOS}
        progreso={extra.progreso ?? null}
        fallidos={extra.fallidos ?? []}
        onConfirm={onConfirm}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
  return onConfirm;
}

describe('eliminar varios empleados de prueba', () => {
  it('nombra a cada uno con lo suyo, y suma el total', async () => {
    await pintar();
    expect(await screen.findByTestId('team-delete-many-totals')).toBeTruthy();
    expect(screen.getByText('Ana Prueba')).toBeTruthy();
    expect(screen.getByText('Joseph Prueba')).toBeTruthy();
    expect(screen.getByText('Jornadas 2 · Fichajes 8 · Turnos 1')).toBeTruthy();
    expect(screen.getByText('Jornadas 3 · Fichajes 12 · Turnos 1')).toBeTruthy();
    // Jornadas 2 + 3 y fichajes 8 + 12.
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('no borra hasta escribir la palabra, sin importar mayúsculas', async () => {
    const onConfirm = await pintar();
    await screen.findByTestId('team-delete-many-totals');

    await fireEvent.press(screen.getByTestId('team-delete-many-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('team-delete-many-word'), 'elimina');
    await fireEvent.press(screen.getByTestId('team-delete-many-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('team-delete-many-word'), ' eliminar ');
    await fireEvent.press(screen.getByTestId('team-delete-many-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('dice por quién va mientras borra', async () => {
    await pintar({ progreso: 1 });
    expect(await screen.findByText('Eliminando 1 de 2…')).toBeTruthy();
  });

  it('si alguien no se pudo borrar, lo nombra', async () => {
    await pintar({ fallidos: ['Joseph Prueba'] });
    expect(screen.getByTestId('team-delete-many-failed')).toBeTruthy();
    expect(screen.getByText(/No se pudo eliminar a: Joseph Prueba/)).toBeTruthy();
  });
});
