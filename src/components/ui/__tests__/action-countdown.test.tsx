import { act, fireEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@/test-utils/render';

import { ActionCountdown } from '../action-countdown';

/**
 * Pruebas de la cuenta regresiva (§5, §9.4).
 *
 * Este componente existe por una razón concreta: evitar que alguien marque salida
 * cuando quería iniciar descanso. Lo que se comprueba es justamente eso —que se
 * pueda cancelar antes de que termine, y que no se dispare dos veces.
 */

describe('ActionCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const advance = async (seconds: number) => {
    for (let i = 0; i < seconds; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
  };

  it('completa la acción cuando la cuenta llega a cero', async () => {
    const onComplete = jest.fn();
    const onCancel = jest.fn();

    await renderWithProviders(
      <ActionCountdown seconds={3} onComplete={onComplete} onCancel={onCancel} />,
    );

    expect(onComplete).not.toHaveBeenCalled();

    await advance(3);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('no completa la acción si se cancela antes', async () => {
    const onComplete = jest.fn();
    const onCancel = jest.fn();

    const view = await renderWithProviders(
      <ActionCountdown seconds={3} onComplete={onComplete} onCancel={onCancel} />,
    );

    await advance(1);
    await fireEvent.press(view.getByTestId('countdown-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('dispara la acción una sola vez, aunque el tiempo siga corriendo', async () => {
    const onComplete = jest.fn();

    await renderWithProviders(
      <ActionCountdown seconds={2} onComplete={onComplete} onCancel={jest.fn()} />,
    );

    await advance(6);

    // Un doble disparo crearía dos fichajes. La idempotencia del servidor lo
    // atraparía, pero el componente no debe provocarlo en primer lugar.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('el botón de cancelar está visible desde el primer segundo', async () => {
    const view = await renderWithProviders(
      <ActionCountdown seconds={3} onComplete={jest.fn()} onCancel={jest.fn()} />,
    );

    // "Cancelar" siempre visible mientras corre: si apareciera al final, no
    // serviría para lo que existe (§9.4).
    expect(view.getByTestId('countdown-cancel')).toBeTruthy();
    expect(view.getByLabelText('Cancelar')).toBeTruthy();
  });

  it('anuncia los segundos restantes para VoiceOver', async () => {
    const view = await renderWithProviders(
      <ActionCountdown seconds={3} onComplete={jest.fn()} onCancel={jest.fn()} />,
    );

    expect(
      view.getByLabelText('Se registrará en 3 segundos. Toca cancelar para detenerlo.'),
    ).toBeTruthy();
  });
});
