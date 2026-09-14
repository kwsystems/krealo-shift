import { crearFrom, type Almacen, type Fila } from './postgrest';
import { crearAlmacen, DEMO_EMAIL, DEMO_LOCATION_1, DEMO_ORG_ID, DEMO_USER_ID } from './seed';
import type { AppSupabaseClient } from '@/lib/supabase/client';

/**
 * El cliente de mentira del modo demostración.
 *
 * Imita la superficie de `supabase-js` que esta app usa: `auth`, `from`, `rpc`,
 * `functions.invoke` y `storage`. Nada más, y a propósito: lo que no está aquí es
 * porque la app no lo llama, y si algún día lo llama debe romperse a la vista en vez
 * de devolver un resultado inventado.
 *
 * SE ENTRA SOLO. La sesión existe desde el primer instante, porque el sentido entero de
 * este modo es que abrir el navegador te deje DENTRO. Cerrar sesión funciona y devuelve
 * a la pantalla de acceso, donde cualquier correo y cualquier contraseña vuelven a
 * entrar: no hay a quién autenticar.
 *
 * LO QUE ESTE MODO NO PRUEBA, y conviene tenerlo escrito porque es fácil de olvidar
 * cuando todo se ve bonito: no prueba RLS, ni permisos, ni las Edge Functions, ni el
 * rendimiento con datos de verdad. Aquí el "servidor" dice que sí a todo. La seguridad
 * vive en la base y se comprueba con las pruebas SQL, no aquí.
 */

type Suscriptor = (evento: string, sesion: unknown) => void;

function usuarioDemo() {
  return {
    id: DEMO_USER_ID,
    email: DEMO_EMAIL,
    app_metadata: {},
    user_metadata: { full_name: 'Andree (demostración)' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
}

function sesionDemo() {
  return {
    access_token: 'demo-access-token',
    refresh_token: 'demo-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: usuarioDemo(),
  };
}

function sinError<T>(data: T) {
  return { data, error: null };
}

function minutosEntre(desde: string, hasta: string): number {
  return Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 60000));
}

function crearAuth(alCambiar: () => void) {
  let sesion: ReturnType<typeof sesionDemo> | null = sesionDemo();
  const suscriptores = new Set<Suscriptor>();

  const avisar = (evento: string) => {
    for (const suscriptor of suscriptores) suscriptor(evento, sesion);
  };

  return {
    getSession: async () => sinError({ session: sesion }),
    getUser: async () => sinError({ user: sesion === null ? null : sesion.user }),
    onAuthStateChange: (callback: Suscriptor) => {
      suscriptores.add(callback);
      // Igual que supabase-js: el primer aviso llega solo, en cuanto hay suscriptor.
      setTimeout(() => callback('INITIAL_SESSION', sesion), 0);
      return {
        data: {
          subscription: {
            id: 'demo',
            callback,
            unsubscribe: () => {
              suscriptores.delete(callback);
            },
          },
        },
      };
    },
    signInWithPassword: async (_credenciales: { email: string; password: string }) => {
      sesion = sesionDemo();
      avisar('SIGNED_IN');
      return sinError({ session: sesion, user: sesion.user });
    },
    signOut: async (_opciones?: { scope?: string }) => {
      sesion = null;
      // El almacén vuelve a su estado inicial: un experimento a medias no debe quedar
      // pegado al volver a entrar.
      alCambiar();
      avisar('SIGNED_OUT');
      return { error: null };
    },
    resetPasswordForEmail: async (_correo: string, _opciones?: unknown) => ({ error: null }),
    exchangeCodeForSession: async (_codigo: string) => {
      sesion = sesionDemo();
      avisar('SIGNED_IN');
      return sinError({ session: sesion });
    },
    updateUser: async (_cambios: { password?: string }) => sinError({ user: usuarioDemo() }),
  };
}

function crearRpc(almacen: Almacen) {
  const filas = (tabla: string): Fila[] => almacen.get(tabla) ?? [];

  return async (nombre: string, argumentos: Record<string, unknown> = {}) => {
    switch (nombre) {
      case 'create_kiosk_activation_code':
        // Seis dígitos, como el de verdad. Es de mentira y se dice en pantalla.
        return sinError(String(Math.floor(100000 + Math.random() * 900000)));

      case 'revoke_kiosk_device': {
        const id = argumentos.p_device_id;
        almacen.set(
          'kiosk_devices_admin',
          filas('kiosk_devices_admin').map((fila) =>
            fila.id === id ? { ...fila, status: 'revoked' } : fila,
          ),
        );
        return sinError(null);
      }

      case 'set_employee_pin':
        return sinError(null);

      case 'approve_timesheet_period': {
        const id = argumentos.p_period_id;
        almacen.set(
          'timesheet_periods',
          filas('timesheet_periods').map((fila) =>
            fila.id === id
              ? { ...fila, status: 'approved', approved_at: new Date().toISOString() }
              : fila,
          ),
        );
        return sinError(null);
      }

      case 'manager_adjust_time': {
        const id = argumentos.p_work_session_id;
        const inicio = argumentos.p_new_starts_at;
        const fin = argumentos.p_new_ends_at;
        almacen.set(
          'work_sessions',
          filas('work_sessions').map((fila) => {
            if (fila.id !== id) return fila;
            const nuevoInicio = typeof inicio === 'string' ? inicio : String(fila.starts_at);
            const nuevoFin = typeof fin === 'string' ? fin : (fila.ends_at as string | null);
            const brutos = nuevoFin === null ? null : minutosEntre(nuevoInicio, nuevoFin);
            const descanso = Number(fila.unpaid_break_minutes ?? 0);
            return {
              ...fila,
              starts_at: nuevoInicio,
              ends_at: nuevoFin,
              gross_minutes: brutos,
              net_minutes: brutos === null ? null : brutos - descanso,
              updated_at: new Date().toISOString(),
            };
          }),
        );
        return sinError(null);
      }

      case 'manager_add_time_event': {
        const idEvento = `${Date.now().toString(16)}-0000-4000-8000-000000000000`.slice(0, 36);
        almacen.set('time_events', [
          ...filas('time_events'),
          {
            id: idEvento,
            organization_id: DEMO_ORG_ID,
            employee_id: argumentos.p_employee_id,
            location_id: argumentos.p_location_id,
            event_type: argumentos.p_event_type,
            break_type: argumentos.p_break_type ?? null,
            occurred_at: argumentos.p_occurred_at,
            source: 'manager',
            is_offline: false,
          },
        ]);
        return sinError([{ event_id: idEvento, work_session_id: null }]);
      }

      case 'attendance_state_at':
      case 'current_attendance_state': {
        const empleado = argumentos.p_employee_id;
        const abierta = filas('work_sessions').find(
          (fila) => fila.employee_id === empleado && fila.ends_at === null,
        );
        return sinError(abierta === undefined ? 'OFF' : 'WORKING');
      }

      case 'export_timesheet_rows': {
        const ubicacion = argumentos.p_location_id;
        const nombres = new Map(
          filas('employees').map((fila) => [fila.id, String(fila.full_name ?? '')]),
        );
        const salida = filas('work_sessions')
          .filter((fila) => fila.location_id === ubicacion && fila.ends_at !== null)
          .map((fila) => {
            const netos = Number(fila.net_minutes ?? 0);
            return {
              employee_name: nombres.get(fila.employee_id) ?? 'Empleado',
              work_date: String(fila.starts_at).slice(0, 10),
              clock_in: fila.starts_at,
              clock_out: fila.ends_at,
              gross_minutes: fila.gross_minutes,
              paid_break_minutes: fila.paid_break_minutes,
              unpaid_break_minutes: fila.unpaid_break_minutes,
              net_minutes: fila.net_minutes,
              net_hours_decimal: Math.round((netos / 60) * 100) / 100,
              status: fila.status,
              flags: fila.flags,
            };
          });
        return sinError(salida);
      }

      case 'rebuild_work_session':
        return sinError(null);

      default:
        return {
          data: null,
          error: {
            code: 'DEMO_RPC',
            message: `Modo demostración: la función "${nombre}" no está simulada.`,
            details: '',
            hint: 'Añádela en src/lib/demo/client.ts.',
          },
        };
    }
  };
}

function crearFunctions() {
  return {
    invoke: async (nombre: string, _opciones?: { body?: unknown }) => {
      switch (nombre) {
        case 'verify-pin':
          return sinError({ ok: true, employee: { id: DEMO_USER_ID, fullName: 'Demostración' } });
        case 'submit-time-event':
          return sinError({ ok: true });
        case 'sync-offline-events':
          return sinError({ ok: true, accepted: 0, rejected: 0 });
        case 'refresh-kiosk-roster':
          return sinError({ ok: true, employees: [] });
        case 'submit-time-edit-request':
          return sinError({ ok: true });
        case 'attach-photo':
          return sinError({ ok: true });
        /*
         * La activación funciona con CUALQUIER código.
         *
         * Se intentó el atajo de dar el dispositivo por activado al arrancar, y salió
         * mal de una forma instructiva: el arranque decide por `isKioskDevice` ANTES
         * que por el rol, así que las cinco pestañas del panel redirigían a /kiosk y
         * la app administrativa quedaba inalcanzable. La app se creía un reloj.
         *
         * Haciéndolo por aquí, el kiosco se activa desde su propia pantalla —el flujo
         * de verdad, el mismo que en producción—, es una decisión explícita de quien
         * mira, y se deshace saliendo del modo kiosco. No hay forma de quedarse
         * encerrado sin querer.
         */
        case 'activate-kiosk':
          return sinError({
            credential: 'demo-credencial-de-kiosco-no-es-un-secreto',
            deviceKey: 'demo-clave-de-dispositivo-no-es-un-secreto',
            device: {
              id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
              publicId: 'demo-kiosk-main',
              displayName: 'iPad mostrador (demostración)',
            },
            organization: {
              id: DEMO_ORG_ID,
              name: 'Café Demostración',
              logoPath: null,
            },
            location: {
              id: DEMO_LOCATION_1,
              name: 'Sede Principal',
              timezone: 'America/Lima',
            },
            policies: {
              pinLength: 6,
              photoEnabled: false,
              earlyClockInMinutes: 10,
              lateGraceMinutes: 5,
              allowUnscheduledShifts: true,
              timeFormat: '24h',
              requiredBreakMinutes: 0,
            },
          });
        default:
          return {
            data: null,
            error: { message: `Modo demostración: la función "${nombre}" no está simulada.` },
          };
      }
    },
  };
}

function crearStorage() {
  return {
    from: (_bucket: string) => ({
      getPublicUrl: (ruta: string) => ({ data: { publicUrl: ruta } }),
      upload: async (_ruta: string, _cuerpo: unknown, _opciones?: unknown) => ({ error: null }),
      remove: async (_rutas: string[]) => ({ error: null }),
    }),
  };
}

let instancia: AppSupabaseClient | null = null;

/** El cliente de demostración, creado una vez por carga de la pestaña. */
export function getDemoClient(): AppSupabaseClient {
  if (instancia !== null) return instancia;

  let almacen = crearAlmacen();
  const reiniciar = () => {
    almacen = crearAlmacen();
  };

  const cliente = {
    auth: crearAuth(reiniciar),
    // Se resuelve al usar, no al construir: así `reiniciar()` tiene efecto de verdad.
    from: (nombre: string) => crearFrom(almacen)(nombre),
    rpc: (nombre: string, argumentos?: Record<string, unknown>) =>
      crearRpc(almacen)(nombre, argumentos),
    functions: crearFunctions(),
    storage: crearStorage(),
  };

  instancia = cliente as unknown as AppSupabaseClient;
  return instancia;
}
