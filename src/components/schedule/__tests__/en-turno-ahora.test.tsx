import { screen } from '@testing-library/react-native';

import { EnTurnoAhora, type PersonaEnTurno } from '../en-turno-ahora';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La franja «En turno ahora» del Horario: quién está en la tienda, y quién almorzando.
 */

const personas: PersonaEnTurno[] = [
  { id: 'e1', nombre: 'Ana Prueba', estado: 'trabajando', motivo: null, desde: '09:55' },
  { id: 'e2', nombre: 'Bea Prueba', estado: 'almorzando', motivo: 'meal', desde: '13:02' },
  { id: 'e3', nombre: 'Cris Prueba', estado: 'descanso', motivo: 'errand', desde: '15:10' },
];

describe('En turno ahora', () => {
  it('sin nadie dentro no ocupa sitio', async () => {
    await renderWithProviders(<EnTurnoAhora personas={[]} />);
    expect(screen.queryByTestId('en-turno-ahora')).toBeNull();
  });

  it('dice quién trabaja, quién almuerza y quién está en otra pausa, y desde cuándo', async () => {
    await renderWithProviders(<EnTurnoAhora personas={personas} />);

    expect(screen.getByText('En turno ahora')).toBeTruthy();
    expect(screen.getByText('3 personas')).toBeTruthy();
    expect(screen.getByText('Trabajando · desde 09:55')).toBeTruthy();
    expect(screen.getByText('Almorzando · desde 13:02')).toBeTruthy();
    // En otra pausa se dice cuál: la comida ya la dice «Almorzando».
    expect(screen.getByText('En descanso · Mandado o encargo · desde 15:10')).toBeTruthy();
    expect(screen.getByTestId('en-turno-e2').props.accessibilityLabel).toBe(
      'Bea Prueba. Almorzando · desde 13:02',
    );
  });
});
