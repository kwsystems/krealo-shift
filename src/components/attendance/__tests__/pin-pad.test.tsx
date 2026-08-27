import { fireEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@/test-utils/render';

import { NumericKeypad, PinDots } from '../pin-pad';

/**
 * Pruebas del teclado y los puntos de PIN (§9.1, §21).
 *
 * Nota sobre la version 14 de React Native Testing Library: `render`, `cleanup` y
 * `fireEvent` son ASINCRONOS. Sin el await, el render queda a medias y todas las
 * pruebas siguientes del archivo fallan con "no se encuentra el testID", que
 * apunta al sitio equivocado.
 *
 * Lo que se comprueba no es que el componente pinte: es que cumpla las dos reglas
 * que hacen seguro un iPad compartido —los dígitos no se anuncian en voz alta, y
 * el progreso sí— y que las teclas grandes lleguen al manejador.
 */

describe('NumericKeypad', () => {
  const handlers = () => ({
    onDigit: jest.fn(),
    onBackspace: jest.fn(),
    onClear: jest.fn(),
  });

  it('llama a onDigit con el dígito pulsado', async () => {
    const h = handlers();
    const view = await renderWithProviders(<NumericKeypad {...h} />);

    await fireEvent.press(view.getByTestId('keypad-7'));
    expect(h.onDigit).toHaveBeenCalledWith('7');

    await fireEvent.press(view.getByTestId('keypad-0'));
    expect(h.onDigit).toHaveBeenCalledWith('0');
  });

  it('tiene las diez teclas numéricas, borrar y retroceso', async () => {
    const view = await renderWithProviders(<NumericKeypad {...handlers()} />);

    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(view.getByTestId(`keypad-${digit}`)).toBeTruthy();
    }
    expect(view.getByTestId('keypad-clear')).toBeTruthy();
    expect(view.getByTestId('keypad-backspace')).toBeTruthy();
  });

  it('separa borrar todo de borrar el último dígito', async () => {
    const h = handlers();
    const view = await renderWithProviders(<NumericKeypad {...h} />);

    await fireEvent.press(view.getByTestId('keypad-clear'));
    expect(h.onClear).toHaveBeenCalledTimes(1);
    expect(h.onBackspace).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('keypad-backspace'));
    expect(h.onBackspace).toHaveBeenCalledTimes(1);
  });

  it('cada tecla tiene una etiqueta de accesibilidad con la acción completa', async () => {
    const view = await renderWithProviders(<NumericKeypad {...handlers()} />);

    // "Dígito 5", no solo "5": VoiceOver debe decir qué hace el botón (§21).
    expect(view.getByLabelText('Dígito 5')).toBeTruthy();
    expect(view.getByLabelText('Borrar todo el PIN')).toBeTruthy();
    expect(view.getByLabelText('Borrar el último dígito')).toBeTruthy();
  });

  it('no dispara nada cuando está deshabilitado', async () => {
    const h = handlers();
    const view = await renderWithProviders(<NumericKeypad {...h} disabled />);

    await fireEvent.press(view.getByTestId('keypad-3'));
    expect(h.onDigit).not.toHaveBeenCalled();
  });

  it('traduce las etiquetas al inglés sin tocar el componente', async () => {
    const view = await renderWithProviders(<NumericKeypad {...handlers()} />, { language: 'en' });
    expect(view.getByLabelText('Digit 5')).toBeTruthy();
    expect(view.getByLabelText('Clear the whole PIN')).toBeTruthy();
  });
});

describe('PinDots', () => {
  it('anuncia el progreso sin leer los dígitos', async () => {
    const view = await renderWithProviders(<PinDots length={6} entered={3} />);

    // Esta es la regla que protege a la persona en un dispositivo compartido: se
    // anuncia "3 de 6", nunca los números que escribió (§21).
    const progress = view.getByLabelText('3 de 6 dígitos ingresados');
    expect(progress).toBeTruthy();
    expect(progress.props.accessibilityHint).toContain('no se leen en voz alta');
  });

  it('respeta la longitud de PIN configurada por la ubicación', async () => {
    const view = await renderWithProviders(<PinDots length={4} entered={0} />);
    expect(view.getByLabelText('0 de 4 dígitos ingresados')).toBeTruthy();

    const wider = await renderWithProviders(<PinDots length={6} entered={6} />);
    expect(wider.getByLabelText('6 de 6 dígitos ingresados')).toBeTruthy();
  });
});
