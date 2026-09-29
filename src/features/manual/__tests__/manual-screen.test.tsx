import { fireEvent } from '@testing-library/react-native';

import { ManualScreen } from '../manual-screen';
import esPE from '@/i18n/locales/es-PE.json';
import { renderWithProviders } from '@/test-utils/render';

/**
 * El manual de uso, que es la única pantalla de la app hecha para leerse y no para
 * operar. Lo que se comprueba es lo que lo hace servir de manual:
 *
 *   - que las dos partes existan y se pueda pasar de una a otra, porque un solo enlace
 *     tiene que servir a quien ficha y a quien administra;
 *   - que el aviso de las CUATRO marcas esté en la parte de quien ficha, porque es lo
 *     único del flujo que no es obvio mirando el reloj y lo que descuadra las horas;
 *   - que el de PUBLICAR esté en la de quien administra, porque un horario en borrador no
 *     existe para el reloj y eso ya costó una mañana;
 *   - y que no pida sesión: se monta sin proveedor de sesión y tiene que pintarse igual.
 */

describe('manual de uso', () => {
  it('abre en la parte de quien ficha, con las cuatro marcas', async () => {
    const view = await renderWithProviders(<ManualScreen />);

    expect(view.getByText(esPE.manual.title)).toBeTruthy();
    expect(view.getByText(esPE.manual.mark1)).toBeTruthy();
    expect(view.getByText(esPE.manual.mark4)).toBeTruthy();
    expect(view.getByText(esPE.manual.marksWhyBody)).toBeTruthy();
  });

  it('explica qué hacer si olvidaste marcar, que es la pregunta del mostrador', async () => {
    const view = await renderWithProviders(<ManualScreen />);
    expect(view.getByText(esPE.manual.caseForgotTitle)).toBeTruthy();
    expect(view.getByText(esPE.manual.caseOfflineTitle)).toBeTruthy();
  });

  it('la parte de administrar empieza por publicar', async () => {
    const view = await renderWithProviders(<ManualScreen />);

    await fireEvent.press(view.getByTestId('manual-parte-administra'));

    expect(view.getByText(esPE.manual.adminPublishTitle)).toBeTruthy();
    expect(view.getByText(esPE.manual.adminKioskTitle)).toBeTruthy();
    // Y lo de quien ficha deja de ocupar sitio: es un manual, no una lista de todo.
    expect(view.queryByText(esPE.manual.marksWhyBody)).toBeNull();
  });

  it('se puede volver a la parte de quien ficha', async () => {
    const view = await renderWithProviders(<ManualScreen />);

    await fireEvent.press(view.getByTestId('manual-parte-administra'));
    await fireEvent.press(view.getByTestId('manual-parte-trabajadora'));

    expect(view.getByText(esPE.manual.mark1)).toBeTruthy();
    expect(view.queryByText(esPE.manual.adminPublishTitle)).toBeNull();
  });
});
