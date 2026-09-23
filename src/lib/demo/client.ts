import { DEFAULT_PAID_REASONS, type BreakReason } from '@/domain/break-reason';
import { crearFrom, type Almacen, type Fila } from './postgrest';
import { aplicarEscenario, escenarioDeLaUrl } from './escenarios';
import { DEMO_EMAIL, DEMO_LOCATION_1, DEMO_ORG_ID, DEMO_USER_ID, crearAlmacen } from './seed';
import { registrarFichajeDemo } from './reconstruir';
import type { DataClient } from '@/lib/firebase/query';

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

/**
 * A quién le pertenece lo que se ficha en el reloj de la demostración.
 *
 * `verify-pin` devuelve siempre a Ana Quispe Lara —cualquier PIN entra, no hay a quién
 * verificar— así que el fichaje tiene que ir a la MISMA persona, o el panel enseñaría una
 * sesión de alguien que no es quien acabas de ver en el reloj. Es `empleadoId(1)` de la
 * semilla.
 */
const DEMO_EMPLEADO_KIOSCO = '33333333-3333-4333-8333-000000000001';

function sinError<T>(data: T) {
  return { data, error: null };
}

/**
 * Un rechazo de la demostración, con la forma que el cliente sabe leer.
 *
 * DEVOLVER `sinError(null)` CUANDO ALGO NO SE PUEDE HACER ES MENTIR: la pantalla dice
 * «listo» y no ha pasado nada. Es el mismo fallo que ya tuvieron aquí `verify-pin` y
 * «olvidé marcar» con formas inventadas, solo que más silencioso.
 */
function conError(mensaje: string) {
  return { data: null, error: { code: 'failed-precondition', message: mensaje } };
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
      // Igual que Firebase: el primer aviso llega solo, en cuanto hay suscriptor.
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
    // Aqui vivian `resetPasswordForEmail`, `exchangeCodeForSession` y `updateUser`.
    // Se fueron con el formulario de correo y contrasena: con Google no hay
    // contrasena nuestra que recuperar ni actualizar, y un doble de algo que ya no
    // existe solo sirve para que una prueba pase sobre una funcion muerta.
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

      /*
       * DEVUELVE EL PIN, como la funcion de verdad. Devolvia `null`, y desde que el
       * servidor es quien lo sortea, el panel lee `data.pin`: en la demostracion salia
       * «respuesta inesperada» al pulsar Reiniciar PIN. Es el mismo fallo que ya
       * tuvieron aqui `verify-pin` y «olvide marcar», y se repite por el mismo motivo:
       * una forma inventada que no se parece a la que el cliente valida.
       */
      case 'set_employee_pin':
        return sinError({ pin: '135791' });

      /**
       * EL ALTA DE EMPRESA SE SIMULA DE VERDAD: escribe las tres filas.
       *
       * Aquí no vale el `{ ok: true }` que valen las de miembros. Devolver un
       * identificador inventado sin escribir nada dejaría la pantalla diciendo «"X"
       * creada, ya sale en el selector» y el selector sin ella: dos textos de la misma
       * pantalla contradiciéndose, que es peor que no simular la función. Y es justo lo
       * que alguien querría comprobar aquí —tener dos empresas y cambiar de una a
       * otra— porque es la pregunta que originó todo esto.
       *
       * Las tres filas son las mismas que escribe la transacción del servidor: empresa,
       * membresía de dueño y primera sede. Sin la membresía la empresa existiría y no
       * habría forma de entrar en ella, que es el fallo que se acaba de arreglar en el
       * código de verdad.
       *
       * Y VA EN `crearRpc`, NO EN `crearFunctions`. La primera versión estaba en el
       * segundo y no se llamaba nunca: `db.rpc` despacha por el nombre en snake_case y
       * `functions.invoke` por el camelCase, así que el botón daba «algo no salió bien»
       * en la demostración. Lo cazó el arnés del navegador, no el compilador: los dos
       * despachadores toman un string.
       */
      case 'create_organization': {
        const organizationId = `demo-org-${Date.now()}`;
        const locationId = `demo-sede-${Date.now()}`;
        const zona = String(argumentos.p_timezone ?? 'America/Lima');

        filas('organizations').push({
          id: organizationId,
          name: String(argumentos.p_name ?? 'Empresa nueva'),
          default_locale: String(argumentos.p_locale ?? 'es'),
          default_timezone: zona,
          week_starts_on: Number(argumentos.p_week_starts_on ?? 1),
          logo_path: null,
        });

        filas('organization_memberships').push({
          organization_id: organizationId,
          user_id: DEMO_USER_ID,
          role: 'owner',
          status: 'active',
          // POSTERIOR a la de la empresa sembrada: así la de siempre sigue siendo la
          // primera y crear una no te cambia el panel de debajo de los pies.
          created_at: new Date().toISOString(),
        });

        filas('locations').push({
          id: locationId,
          organization_id: organizationId,
          name: String(argumentos.p_first_location_name ?? 'Sede'),
          address: '',
          timezone: zona,
          is_active: true,
          settings: {},
        });

        return sinError({ organizationId, locationId });
      }

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

      /**
       * Reclasificar una salida como pausa, en la demostración.
       *
       * Marca los dos fichajes y funde las dos sesiones, igual que el servidor. NO es
       * una versión simplificada por comodidad: si la demostración devolviera «listo»
       * sin mover los minutos, enseñaría una corrección que no corrige, y quien la vea
       * creerá que la app hace algo que no hace. Ya pasó con otras respuestas inventadas
       * de este mismo archivo.
       */
      case 'manager_reclassify_departure': {
        const idSalida = argumentos.p_event_id;
        const eventos = filas('time_events');
        const salida = eventos.find((fila) => fila.id === idSalida);
        if (salida === undefined) return conError('Ese fichaje no existe.');

        const posteriores = eventos
          .filter(
            (fila) =>
              fila.employee_id === salida.employee_id &&
              String(fila.occurred_at) > String(salida.occurred_at),
          )
          .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
        const vuelta = posteriores[0];
        if (vuelta === undefined || vuelta.event_type !== 'clock_in') {
          return conError('No hay una entrada después de esa salida.');
        }

        const motivo = String(argumentos.p_break_reason ?? 'other');
        const pagada = DEFAULT_PAID_REASONS[motivo as BreakReason] ?? false;
        const minutos = minutosEntre(String(salida.occurred_at), String(vuelta.occurred_at));

        /*
         * EL MISMO LÍMITE QUE EL SERVIDOR, y aquí importa especialmente: en la
         * demostración cada día es UNA jornada, así que «la entrada siguiente» de
         * cualquier salida es siempre la del día siguiente. Sin este control la
         * demostración enseñaría una corrección que el servidor rechaza, que es peor que
         * no enseñarla — quien la pruebe aquí la creerá posible allá.
         */
        const DESCANSO_MINIMO = 660;
        if (minutos >= DESCANSO_MINIMO) {
          return conError(
            'Entre esa salida y la vuelta pasa más que el descanso mínimo entre turnos: ' +
              'son dos jornadas distintas, no una ausencia.',
          );
        }

        almacen.set(
          'time_events',
          eventos.map((fila) => {
            if (fila.id === idSalida) {
              return {
                ...fila,
                reclassified_as: 'break_start',
                break_reason: motivo,
                break_type: pagada ? 'paid' : 'unpaid',
              };
            }
            if (fila.id === vuelta.id) return { ...fila, reclassified_as: 'break_end' };
            return fila;
          }),
        );

        const sesiones = filas('work_sessions');
        /*
         * Por id de evento primero y por hora si no lo hay: la semilla de la
         * demostración no guarda `clock_out_event_id` en sus sesiones, y buscar solo por
         * id no encontraría nada — o sea que se marcarían los fichajes y los minutos no
         * se moverían, que es exactamente la clase de media verdad que esto evita.
         */
        const cortada =
          sesiones.find((fila) => fila.clock_out_event_id === idSalida) ??
          sesiones.find(
            (fila) =>
              fila.employee_id === salida.employee_id && fila.ends_at === salida.occurred_at,
          );
        const siguiente =
          sesiones.find((fila) => fila.clock_in_event_id === vuelta.id) ??
          sesiones.find(
            (fila) =>
              fila.employee_id === vuelta.employee_id && fila.starts_at === vuelta.occurred_at,
          );

        if (cortada !== undefined && siguiente !== undefined) {
          const fin = siguiente.ends_at as string | null;
          const brutos = fin === null ? null : minutosEntre(String(cortada.starts_at), fin);
          const noPagados =
            Number(cortada.unpaid_break_minutes ?? 0) +
            Number(siguiente.unpaid_break_minutes ?? 0) +
            (pagada ? 0 : minutos);
          const pagados =
            Number(cortada.paid_break_minutes ?? 0) +
            Number(siguiente.paid_break_minutes ?? 0) +
            (pagada ? minutos : 0);

          almacen.set(
            'work_sessions',
            sesiones
              .filter((fila) => fila.id !== siguiente.id)
              .map((fila) =>
                fila.id !== cortada.id
                  ? fila
                  : {
                      ...fila,
                      ends_at: fin,
                      clock_out_event_id: siguiente.clock_out_event_id ?? null,
                      gross_minutes: brutos,
                      paid_break_minutes: pagados,
                      unpaid_break_minutes: noPagados,
                      net_minutes: brutos === null ? null : brutos - noPagados,
                      status: fin === null ? 'open' : 'complete',
                      flags: (Array.isArray(fila.flags) ? fila.flags : []).filter(
                        (marca) => marca !== 'early_departure',
                      ),
                      departure_reason: null,
                      departure_note: null,
                      updated_at: new Date().toISOString(),
                    },
              ),
          );
        }

        return sinError({ minutes: minutos, breakType: pagada ? 'paid' : 'unpaid' });
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

function registrarEventoDemo(
  almacen: Almacen,
  tipo: string,
  motivo: unknown,
  nota?: unknown,
): void {
  almacen.set('demo_estado_kiosco', [{ estado: estadoTrasEventoDemo(tipo) }]);
  // El motivo se guarda para que la demostración pueda enseñarlo en los reportes.
  if (tipo === 'break_start' && typeof motivo === 'string') {
    almacen.set('demo_pausas', [
      ...(almacen.get('demo_pausas') ?? []),
      { break_reason: motivo, iniciada: new Date().toISOString() },
    ]);
  }

  /*
   * Y AHORA SÍ LLEGA AL PANEL.
   *
   * Hasta el 2026-09-23 esto acababa aquí: se guardaba el estado y nada más. Así que el
   * reloj decía «entrada registrada» y Horas, Inicio y Reportes seguían enseñando solo
   * lo sembrado. Andree lo encontró probando —fichó y preguntó dónde verlo— y la
   * respuesta era «en ningún sitio».
   *
   * Es el primer recorrido que intenta cualquiera el primer día, y estaba roto de la
   * peor manera: sin error, simplemente no aparecía.
   */
  const sede = (almacen.get('locations') ?? [])[0];
  registrarFichajeDemo(almacen, {
    employeeId: DEMO_EMPLEADO_KIOSCO,
    locationId: String(sede?.id ?? DEMO_LOCATION_1),
    eventType: tipo,
    breakReason: typeof motivo === 'string' ? motivo : null,
    breakNote: typeof nota === 'string' ? nota : null,
    zona: String(sede?.timezone ?? 'America/Lima'),
  });
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
            /*
             * EL TURNO DE LA JORNADA QUE YA ESTÁ ABIERTA, y no una lista vacía.
             *
             * Con `[]` la pantalla de acciones decía «No tienes un turno programado»
             * mientras la hoja de salida anticipada, justo debajo, decía «tu turno
             * termina a las 23:24». Las dos leen la misma demostración y se
             * contradecían, que es peor que no enseñar ninguna de las dos: quien mira la
             * demostración no sabe cuál de las dos miente.
             *
             * Fuera de turno se queda vacía, que ahí sí es verdad.
             */
            eligibleShifts:
              estado === 'OFF_SHIFT'
                ? []
                : [
                    {
                      id: 'demo-turno-abierto',
                      startsAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
                      endsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
                      jobRoleName: 'Cajero',
                      employeeNote: null,
                      plannedUnpaidBreakMinutes: 60,
                      changedSinceLastPublication: false,
                    },
                  ],
            openSession:
              estado === 'OFF_SHIFT'
                ? null
                : {
                    startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
                    /*
                     * A QUE HORA TERMINA EL TURNO, y no `null` como estaba.
                     *
                     * Con `null` la demostración no podía enseñar dos cosas que la app
                     * sí hace: el «tu turno termina a las …» de la confirmación, y la
                     * pregunta de por qué te vas antes de hora. Las dos dependen de
                     * este dato, así que con un `null` fijo quedaban invisibles —el
                     * mismo patrón de «funciona en la demostración y no en la realidad»
                     * que ya salió con `publication_version`, solo que al revés.
                     *
                     * Cinco horas por delante: Ana lleva tres trabajadas de un turno de
                     * ocho, que es una jornada creíble y además deja la salida
                     * claramente por encima del umbral de media hora.
                     */
                    shiftEndsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
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
          registrarEventoDemo(almacen, tipo, cuerpo.breakReason, cuerpo.breakNote);
          return sinError({
            status: 'accepted',
            eventId: '99999999-9999-4999-8999-999999999999',
            attendanceState: estadoTrasEventoDemo(tipo),
            occurredAt: new Date().toISOString(),
            serverReceivedAt: new Date().toISOString(),
            flags: [],
            summary: {
              shiftEndsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
              netMinutesToday: 180,
            },
          });
        }
        /*
         * LAS DOS DEVOLVIAN UNA FORMA INVENTADA —`{ ok, accepted, rejected }` y
         * `{ ok, employees }`—, que es el mismo fallo que ya tuvieron aqui `verify-pin`
         * y «olvidé marcar»: el cliente valida con Zod y ninguna de las dos pasaba.
         *
         * En la demostracion no hay cola sin conexion ni verificadores que guardar, asi
         * que lo correcto es la respuesta VACIA pero BIEN FORMADA, no una abreviatura.
         * Una demo que responde cualquier cosa es peor que una que no responde: parece
         * que el circuito funciona.
         */
        case 'sync-offline-events':
          return sinError({
            results: [],
            accepted: 0,
            pending: 0,
            syncedAt: new Date().toISOString(),
          });
        case 'refresh-kiosk-roster':
          return sinError({
            location: { id: DEMO_LOCATION_1, name: 'Sede Principal', timezone: 'America/Lima' },
            organization: { name: 'Café Demostración', logoPath: null },
            policies: {
              pinLength: 6,
              photoEnabled: false,
              earlyClockInMinutes: 10,
              lateGraceMinutes: 5,
              allowUnscheduledShifts: true,
              timeFormat: '24h',
              requiredBreakMinutes: 0,
            },
            roster: (almacen.get('employees') ?? []).map((persona) => ({
              opaqueId: String(persona.id),
              displayName: String(persona.preferred_name ?? persona.full_name ?? 'Sin nombre'),
              jobRoleName: null,
            })),
            shifts: [],
            // Sin verificadores: en la demostracion no se ficha sin conexion.
            verifiers: [],
            refreshedAt: new Date().toISOString(),
          });
        /*
         * «OLVIDÉ MARCAR» TIENE QUE FUNCIONAR EN LA DEMO, y no funcionaba.
         *
         * Devolvía `{ ok: true }`, y el cliente valida `{ requestId, status: 'pending' }`
         * con Zod. Resultado: la persona rellenaba el formulario entero, pulsaba Guardar
         * y recibía «No pudimos completar la acción». Es EXACTAMENTE el mismo fallo que
         * ya tuvo `verify-pin` aquí arriba —una forma inventada que no se parece a la
         * que el cliente espera—, y se descubrió igual: recorriendo el flujo en el
         * navegador para enseñárselo a Andree, no leyendo el código. En el servidor de
         * verdad la función devuelve la forma correcta; solo la demo mentía.
         *
         * Además la solicitud se GUARDA, para que aparezca en la Bandeja del gerente
         * como pasaría de verdad. Sin eso, la demo diría «enviamos tu solicitud» y la
         * bandeja seguiría igual: otra contradicción silenciosa.
         */
        case 'submit-time-edit-request': {
          const cuerpo = (_opciones?.body ?? {}) as Record<string, unknown>;
          const empleada = (almacen.get('employees') ?? [])[0];
          const kind = String(cuerpo.kind ?? 'forgot_clock_out');
          const proposedAt = String(cuerpo.proposedAt ?? new Date().toISOString());
          const requestId = `demo-solicitud-${Date.now()}`;
          almacen.set('time_edit_requests', [
            ...(almacen.get('time_edit_requests') ?? []),
            {
              id: requestId,
              organization_id: DEMO_ORG_ID,
              employee_id: empleada?.id ?? 'demo-empleado-1',
              location_id: DEMO_LOCATION_1,
              work_session_id: null,
              target_date: proposedAt.slice(0, 10),
              kind,
              proposed_value:
                kind === 'forgot_clock_in' ? { startsAt: proposedAt } : { endsAt: proposedAt },
              reason: String(cuerpo.reason ?? ''),
              status: 'pending',
              reviewer_comment: null,
              reviewed_at: null,
              created_at: new Date().toISOString(),
            },
          ]);
          return sinError({ requestId, status: 'pending' });
        }
        case 'attach-photo': {
          // La respuesta real trae la ruta donde quedó la foto y el cliente la exige
          // (`attachPhotoResponseSchema`). Sin ella, la demostración daba la subida
          // por fallida y la reintentaba en cada pase, en silencio: no se podía ver
          // funcionar el camino entero de la foto.
          const cuerpo = (_opciones?.body ?? {}) as Record<string, unknown>;
          const eventoId = typeof cuerpo.eventId === 'string' ? cuerpo.eventId : 'sin-evento';
          return sinError({
            ok: true,
            photoPath: `attendance-photos/${DEMO_ORG_ID}/${eventoId}.jpg`,
          });
        }
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
        /*
         * QUIEN TIENE ACCESO, en la demostración.
         *
         * Se simula con nombres inventados y NO con los correos de nadie real: esta
         * pantalla es la que se enseña, y un correo de verdad en una demostración es
         * un dato de una persona expuesto en la pantalla de un comercial.
         *
         * Las mutaciones contestan que sí y no cambian nada. En la demostración no
         * hay a quién invitar ni sesión que revocar, y fingir que el listado cambia
         * haría creer que se puede repartir acceso desde aquí.
         */
        case 'listMembers':
          return sinError({
            members: [
              {
                userId: 'demo-propietaria',
                email: 'propietaria@demostracion.pe',
                displayName: 'Propietaria (demostración)',
                role: 'owner',
                status: 'active',
                isSelf: true,
              },
              {
                userId: 'demo-gerenta',
                email: 'gerenta@demostracion.pe',
                displayName: 'Gerenta (demostración)',
                role: 'manager',
                status: 'active',
                isSelf: false,
              },
            ],
            invitations: [
              {
                email: 'nueva.encargada@demostracion.pe',
                role: 'manager',
                createdAt: new Date().toISOString(),
              },
            ],
          });

        case 'inviteMember':
        case 'setMemberRole':
        case 'revokeMember':
        case 'cancelInvitation':
          return sinError({ ok: true });
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

let instancia: DataClient | null = null;

/** El cliente de demostración, creado una vez por carga de la pestaña. */
export function getDemoClient(): DataClient {
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
    /*
     * IGUAL QUE `from` Y `rpc`: AL USAR, NO AL CONSTRUIR. `functions` era la única que
     * se construía una vez, y capturaba el almacén con el que nació. Tras cerrar sesión
     * —que llama a `reiniciar()` y siembra un almacén nuevo— cada `invoke` del kiosco
     * (verificar PIN, fichar, «olvidé marcar») seguía escribiendo en el VIEJO mientras
     * `from()` leía el nuevo: el reloj decía «entrada registrada» y Horas no la veía.
     *
     * Lo cazó una prueba que envía «olvidé marcar» y espera verla en la bandeja: pasaba
     * sola y fallaba detrás de la prueba que cierra sesión. Dos almacenes, una app.
     */
    functions: {
      invoke: (nombre: string, opciones?: { body?: unknown }) =>
        crearFunctions(almacen).invoke(nombre, opciones),
    },
    storage: crearStorage(),
  };

  instancia = cliente as unknown as DataClient;
  return instancia;
}
