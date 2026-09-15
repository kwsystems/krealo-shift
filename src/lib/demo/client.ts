import { crearFrom, type Almacen, type Fila } from './postgrest';
import { aplicarEscenario, escenarioDeLaUrl } from './escenarios';
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

/**
 * Dónde recuerda la demostración que ya entraste.
 *
 * LA SESIÓN TIENE QUE SOBREVIVIR A UN RECARGADO, y la primera versión no lo hacía:
 * vivía solo en memoria, así que pulsar F5 —o abrir /team escribiendo la URL— devolvía
 * a la pantalla de acceso. Lo cazó el arnés al recorrer las rutas: las seis mostraban
 * el login. Y no es un problema del arnés: le habría pasado igual a cualquiera que
 * recargue, y Supabase de verdad sí persiste la sesión, así que la demostración estaría
 * mintiendo sobre cómo se comporta la app.
 *
 * Es `localStorage` a pelo y no `secureStorage` porque aquí hace falta LEER DE FORMA
 * SÍNCRONA al construir el cliente, y `secureStorage` es asíncrono. No guarda nada
 * sensible: es un sí o un no, en una demostración sin datos reales.
 */
const CLAVE_SESION = 'krealo-shift.demo.sesion';

function haySesionGuardada(): boolean {
  try {
    return globalThis.localStorage?.getItem(CLAVE_SESION) === '1';
  } catch {
    // Ventana privada o almacenamiento bloqueado: se empieza fuera, que es lo correcto.
    return false;
  }
}

function recordarSesion(entrada: boolean): void {
  try {
    if (entrada) globalThis.localStorage?.setItem(CLAVE_SESION, '1');
    else globalThis.localStorage?.removeItem(CLAVE_SESION);
  } catch {
    // Si no se puede recordar, la demostración sigue siendo usable en esta pestaña.
  }
}

function crearAuth(alCambiar: () => void) {
  /*
   * ARRANCA SIN SESION, y antes arrancaba con ella.
   *
   * La primera version entraba sola, porque el modo demostracion se hizo justo para
   * saltarse la pared del inicio de sesion. Efecto secundario: LA PANTALLA DE ACCESO NO
   * SE VEIA NUNCA. Andree levanto la app y dijo "no he visto nada de login" —con razon:
   * no existia forma de llegar a ella salvo cerrar sesion, y para eso hay que estar
   * dentro.
   *
   * Ahora se ve la pantalla real y se entra con un boton. Sigue siendo un solo clic, y
   * ademas se ejercita el formulario de verdad: validacion, errores y navegacion.
   */
  let sesion: ReturnType<typeof sesionDemo> | null = haySesionGuardada() ? sesionDemo() : null;
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
      recordarSesion(true);
      avisar('SIGNED_IN');
      return sinError({ session: sesion, user: sesion.user });
    },
    signOut: async (_opciones?: { scope?: string }) => {
      sesion = null;
      recordarSesion(false);
      // El almacén vuelve a su estado inicial: un experimento a medias no debe quedar
      // pegado al volver a entrar.
      alCambiar();
      avisar('SIGNED_OUT');
      return { error: null };
    },
    resetPasswordForEmail: async (_correo: string, _opciones?: unknown) => ({ error: null }),
    exchangeCodeForSession: async (_codigo: string) => {
      sesion = sesionDemo();
      recordarSesion(true);
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

/**
 * El estado de asistencia de la demostración, recordado entre llamadas.
 *
 * Sin esto, tras marcar entrada el siguiente PIN volvía a decir «fuera de turno» y las
 * acciones ofrecidas no tenían nada que ver con lo que acababas de hacer. Vive en el
 * almacén, igual que el resto de datos de la demostración.
 */
function estadoDeAsistenciaDemo(almacen: Almacen): 'OFF_SHIFT' | 'WORKING' | 'ON_BREAK' {
  const fila = (almacen.get('demo_estado_kiosco') ?? [])[0];
  const valor = fila?.estado;
  return valor === 'WORKING' || valor === 'ON_BREAK' ? valor : 'OFF_SHIFT';
}

function accionesPermitidasDemo(estado: 'OFF_SHIFT' | 'WORKING' | 'ON_BREAK') {
  if (estado === 'OFF_SHIFT') return ['clock_in'] as const;
  if (estado === 'ON_BREAK') return ['break_end', 'clock_out'] as const;
  return ['break_start', 'clock_out'] as const;
}

function estadoTrasEventoDemo(tipo: string): 'OFF_SHIFT' | 'WORKING' | 'ON_BREAK' {
  if (tipo === 'clock_in' || tipo === 'break_end') return 'WORKING';
  if (tipo === 'break_start') return 'ON_BREAK';
  return 'OFF_SHIFT';
}

function registrarEventoDemo(almacen: Almacen, tipo: string, motivo: unknown): void {
  almacen.set('demo_estado_kiosco', [{ estado: estadoTrasEventoDemo(tipo) }]);
  // El motivo se guarda para que la demostración pueda enseñarlo en los reportes.
  if (tipo === 'break_start' && typeof motivo === 'string') {
    almacen.set('demo_pausas', [
      ...(almacen.get('demo_pausas') ?? []),
      { break_reason: motivo, iniciada: new Date().toISOString() },
    ]);
  }
}

function crearFunctions(almacen: Almacen) {
  return {
    invoke: async (nombre: string, _opciones?: { body?: unknown }) => {
      switch (nombre) {
        /*
         * EL PIN TIENE QUE FUNCIONAR, y con la primera versión no funcionaba.
         *
         * Devolvía `{ ok: true, employee: {...} }`, que no se parece en nada a lo que
         * `verifyPinResponseSchema` valida. Zod lo rechazaba y la pantalla decía «No
         * pudimos completar la acción»: o sea que en la demostración era IMPOSIBLE pasar
         * del teclado. Nadie podía ver el fichaje, ni las pausas, ni el motivo. Se
         * descubrió tecleando un PIN en el navegador, no leyendo el código: el arnés
         * anterior solo comprobaba que la pantalla del reloj pintara.
         *
         * Ahora se devuelve la forma completa. Cualquier PIN entra: no hay a quién
         * verificar, y el aviso de demostración ya avisa de que nada de esto es real.
         */
        case 'verify-pin': {
          const estado = estadoDeAsistenciaDemo(almacen);
          return sinError({
            actionToken: 'demo-action-token-suficientemente-largo',
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
            employee: {
              opaqueId: 'demo-empleado-1',
              displayName: 'Ana Quispe Lara',
              initials: 'AQ',
              jobRoleName: 'Cajero',
              // Gerente a propósito: si no, el menú de salida del kiosco queda
              // inalcanzable y no se puede volver al panel sin recargar.
              canManageLocation: true,
            },
            attendanceState: estado,
            allowedActions: accionesPermitidasDemo(estado),
            eligibleShifts: [],
            openSession:
              estado === 'OFF_SHIFT'
                ? null
                : {
                    startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
                    shiftEndsAt: null,
                    takenBreakMinutes: 0,
                    requiredBreakMinutes: 0,
                    openBreak:
                      estado === 'ON_BREAK'
                        ? {
                            startedAt: new Date(Date.now() - 600_000).toISOString(),
                            breakType: 'unpaid',
                          }
                        : null,
                  },
            earliestClockInAt: null,
            requestUpdates: [],
          });
        }

        case 'submit-time-event': {
          const cuerpo = (_opciones?.body ?? {}) as Record<string, unknown>;
          const tipo = String(cuerpo.eventType ?? '');
          registrarEventoDemo(almacen, tipo, cuerpo.breakReason);
          return sinError({
            status: 'accepted',
            eventId: '99999999-9999-4999-8999-999999999999',
            attendanceState: estadoTrasEventoDemo(tipo),
            occurredAt: new Date().toISOString(),
            serverReceivedAt: new Date().toISOString(),
            flags: [],
            summary: { shiftEndsAt: null, netMinutesToday: 0 },
          });
        }
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

  /*
   * El escenario se lee de la URL UNA vez y se guarda: si se leyera en cada
   * `reiniciar()`, cambiar de escenario obligaría a recargar dos veces, y peor, salir y
   * volver a entrar dejaría la demostración en un escenario distinto del que dice la
   * barra de direcciones.
   */
  const escenario = escenarioDeLaUrl();
  const sembrar = () => aplicarEscenario(crearAlmacen(), escenario);

  let almacen = sembrar();
  const reiniciar = () => {
    almacen = sembrar();
  };

  const cliente = {
    auth: crearAuth(reiniciar),
    // Se resuelve al usar, no al construir: así `reiniciar()` tiene efecto de verdad.
    from: (nombre: string) => crearFrom(almacen)(nombre),
    rpc: (nombre: string, argumentos?: Record<string, unknown>) =>
      crearRpc(almacen)(nombre, argumentos),
    functions: crearFunctions(almacen),
    storage: crearStorage(),
  };

  instancia = cliente as unknown as AppSupabaseClient;
  return instancia;
}
