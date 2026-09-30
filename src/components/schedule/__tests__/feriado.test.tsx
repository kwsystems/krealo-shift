import { screen } from '@testing-library/react-native';

import { EtiquetaDeFeriado } from '@/components/schedule/feriado';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La etiqueta que ven igual quien arma el horario y quien lo cumple (30-sep): Horario, la
 * lista del día en el teléfono y la vista de cada vendedor la usan tal cual.
 */
describe('EtiquetaDeFeriado', () => {
  it('dice qué feriado es, en una sede del Perú', async () => {
    await renderWithProviders(<EtiquetaDeFeriado dateKey="2026-10-08" timezone="America/Lima" />);
    expect(screen.getByText('Feriado · Combate de Angamos')).toBeTruthy();
  });

  it('en inglés, con el nombre traducido', async () => {
    await renderWithProviders(<EtiquetaDeFeriado dateKey="2026-07-28" timezone="America/Lima" />, {
      language: 'en',
    });
    expect(screen.getByText('Holiday · Independence Day')).toBeTruthy();
  });

  it('nada en un día normal ni en una sede de otro país', async () => {
    await renderWithProviders(
      <>
        <EtiquetaDeFeriado dateKey="2026-10-09" timezone="America/Lima" />
        <EtiquetaDeFeriado dateKey="2026-10-08" timezone="America/Toronto" />
      </>,
    );
    expect(screen.queryByText(/Feriado/)).toBeNull();
  });
});
