import {
  exchangeRecoveryCode,
  recoveryRedirectUrl,
  sendPasswordReset,
  updatePassword,
} from '../password-reset';

const mockResetPasswordForEmail = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockGetSupabase = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

jest.mock('expo-linking', () => ({
  createURL: (ruta: string) => `krealoshift://${String(ruta).replace(/^\//, '')}`,
}));

const clienteFalso = {
  auth: {
    resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args),
    exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
    getSession: () => mockGetSession(),
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  },
};

/** Error de Supabase Auth: lo que importa son `status` y `name`, no el texto. */
const errorAuth = (status: number, message = 'algo', name = 'AuthApiError') =>
  Object.assign(new Error(message), { status, name });

/**
 * Lo que supabase-js devuelve de VERDAD cuando `fetch` falla.
 *
 * No es una excepción cruda ni un error sin estado: es un `AuthRetryableFetchError`
 * con `status: 0`. Esta forma es la que hacía fallar la detección anterior.
 */
const errorDeRed = (message = 'Network request failed') =>
  Object.assign(new Error(message), { status: 0, name: 'AuthRetryableFetchError' });

describe('recuperación de contraseña', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSupabase.mockReturnValue(clienteFalso);
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockUpdateUser.mockResolvedValue({ error: null });
  });

  it('el enlace del correo vuelve a la app, no a una página web', () => {
    // Si volviera al Site URL, en un iPad el enlace abriría Safari y la persona se
    // quedaría fuera de la app con una sesión que la app no ve.
    expect(recoveryRedirectUrl()).toBe('krealoshift://restablecer');
  });

  it('envía el correo con la URL de retorno de la app', async () => {
    await sendPasswordReset('  Andree@Krealomedia.com  ');

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('Andree@Krealomedia.com', {
      redirectTo: 'krealoshift://restablecer',
    });
  });

  it('no existe ningún resultado que signifique "ese correo no tiene cuenta"', async () => {
    /*
     * Es una decisión de seguridad, no una comodidad: un "ese correo no existe"
     * convierte la pantalla de acceso en un comprobador de quién trabaja en la
     * empresa, para cualquiera que la abra.
     *
     * Supabase ya responde igual exista o no la cuenta, y aquí no se deshace. Pero lo
     * que se fija es más fuerte que eso: que NO hay un `kind` que la pantalla pudiera
     * traducir a "no existe", ni siquiera si el servidor lo dijera. Sin el caso, la
     * fuga no se puede escribir por descuido.
     */
    expect(await sendPasswordReset('nadie@ejemplo.com')).toEqual({ ok: true });

    mockResetPasswordForEmail.mockResolvedValue({ error: errorAuth(400, 'User not found') });
    expect(await sendPasswordReset('nadie@ejemplo.com')).toEqual({ ok: false, kind: 'generic' });
  });

  it('demasiados correos seguidos se distinguen de un fallo cualquiera', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: errorAuth(429) });
    expect(await sendPasswordReset('a@b.com')).toEqual({ ok: false, kind: 'rateLimited' });
  });

  it('un fallo de red se dice como red, no como "algo salió mal"', async () => {
    /*
     * ESTE CASO ACUSÓ UN FALLO MÍO. La detección buscaba /network|fetch/ en el texto y
     * exigía que NO hubiera estado; supabase-js envuelve el fallo de `fetch` en un
     * `AuthRetryableFetchError` con `status: 0`, así que sí había estado y la red se
     * reportaba como error genérico. "Algo salió mal" manda a mirar al sitio
     * equivocado cuando lo único que pasa es que no hay wifi.
     *
     * Lo vio el chequeo de interacción contra un dominio que no resuelve, no una
     * prueba: aquí se fija para que no vuelva.
     */
    mockResetPasswordForEmail.mockResolvedValue({ error: errorDeRed() });
    expect(await sendPasswordReset('a@b.com')).toEqual({ ok: false, kind: 'offline' });

    // Y también cuando revienta como excepción en vez de venir en `error`.
    mockResetPasswordForEmail.mockRejectedValue(errorDeRed());
    expect(await sendPasswordReset('a@b.com')).toEqual({ ok: false, kind: 'offline' });
  });

  it('un 5xx NO es un fallo de red, aunque llegue en el mismo tipo de error', async () => {
    // supabase-js envuelve los 5xx en el MISMO `AuthRetryableFetchError`, pero con el
    // estado HTTP de verdad. El cero es lo que distingue "no hubo respuesta".
    mockResetPasswordForEmail.mockResolvedValue({
      error: errorAuth(503, 'Service Unavailable', 'AuthRetryableFetchError'),
    });
    expect(await sendPasswordReset('a@b.com')).toEqual({ ok: false, kind: 'generic' });
  });

  it('un enlace que no se pudo canjear se explica como enlace, no como error genérico', async () => {
    // Un código PKCE ya usado da 400 o 404 segun el caso, y ninguno de esos números
    // cambia lo que la persona puede hacer: pedir otro enlace.
    mockExchangeCodeForSession.mockResolvedValue({ error: errorAuth(400, 'invalid request') });
    expect(await exchangeRecoveryCode('roto')).toEqual({ ok: false, kind: 'expiredLink' });
  });

  it('pero si el canje falla por red, se dice red: reintentar sí sirve', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: errorDeRed() });
    expect(await exchangeRecoveryCode('x')).toEqual({ ok: false, kind: 'offline' });
  });

  it('sin configuración de entorno no se inventa un fallo genérico', async () => {
    mockGetSupabase.mockReturnValue(null);
    expect(await sendPasswordReset('a@b.com')).toEqual({ ok: false, kind: 'notConfigured' });
    expect(await exchangeRecoveryCode('x')).toEqual({ ok: false, kind: 'notConfigured' });
    expect(await updatePassword('unaClaveLarga')).toEqual({ ok: false, kind: 'notConfigured' });
  });

  it('un enlace ya usado o caducado se dice como tal', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: errorAuth(403) });
    expect(await exchangeRecoveryCode('usado')).toEqual({ ok: false, kind: 'expiredLink' });
  });

  it('en web el canje ya lo hizo el cliente, y eso NO es un enlace caducado', async () => {
    /*
     * `detectSessionInUrl` está activo en web, así que al arrancar el cliente ya
     * canjeó el código y el segundo canje falla. Sin esta comprobación, quien abre el
     * enlace desde la previsualización web —que es como se revisa esto desde
     * Windows— vería "este enlace ya se usó" justo después de recibirlo.
     */
    mockExchangeCodeForSession.mockResolvedValue({ error: errorAuth(403) });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'x' } } });

    expect(await exchangeRecoveryCode('ya-canjeado')).toEqual({ ok: true });
  });

  it('guarda la contraseña nueva sobre la sesión de recuperación', async () => {
    expect(await updatePassword('unaClaveLarga')).toEqual({ ok: true });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'unaClaveLarga' });
  });

  it('el texto del error de Supabase no decide nada: manda el estado HTTP', async () => {
    // Los mensajes cambian con la versión y con el idioma del servidor. Un error 500
    // cuyo texto dice "network" no es un fallo de red.
    mockUpdateUser.mockResolvedValue({ error: errorAuth(500, 'network something') });
    expect(await updatePassword('unaClaveLarga')).toEqual({ ok: false, kind: 'generic' });
  });
});
