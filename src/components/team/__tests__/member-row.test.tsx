import { screen } from '@testing-library/react-native';

import { MemberRow } from '../member-row';
import type { TeamMember } from '@/features/team/hooks';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La fila de Equipo de quien está trabajando. Antes sus horas eran solo las de jornadas
 * cerradas, así que a media mañana decía lo mismo que si no hubiera venido.
 */

const ana = {
  id: 'e1',
  organizationId: 'org',
  fullName: 'Ana Prueba',
  preferredName: null,
  displayName: 'Ana Prueba',
  email: null,
  employeeNumber: null,
  status: 'active',
  hireDate: null,
  userId: null,
  locationIds: ['l1'],
  jobRoleIds: [],
} as unknown as TeamMember;

function pintar(props: Partial<Parameters<typeof MemberRow>[0]> = {}) {
  return renderWithProviders(
    <MemberRow
      member={ana}
      recentMinutes={1650}
      jobRoleNames={new Map()}
      onPress={() => undefined}
      {...props}
    />,
  );
}

describe('fila de Equipo', () => {
  it('quien está trabajando sale «Trabajando», desde cuándo, y sus horas en curso', async () => {
    await pintar({ dentro: { estado: 'trabajando', desde: '09:55' } });

    expect(screen.getByText('Trabajando')).toBeTruthy();
    expect(screen.getByText('desde 09:55')).toBeTruthy();
    expect(screen.getByTestId('team-member-e1-en-curso')).toHaveTextContent('27:30');
    expect(screen.getByText('en curso')).toBeTruthy();
    // «Activo» deja sitio: dos insignias verdes en la misma fila competirían.
    expect(screen.queryByText('Activo')).toBeNull();
    expect(screen.getByTestId('team-member-e1').props.accessibilityLabel).toMatch(
      /Trabajando, desde 09:55\. .*27:30, en curso/,
    );
  });

  it('en su refrigerio sale «En descanso» y «en pausa»', async () => {
    await pintar({ dentro: { estado: 'descanso', desde: '09:55' } });
    expect(screen.getByText('En descanso')).toBeTruthy();
    expect(screen.getByText('en pausa')).toBeTruthy();
  });

  it('en su almuerzo sale «Almorzando»', async () => {
    await pintar({ dentro: { estado: 'descanso', motivo: 'meal', desde: '09:55' } });
    expect(screen.getByText('Almorzando')).toBeTruthy();
  });

  it('quien no está dentro sigue como siempre', async () => {
    await pintar();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(screen.getByText('27:30')).toBeTruthy();
    expect(screen.queryByText('en curso')).toBeNull();
    expect(screen.queryByTestId('team-member-e1-en-curso')).toBeNull();
  });

  it('en «eliminar varios» es una casilla que dice si está marcada, y no abre la ficha', async () => {
    const onPress = jest.fn();
    await pintar({ marcado: false, onPress });
    const fila = screen.getByTestId('team-member-e1');
    expect(fila.props.accessibilityRole).toBe('checkbox');
    expect(fila).not.toBeChecked();
    expect(screen.getByTestId('team-member-e1-casilla')).toBeTruthy();
  });

  it('marcada, lo dice', async () => {
    await pintar({ marcado: true });
    expect(screen.getByTestId('team-member-e1')).toBeChecked();
  });

  it('fuera de ese modo es la fila de siempre: un botón, sin casilla', async () => {
    await pintar();
    expect(screen.getByTestId('team-member-e1').props.accessibilityRole).toBe('button');
    expect(screen.queryByTestId('team-member-e1-casilla')).toBeNull();
  });
});
