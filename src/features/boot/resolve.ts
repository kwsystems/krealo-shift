import { adminErrorKind } from '@/hooks/use-admin-query';
import { canUseAdminPanel, type AppRole, type SessionPhase } from '@/stores/session-store';

/**
 * Resolución de arranque (§6.1), en UN solo sitio.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * Esta cadena de decisiones estaba escrita dos veces: en `app/index.tsx`, que
 * decide a dónde entrar, y en `app/(manager)/_layout.tsx`, que impide entrar al
 * panel sin permiso. Las dos copias empezaban igual y divergían a partir del
 * tercer paso, y en la divergencia había un callejón sin salida: con una sesión
 * válida sin rol administrativo, la ruta raíz redirigía a la pantalla de acceso,
 * el acceso funcionaba, y la ruta raíz volvía a redirigir al acceso. La persona
 * quedaba encerrada sin un solo mensaje que explicara nada.
 *
 * Dos rutas que deciden lo mismo por separado no se mantienen sincronizadas: es el
 * mismo motivo por el que la comprobación de configuración y el arranque de la
 * sesión subieron al layout raíz. Aquí las dos leen la misma función, así que ya no
 * pueden contestar cosas distintas —y por eso mismo no pueden hacer un bucle de
 * redirecciones entre ellas—.
 *
 * Es una función pura: no lee stores ni hace consultas. Eso la hace comprobable
 * sin montar la app, que es lo que hace la prueba de `__tests__/resolve.test.ts`.
 */

export type BootDestination =
  /** Todavía no se sabe: pantalla de carga sobria, ni acceso ni panel (§6.1). */
  | { kind: 'resolving' }
  /** Dispositivo activado como reloj compartido: manda el kiosco, incluso sin red. */
  | { kind: 'kiosk' }
  /** Sin sesión personal: acceso, con la opción separada de configurar el iPad. */
  | { kind: 'signIn' }
  /** No se pudo saber el rol: se explica y, si tiene sentido, se reintenta (§20). */
  | { kind: 'membershipError'; error: unknown }
  /** Sesión válida sin panel al que entrar: se dice, no se rebota (§6.2). */
  | { kind: 'noAdminRole'; role: AppRole }
  /** Sesión válida con rol administrativo: el panel es el destino (§6.3). */
  | { kind: 'adminPanel'; role: AppRole };

export type BootState = {
  /** ¿Ya se leyó del almacenamiento seguro si este dispositivo es kiosco? */
  kioskHydrated: boolean;
  isKioskDevice: boolean;
  phase: SessionPhase;
  /** Rol devuelto por la consulta de membresía; `null` mientras no se conoce. */
  membershipRole: AppRole | null;
  /** Fallo de la consulta de membresía, o `null` si no falló. */
  membershipError: unknown;
  /** Rol ya publicado en el store por una resolución anterior. */
  storedRole: AppRole | null;
};

export function resolveBootDestination(state: BootState): BootDestination {
  // 1: el estado local todavía se está leyendo. Enseñar el acceso aquí sería
  // enseñar la pantalla equivocada a quien sí tiene sesión (§6.1).
  if (!state.kioskHydrated || state.phase === 'unknown') {
    return { kind: 'resolving' };
  }

  // 2 y 3: un iPad de tienda no pide sesión personal para fichar.
  if (state.isKioskDevice) {
    return { kind: 'kiosk' };
  }

  // 5: sin sesión, acceso.
  if (state.phase !== 'signedIn') {
    return { kind: 'signIn' };
  }

  /*
   * 4: con sesión, el destino lo decide el ROL, que no está en la sesión. La
   * sesión de Supabase dice quién eres; lo que puedes hacer vive en
   * `organization_memberships`.
   *
   * `forbidden` no es un fallo pasajero: es RLS o la falta de membresía diciendo
   * que no. Un rol guardado de antes no vale para saltárselo, así que se descarta
   * y el destino pasa a ser la explicación. Los demás fallos —red, servidor— sí
   * son pasajeros: ahí un rol ya conocido sigue sirviendo, y por eso un refresco
   * fallido en segundo plano no tira abajo un panel que estaba funcionando.
   */
  const denied =
    state.membershipError !== null && adminErrorKind(state.membershipError) === 'forbidden';
  const role = denied ? null : (state.membershipRole ?? state.storedRole);

  if (role !== null) {
    return canUseAdminPanel(role) ? { kind: 'adminPanel', role } : { kind: 'noAdminRole', role };
  }

  if (state.membershipError !== null) {
    return { kind: 'membershipError', error: state.membershipError };
  }

  // Sesión válida y consulta en vuelo: se espera. Termina siempre, porque la
  // consulta está habilitada exactamente cuando se llega hasta aquí y no
  // reintenta: acaba en dato o en error.
  return { kind: 'resolving' };
}
