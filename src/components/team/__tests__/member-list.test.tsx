import { screen } from '@testing-library/react-native';

import { MemberList } from '../member-list';
import type { TeamMember } from '@/features/team/hooks';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La lista del equipo virtualiza de verdad (§23).
 *
 * §23 pide listas virtualizadas y la pantalla pintaba `filtered.map(...)` dentro de un
 * `ScrollView`: con doscientos empleados montaba doscientas tarjetas de golpe, y cada
 * letra tecleada en el filtro las volvía a renderizar todas. Con los cuatro empleados de
 * demostración no se nota nada, que es justo por lo que sobrevivió.
 *
 * ESTA PRUEBA ES LA QUE HACE EL CAMBIO COMPROBABLE. La pantalla necesita una sesión de
 * Supabase para tener datos, así que no se puede abrir con trescientos empleados aquí; el
 * componente recibe un array y sí se puede.
 */

function miembro(indice: number): TeamMember {
  return {
    id: `emp-${String(indice).padStart(4, '0')}`,
    organizationId: 'org',
    fullName: `Empleada ${indice}`,
    preferredName: null,
    displayName: `Empleada ${indice}`,
    email: null,
    employeeNumber: null,
    status: 'active',
    hireDate: null,
    userId: null,
    locationIds: [],
    jobRoleIds: [],
  } as unknown as TeamMember;
}

const TRESCIENTOS = Array.from({ length: 300 }, (_, i) => miembro(i));

describe('lista del equipo', () => {
  it('monta las primeras filas y NO las trescientas', async () => {
    await renderWithProviders(
      <MemberList
        members={TRESCIENTOS}
        recentMinutesByMember={new Map()}
        jobRoleNames={new Map()}
        onSelect={() => undefined}
      />,
    );

    // La primera sí está: la lista funciona.
    expect(screen.getByTestId('team-member-emp-0000')).toBeTruthy();

    // Y la 250 no, porque está fuera de la ventana inicial. Si alguien vuelve a poner un
    // `.map()` aquí, esta línea falla: con un map estarían montadas las trescientas.
    expect(screen.queryByTestId('team-member-emp-0250')).toBeNull();
  });

  it('una lista corta se monta entera: virtualizar no puede esconder datos', async () => {
    // La otra mitad. Una prueba que solo comprueba que faltan filas pasaría con una lista
    // que no muestra NADA, y eso sería mucho peor que el problema original.
    const pocos = TRESCIENTOS.slice(0, 3);
    await renderWithProviders(
      <MemberList
        members={pocos}
        recentMinutesByMember={new Map()}
        jobRoleNames={new Map()}
        onSelect={() => undefined}
      />,
    );

    for (const m of pocos) expect(screen.getByTestId(`team-member-${m.id}`)).toBeTruthy();
  });

  it('cada fila muestra sus horas recientes, buscadas por id', async () => {
    // Antes cada fila hacía su propio filter+reduce sobre todos los resúmenes diarios:
    // doscientos recorridos del mismo array en cada render. Ahora se agrega una vez.
    await renderWithProviders(
      <MemberList
        members={[miembro(7)]}
        recentMinutesByMember={new Map([['emp-0007', 510]])}
        jobRoleNames={new Map()}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText(/08:30/)).toBeTruthy();
  });
});
