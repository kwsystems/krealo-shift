import { StyleSheet } from 'react-native';
import { screen } from '@testing-library/react-native';

import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/layout';
import { renderWithProviders } from '@/test-utils/render';

/**
 * Un marco de color puesto a una tarjeta tiene que llegar a los CUATRO lados.
 *
 * La tarjeta trae un filo propio arriba, y en React Native el borde de un lado gana al
 * general sea cual sea el orden. Por eso los avisos del manual salieron publicados con la
 * tapa de arriba quitada (30-sep). Se mira el estilo aplanado, que es lo que pinta: el
 * orden de la lista no dice nada, porque ahí el marco ya iba el último y aun así perdía.
 */

const plano = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

describe('Card con marco', () => {
  it('el color del marco llega también al borde de arriba', async () => {
    await renderWithProviders(
      <Card testID="aviso" style={{ borderColor: '#7157e8', borderWidth: 2 }}>
        <AppText>Son cuatro, no dos</AppText>
      </Card>,
    );
    expect(plano('aviso')).toMatchObject({
      borderColor: '#7157e8',
      borderTopColor: '#7157e8',
      borderWidth: 2,
      borderTopWidth: 2,
    });
  });

  it('si quien la usa pide otro borde arriba, se respeta', async () => {
    await renderWithProviders(
      <Card testID="aviso" style={{ borderColor: '#7157e8', borderTopColor: '#e11d48' }}>
        <AppText>Arriba en otro color</AppText>
      </Card>,
    );
    expect(plano('aviso').borderTopColor).toBe('#e11d48');
  });

  it('sin marco, la tarjeta conserva su filo de arriba', async () => {
    await renderWithProviders(
      <Card testID="normal">
        <AppText>Sin marco</AppText>
      </Card>,
    );
    const estilo = plano('normal');
    expect(estilo.borderColor).toBeUndefined();
    expect(estilo.borderTopWidth).toBeGreaterThan(0);
  });
});
