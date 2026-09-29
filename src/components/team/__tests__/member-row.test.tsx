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

  it('quien no está dentro sigue como siempre', async () => {
    await pintar();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(screen.getByText('27:30')).toBeTruthy();
    expect(screen.queryByText('en curso')).toBeNull();
    expect(screen.queryByTestId('team-member-e1-en-curso')).toBeNull();
  });
});
