import { AdminError } from '@/hooks/use-admin-query';
import { resolveBootDestination, type BootState } from '../resolve';

/**
 * La resolución de arranque (§6.1).
 *
 * Dos de estas pruebas describen callejones sin salida REALES que existían cuando
 * la decisión estaba escrita dos veces, en `app/index.tsx` y en el layout del
 * panel: la cuenta de empleado y el fallo de membresía. Las dos acababan
 * redirigiendo a la pantalla de acceso, donde iniciar sesión no arreglaba nada
 * porque la sesión ya era válida.
 */

const base: BootState = {
  kioskHydrated: true,
  isKioskDevice: false,
  phase: 'signedIn',
  membershipRole: null,
  membershipError: null,
  storedRole: null,
};

describe('resolveBootDestination', () => {
  it('espera mientras no se sabe si el dispositivo es kiosco', () => {
    expect(resolveBootDestination({ ...base, kioskHydrated: false }).kind).toBe('resolving');
  });

  it('espera mientras la sesión no se resuelve, sin enseñar el acceso', () => {
    expect(resolveBootDestination({ ...base, phase: 'unknown' }).kind).toBe('resolving');
  });

  it('un kiosco va al reloj compartido aunque no haya sesión personal', () => {
    expect(resolveBootDestination({ ...base, isKioskDevice: true, phase: 'signedOut' }).kind).toBe(
      'kiosk',
    );
  });

  it('el kiosco manda incluso sobre una sesión administrativa válida', () => {
    // Un iPad de tienda con la sesión del dueño abierta sigue siendo el reloj.
    expect(
      resolveBootDestination({ ...base, isKioskDevice: true, membershipRole: 'owner' }).kind,
    ).toBe('kiosk');
  });

  it('sin sesión, al acceso', () => {
    expect(resolveBootDestination({ ...base, phase: 'signedOut' }).kind).toBe('signIn');
  });

  it('con rol administrativo, al panel', () => {
    expect(resolveBootDestination({ ...base, membershipRole: 'manager' })).toEqual({
      kind: 'adminPanel',
      role: 'manager',
    });
  });

  it('acepta el rol ya publicado en el store mientras la consulta va en vuelo', () => {
    expect(resolveBootDestination({ ...base, storedRole: 'admin' }).kind).toBe('adminPanel');
  });

  it('espera cuando hay sesión y el rol todavía no se conoce', () => {
    expect(resolveBootDestination(base).kind).toBe('resolving');
  });

  /*
   * EL PRIMER CALLEJÓN SIN SALIDA.
   * Una cuenta con membresía `employee` tiene sesión válida y ningún panel al que
   * entrar (§6.2). La ruta raíz la mandaba al acceso; el acceso funcionaba —la
   * sesión ya era válida— y la raíz la devolvía al acceso. Encerrada y sin mensaje.
   */
  it('una cuenta de empleado recibe una explicación, no la pantalla de acceso', () => {
    const destino = resolveBootDestination({ ...base, membershipRole: 'employee' });
    expect(destino).toEqual({ kind: 'noAdminRole', role: 'employee' });
    expect(destino.kind).not.toBe('signIn');
  });

  /*
   * EL SEGUNDO. Si la membresía no se puede leer, volver a iniciar sesión no
   * arregla una consulta que falla: hay que decirlo y ofrecer reintentar.
   */
  it('un fallo de red al leer la membresía se explica, no rebota al acceso', () => {
    const error = new AdminError('offline');
    const destino = resolveBootDestination({ ...base, membershipError: error });
    expect(destino).toEqual({ kind: 'membershipError', error });
  });

  it('un rol ya conocido sobrevive a un refresco fallido en segundo plano', () => {
    // Un fallo pasajero no debe tirar abajo un panel que estaba funcionando.
    expect(
      resolveBootDestination({
        ...base,
        storedRole: 'owner',
        membershipError: new AdminError('offline'),
      }).kind,
    ).toBe('adminPanel');
  });

  it('un rechazo de RLS invalida el rol guardado: no se sigue enseñando el panel', () => {
    // `forbidden` no es pasajero: es la membresía revocada o RLS diciendo que no.
    expect(
      resolveBootDestination({
        ...base,
        storedRole: 'owner',
        membershipError: new AdminError('forbidden', 'NO_MEMBERSHIP'),
      }).kind,
    ).toBe('membershipError');
  });

  /*
   * NINGUNA REDIRECCIÓN PUEDE VOLVER A ENTRAR EN BUCLE.
   * `app/index.tsx` redirige a `/(manager)` solo con `adminPanel`, y el layout de
   * `(manager)` redirige a `/` solo con `noAdminRole`. Al leer las dos la misma
   * función, un mismo estado no puede producir los dos destinos, así que las dos
   * rutas no pueden rebotarse la una a la otra.
   */
  it('un mismo estado nunca produce a la vez panel y explicación', () => {
    const estados: BootState[] = [
      base,
      { ...base, membershipRole: 'owner' },
      { ...base, membershipRole: 'admin' },
      { ...base, membershipRole: 'manager' },
      { ...base, membershipRole: 'employee' },
      { ...base, storedRole: 'employee' },
      { ...base, membershipError: new AdminError('server') },
      { ...base, membershipError: new AdminError('forbidden') },
      { ...base, phase: 'signedOut' },
      { ...base, isKioskDevice: true },
      { ...base, kioskHydrated: false },
      { ...base, phase: 'unknown' },
    ];

    for (const estado of estados) {
      const destino = resolveBootDestination(estado);
      // Determinista: dos llamadas con el mismo estado dan el mismo destino, que
      // es lo que garantiza que las dos rutas coincidan.
      expect(resolveBootDestination(estado).kind).toBe(destino.kind);
    }
  });
});
