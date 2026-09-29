import { fireEvent, screen } from '@testing-library/react-native';

import { AccesoPorCorreo } from '../acceso-por-correo';
import { renderWithProviders } from '@/test-utils/render';

/**
 * «Entrar con tu correo»: pedir el enlace, y volver con él. Lo que se comprueba es lo que
 * decide si alguien sin Google puede entrar: que el enlace se pida para el correo escrito,
 * que al volver con él se entre solo si el correo está recordado, que se pida el correo
 * si se abrió en otro dispositivo, y que un enlace gastado lo diga en palabras.
 */

const mockLib = {
  direccion: null as string | null,
  recordado: null as string | null,
  enviarEnlace: jest.fn(async () => undefined),
  completarConEnlace: jest.fn(async () => undefined),
};

jest.mock('@/lib/firebase/enlace-por-correo', () => ({
  direccionActual: () => mockLib.direccion,
  esEnlaceDeAcceso: (href: string) => href.includes('oobCode='),
  correoRecordado: () => mockLib.recordado,
  enviarEnlace: (...args: unknown[]) => mockLib.enviarEnlace(...(args as [])),
  completarConEnlace: (...args: unknown[]) => mockLib.completarConEnlace(...(args as [])),
}));

const ENLACE = 'https://krealo-shift.web.app/sign-in?mode=signIn&oobCode=abc&apiKey=k';

beforeEach(() => {
  mockLib.direccion = null;
  mockLib.recordado = null;
  mockLib.enviarEnlace.mockReset().mockResolvedValue(undefined);
  mockLib.completarConEnlace.mockReset().mockResolvedValue(undefined);
});

describe('entrar con tu correo', () => {
  it('arranca plegado: un botón y nada más', async () => {
    await renderWithProviders(<AccesoPorCorreo />);
    expect(screen.getByTestId('sign-in-email-open')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-email-field')).toBeNull();
  });

  it('no manda nada con un correo sin forma de correo', async () => {
    await renderWithProviders(<AccesoPorCorreo />);
    await fireEvent.press(screen.getByTestId('sign-in-email-open'));
    await fireEvent.changeText(screen.getByTestId('sign-in-email-field'), 'persona@');
    await fireEvent.press(screen.getByTestId('sign-in-email-send'));
    expect(mockLib.enviarEnlace).not.toHaveBeenCalled();
    expect(screen.getAllByText('Ese correo no parece válido.').length).toBeGreaterThan(0);
  });

  it('pide el enlace para el correo escrito y dice a dónde llegó', async () => {
    await renderWithProviders(<AccesoPorCorreo />);
    await fireEvent.press(screen.getByTestId('sign-in-email-open'));
    await fireEvent.changeText(screen.getByTestId('sign-in-email-field'), ' Persona@Empresa.com ');
    await fireEvent.press(screen.getByTestId('sign-in-email-send'));
    expect(mockLib.enviarEnlace).toHaveBeenCalledWith(' Persona@Empresa.com ', expect.any(String));
    expect(await screen.findByTestId('sign-in-email-sent')).toBeTruthy();
    expect(screen.getByText(/persona@empresa\.com/)).toBeTruthy();
  });

  it('al volver con el enlace y el correo recordado, entra sola', async () => {
    mockLib.direccion = ENLACE;
    mockLib.recordado = 'persona@empresa.com';
    await renderWithProviders(<AccesoPorCorreo />);
    expect(screen.getByTestId('sign-in-email-completing')).toBeTruthy();
    expect(mockLib.completarConEnlace).toHaveBeenCalledWith('persona@empresa.com', ENLACE);
  });

  it('abierto en otro dispositivo, pide el correo antes de entrar', async () => {
    mockLib.direccion = ENLACE;
    await renderWithProviders(<AccesoPorCorreo />);
    expect(screen.getByText('¿A qué correo llegó el enlace?')).toBeTruthy();
    expect(mockLib.completarConEnlace).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('sign-in-email-field'), 'persona@empresa.com');
    await fireEvent.press(screen.getByTestId('sign-in-email-complete'));
    expect(mockLib.completarConEnlace).toHaveBeenCalledWith('persona@empresa.com', ENLACE);
  });

  it('un enlace gastado lo dice, y deja pedir otro', async () => {
    mockLib.direccion = ENLACE;
    mockLib.recordado = 'persona@empresa.com';
    mockLib.completarConEnlace.mockRejectedValue({ code: 'auth/invalid-action-code' });
    await renderWithProviders(<AccesoPorCorreo />);
    expect(await screen.findByText('Este enlace ya se usó o caducó. Pide otro.')).toBeTruthy();
    expect(screen.getByTestId('sign-in-email-send')).toBeTruthy();
  });

  it('si el acceso por correo no está activado, lo dice en vez de un error técnico', async () => {
    mockLib.enviarEnlace.mockRejectedValue({ code: 'auth/operation-not-allowed' });
    await renderWithProviders(<AccesoPorCorreo />);
    await fireEvent.press(screen.getByTestId('sign-in-email-open'));
    await fireEvent.changeText(screen.getByTestId('sign-in-email-field'), 'persona@empresa.com');
    await fireEvent.press(screen.getByTestId('sign-in-email-send'));
    expect(await screen.findByTestId('sign-in-email-error')).toBeTruthy();
    expect(screen.getByText(/todavía no está activado/)).toBeTruthy();
  });
});
