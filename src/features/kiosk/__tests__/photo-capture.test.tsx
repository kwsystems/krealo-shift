import { act } from '@testing-library/react-native';

import { renderWithProviders } from '@/test-utils/render';

import { PhotoCapture, type PhotoResult } from '../photo-capture';

/**
 * LA FOTO DEL RELOJ WEB NO SE TOMABA NUNCA, y esta prueba fija por qué.
 *
 * `expo-camera` en el navegador avisa `onCameraReady` en cuanto tiene el stream, antes
 * de que el `<video>` haya recibido un fotograma, y `takePictureAsync` en ese instante
 * lanza `ERR_CAMERA_NOT_READY`. El componente disparaba la captura justo en ese aviso,
 * así que fallaba SIEMPRE —medido con Playwright: en menos de 1,5 s—, y como en web la
 * foto es obligatoria, nadie podía fichar desde un navegador.
 *
 * El módulo se simula porque aquí no hay cámara: lo que se comprueba es la
 * conversación con ella —cuántas veces se insiste, con qué opciones, y qué se le dice
 * a la pantalla al final—, que es exactamente lo que estaba mal.
 */

const mockTakePicture = jest.fn();

jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  const CameraView = React.forwardRef<unknown, { onCameraReady?: () => void }>(
    function CameraViewSimulada({ onCameraReady }, ref) {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: (...args: unknown[]) => mockTakePicture(...args),
      }));
      // Como en web: «lista» en cuanto se monta, tenga o no un fotograma que dar.
      React.useEffect(() => {
        onCameraReady?.();
      }, [onCameraReady]);
      return React.createElement(View, { testID: 'camara-simulada' });
    },
  );

  return {
    CameraView,
    useCameraPermissions: () => [
      { granted: true, canAskAgain: false, status: 'granted', expires: 'never' },
      jest.fn(),
    ],
  };
});

const noLista = () =>
  Object.assign(new Error('HTMLVideoElement does not have enough camera data'), {
    code: 'ERR_CAMERA_NOT_READY',
  });

const FOTO = { uri: 'data:image/jpeg;base64,QUJD', width: 640, height: 480 };

/** Deja pasar `ms` de reloj falso dejando resolver las promesas intermedias. */
const pasar = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

describe('PhotoCapture cuando la cámara dice que aún no está lista', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockTakePicture.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('insiste hasta que la cámara entrega la foto, y la entrega como JPEG', async () => {
    mockTakePicture
      .mockRejectedValueOnce(noLista())
      .mockRejectedValueOnce(noLista())
      .mockResolvedValue(FOTO);
    const onResult = jest.fn<void, [PhotoResult]>();

    await renderWithProviders(<PhotoCapture onResult={onResult} />);
    await pasar(1000);

    expect(mockTakePicture).toHaveBeenCalledTimes(3);
    // JPEG explícito: en web el valor por defecto es PNG, que el servidor no espera y
    // pesa diez veces más. En nativo la opción se ignora.
    expect(mockTakePicture).toHaveBeenCalledWith(
      expect.objectContaining({ imageType: 'jpg', quality: 0.5 }),
    );
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ status: 'captured', uri: FOTO.uri });
  });

  it('se rinde con un tope y entonces sí avisa de que falló', async () => {
    mockTakePicture.mockRejectedValue(noLista());
    const onResult = jest.fn<void, [PhotoResult]>();

    await renderWithProviders(<PhotoCapture onResult={onResult} />);
    await pasar(5000);
    // A medio camino sigue esperando: no se declara el fallo antes de tiempo.
    expect(onResult).not.toHaveBeenCalled();

    await pasar(5000);
    expect(onResult).toHaveBeenCalledWith({ status: 'skipped', reason: 'failed' });
    // 40 intentos a 200 ms: 8 s, por debajo del plazo de 12 s de la pantalla, para que
    // el fallo lo declare este componente y no el cronómetro de fuera.
    expect(mockTakePicture).toHaveBeenCalledTimes(40);
  });

  it('cualquier otro error de la cámara falla a la primera, sin insistir', async () => {
    mockTakePicture.mockRejectedValue(new Error('la cámara se desconectó'));
    const onResult = jest.fn<void, [PhotoResult]>();

    await renderWithProviders(<PhotoCapture onResult={onResult} />);
    await pasar(1000);

    expect(mockTakePicture).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ status: 'skipped', reason: 'failed' });
  });

  it('si la persona cancela a media espera, no avisa a nadie', async () => {
    mockTakePicture.mockRejectedValue(noLista());
    const onResult = jest.fn<void, [PhotoResult]>();

    const vista = await renderWithProviders(<PhotoCapture onResult={onResult} />);
    await pasar(1000);
    // En React Native Testing Library 14 `unmount` es asíncrono, igual que `render`.
    await vista.unmount();
    await pasar(10000);

    expect(onResult).not.toHaveBeenCalled();
  });
});
