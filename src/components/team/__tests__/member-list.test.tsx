import { screen } from '@testing-library/react-native';

import { MemberList } from '../member-list';
import type { TeamMember } from '@/features/team/hooks';
import { renderWithProviders } from '@/test-utils/render';

const SEMANA_VACIA = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
].map((dia) => ({ dia, minutos: 0, esHoy: dia === '2026-09-30', futuro: dia > '2026-09-30' }));

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
        semanaPorMiembro={new Map()}
        semanaVacia={SEMANA_VACIA}
        escala={600}
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
        semanaPorMiembro={new Map()}
        semanaVacia={SEMANA_VACIA}
        escala={600}
        jobRoleNames={new Map()}
        onSelect={() => undefined}
      />,
    );

    for (const m of pocos) expect(screen.getByTestId(`team-member-${m.id}`)).toBeTruthy();
  });

  it('cada fila muestra su semana, buscada por id: el total y cada día en la tira', async () => {
    // Antes cada fila hacía su propio filter+reduce sobre todos los resúmenes diarios:
    // doscientos recorridos del mismo array en cada render. Ahora se agrega una vez.
    const dias = SEMANA_VACIA.map((dia, i) => ({
      ...dia,
      minutos: i === 0 ? 510 : i === 1 ? 240 : 0,
    }));
    await renderWithProviders(
      <MemberList
        members={[miembro(7)]}
        semanaPorMiembro={new Map([['emp-0007', { minutos: 750, dias }]])}
        semanaVacia={SEMANA_VACIA}
        escala={600}
        jobRoleNames={new Map()}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByTestId('team-member-emp-0007-semana-total')).toHaveTextContent('12:30');
    // Una columna por día trabajado, ninguna por los días sin horas.
    // La tira es `aria-hidden` —el nombre de la fila ya lo dice—, así que se busca incluyendo
    // lo oculto al lector de pantalla.
    const oculto = { includeHiddenElements: true };
    expect(screen.getByTestId('team-member-emp-0007-semana-2026-09-28', oculto)).toBeTruthy();
    expect(screen.getByTestId('team-member-emp-0007-semana-2026-09-29', oculto)).toBeTruthy();
    expect(screen.queryByTestId('team-member-emp-0007-semana-2026-09-30', oculto)).toBeNull();
    // Y lo que la tira enseña, dicho para quien no la ve.
    expect(screen.getByTestId('team-member-emp-0007').props.accessibilityLabel).toMatch(
      /Esta semana: 12:30\. lun 08:30, mar 04:00/,
    );
  });

  /**
   * SIN SEDE NO SE PUEDE FICHAR, y la fila tiene que decirlo.
   *
   * El reloj esta atado a una tienda y solo ofrece a quien trabaja alli, asi que un
   * empleado sin sede existe y no puede trabajar. Ademas es el estado en el que los
   * dejaba un guardado a medias, y durante un tiempo eran INVISIBLES: el filtro de la
   * pantalla exigia que la sede elegida estuviera entre las suyas, y con cero sedes eso
   * no se cumple en ninguna pestaña. Existian en la base y no habia forma de abrirlos.
   */
  it('avisa de quien no tiene ninguna sede', async () => {
    await renderWithProviders(
      <MemberList
        members={[miembro(0)]}
        semanaPorMiembro={new Map()}
        semanaVacia={SEMANA_VACIA}
        escala={600}
        jobRoleNames={new Map()}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText('Sin sede: no puede fichar')).toBeTruthy();
  });
});
