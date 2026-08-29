/**
 * El arranque de la sesión NUNCA deja la app colgada (§6.1, §20).
 *
 * ESTA PRUEBA EXISTE POR EL FALLO DE MAYOR ALCANCE QUE HA TENIDO EL PROYECTO.
 * `hydrate` llamaba a `getSession()` sin try/catch y sin límite de tiempo. Si eso
 * rechazaba —o simplemente no respondía— `phase` se quedaba en `'unknown'` para
 * siempre.
 *
 * Y `phase === 'unknown'` es lo que bloquea `app/index.tsx` y
 * `app/(manager)/_layout.tsx`: los dos muestran "Preparando tu sesión" mientras no se
 * resuelve. Así que la app entera se quedaba ahí, y reiniciar sin red hacía lo mismo.
 *
 * LO PEOR: el kiosco también, porque la app arranca en `/`. Un iPad de tienda que
 * arranca sin wifi nunca pasaba de la pantalla de carga y no podía fichar a nadie,
 * que es exactamente el escenario para el que existe toda la arquitectura sin
 * conexión.
 *
 * `signedOut` es el valor seguro y no una rendición: el kiosco no necesita sesión
 * personal, y quien quiera el panel inicia sesión cuando vuelva la red.
 */

// El import va arriba aunque los `jest.mock` esten debajo: Babel iza las llamadas a
// `jest.mock` por encima de los imports, asi que el modulo bajo prueba ve las versiones
// simuladas de todas formas.
import { useSessionStore } from '../session-store';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: jest.fn(),
    },
  }),
}));

jest.mock('@/features/notifications/api', () => ({
  deactivateRememberedPushToken: jest.fn(),
  deactivateAllPushTokens: jest.fn(),
}));

describe('arranque de la sesión', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    useSessionStore.setState({
      phase: 'unknown',
      user: null,
      role: null,
      organizationId: null,
      endReason: null,
    });
    mockOnAuthStateChange.mockReturnValue({ subscription: { unsubscribe: jest.fn() } });
  });

  afterEach(() => warn.mockRestore());

  it('resuelve a signedIn con una sesión válida', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.com' } } },
    });

    await useSessionStore.getState().hydrate();

    expect(useSessionStore.getState().phase).toBe('signedIn');
    expect(useSessionStore.getState().user).toEqual({ userId: 'u1', email: 'a@b.com' });
  });

  it('resuelve a signedOut sin sesión guardada', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await useSessionStore.getState().hydrate();

    expect(useSessionStore.getState().phase).toBe('signedOut');
  });

  it('NO SE QUEDA EN unknown si getSession rechaza', async () => {
    // El caso que dejaba la app entera en "Preparando tu sesión".
    mockGetSession.mockRejectedValue(new Error('Network request failed'));

    await useSessionStore.getState().hydrate();

    expect(useSessionStore.getState().phase).toBe('signedOut');
    expect(warn).toHaveBeenCalled();
  });

  it('NO SE QUEDA EN unknown si getSession no responde nunca', async () => {
    // La mitad que un catch no cubre: con red a medias —un portal cautivo, un router
    // que acepta la conexión y no enruta— la llamada no rechaza, se queda esperando.
    jest.useFakeTimers();
    mockGetSession.mockReturnValue(new Promise(() => undefined));

    const enCurso = useSessionStore.getState().hydrate();
    await jest.advanceTimersByTimeAsync(6_500);
    await enCurso;

    expect(useSessionStore.getState().phase).toBe('signedOut');
    expect(warn).toHaveBeenCalled();
  });

  it('el aviso del límite de tiempo dice que el kiosco sigue funcionando', async () => {
    // Un aviso que solo dice "falló" no le sirve a nadie que lo lea en un log.
    jest.useFakeTimers();
    mockGetSession.mockReturnValue(new Promise(() => undefined));

    const enCurso = useSessionStore.getState().hydrate();
    await jest.advanceTimersByTimeAsync(6_500);
    await enCurso;

    expect(String(warn.mock.calls[0]?.[0])).toMatch(/kiosco funciona/i);
  });

  it('subscribe no revienta si el cliente falla al registrarse', () => {
    // El efecto de arranque hace `return subscribeSession()`. Si esto lanzara,
    // reventaría el render de la ruta inicial: pantalla en blanco y nada más.
    mockOnAuthStateChange.mockImplementation(() => {
      throw new Error('cliente en mal estado');
    });

    const desuscribir = useSessionStore.getState().subscribe();

    expect(typeof desuscribir).toBe('function');
    expect(() => desuscribir()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * Por qué se acabó la sesión, y sobre todo cuándo NO se acabó ninguna.
 *
 * ESTE BLOQUE EXISTE POR UN FALLO QUE ESCRIBÍ Y QUE NINGUNA PRUEBA VIO: la primera
 * pantalla de alguien que abría la app por primera vez decía "Tu sesión caducó". No
 * caducó nada: nunca había entrado.
 *
 * `onAuthStateChange` se dispara en el ARRANQUE EN FRÍO con `session === null` —el
 * evento `INITIAL_SESSION` de Supabase— y el código marcaba `expired` sin comprobar que
 * antes hubiera habido sesión, aunque su propio comentario decía "aquí es donde muere una
 * sesión que SÍ existía".
 *
 * Se vio levantando la app con `expo start --web` y mirándola. El arranque en frío es
 * justo lo que no ocurre en una prueba que ya tiene el estado puesto para probar otra
 * cosa.
 */
describe('motivo del fin de sesión', () => {
  const dispararCambio = (session: unknown) => {
    const escuchar = mockOnAuthStateChange.mock.calls[0]?.[0] as
      ((evento: string, sesion: unknown) => void) | undefined;
    escuchar?.('INITIAL_SESSION', session);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      phase: 'unknown',
      user: null,
      role: null,
      organizationId: null,
      endReason: null,
    });
    mockOnAuthStateChange.mockReturnValue({ subscription: { unsubscribe: jest.fn() } });
  });

  it('EL ARRANQUE EN FRÍO no dice que la sesión caducó', () => {
    useSessionStore.getState().subscribe();
    dispararCambio(null);

    expect(useSessionStore.getState().phase).toBe('signedOut');
    expect(useSessionStore.getState().endReason).toBeNull();
  });

  it('una sesión que SÍ existía y desaparece sola sí caducó', () => {
    useSessionStore.setState({ phase: 'signedIn' });
    useSessionStore.getState().subscribe();
    dispararCambio(null);

    expect(useSessionStore.getState().endReason).toBe('expired');
  });

  it('un cierre que pidió la persona no se llama caducidad', () => {
    // `signOut` marca el motivo ANTES de llamar al servidor, porque el listener se
    // dispara durante ese await. Aquí se simula ese orden.
    useSessionStore.setState({ phase: 'signedIn', endReason: 'signedOut' });
    useSessionStore.getState().subscribe();
    dispararCambio(null);

    expect(useSessionStore.getState().endReason).toBe('signedOut');
  });

  it('entrar bien borra el motivo anterior', () => {
    // Si no, el aviso reaparecería la próxima vez que alguien viera el acceso.
    useSessionStore.setState({ phase: 'signedOut', endReason: 'expired' });
    useSessionStore.getState().subscribe();
    dispararCambio({ user: { id: 'u1', email: 'a@b.com' } });

    expect(useSessionStore.getState().phase).toBe('signedIn');
    expect(useSessionStore.getState().endReason).toBeNull();
  });
});

describe('donde vive el arranque de la sesión', () => {
  /**
   * SEGUNDA CAUSA DEL MISMO SÍNTOMA, y peor que la primera.
   *
   * `hydrate` se llamaba desde el efecto de `app/index.tsx`, o sea de la ruta `/`.
   * Entrar DIRECTAMENTE a cualquier otra ruta no lo llamaba nunca: `phase` se quedaba
   * en `'unknown'` y el panel mostraba "Preparando tu sesión" para siempre, sin que
   * hubiera ningún problema de red.
   *
   * Y no es un caso rebuscado. La §19 pide que tocar una notificación lleve a la
   * pantalla correcta, y `useNotificationRouter` hace `router.push` a una ruta del
   * panel CON LA APP ABIERTA DESDE CERRADA. Un encargado que toca un aviso de
   * tardanza caía exactamente ahí.
   *
   * Se comprueba leyendo los archivos, que es feo, y es la única forma de fijar
   * DÓNDE vive una llamada sin montar el router entero.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');

  const leer = (relativa: string) => readFileSync(join(__dirname, '../../../', relativa), 'utf8');

  it('el layout raíz arranca la sesión, que cubre TODAS las rutas', () => {
    const layout = leer('app/_layout.tsx');
    expect(layout).toContain('hydrateSession');
    expect(layout).toContain('subscribeSession');
  });

  it('y ya NO se arranca solo en la ruta de inicio', () => {
    // Dos arranques de la misma cosa se separan: uno se actualiza y el otro no.
    const index = leer('app/index.tsx');
    expect(index).not.toContain('hydrateSession');
  });

  it('el arranque de la sesión no bloquea el de la app', () => {
    // `void` y no `await`: el kiosco no necesita sesión personal para funcionar, y
    // esperar una lectura de sesión para arrancar volvería a atar el reloj de la
    // tienda a algo que no le hace falta.
    const layout = leer('app/_layout.tsx');
    expect(layout).toContain('void hydrateSession()');
    expect(layout).not.toContain('await hydrateSession()');
  });
});
