import { DEFAULT_PAID_REASONS, type BreakReason } from '@/domain/break-reason';
import { motivoValido, NOTA_MAXIMA_DE_FALTA } from '@/domain/motivos-de-falta';
import { motivoDeCumplidoValido, NOTA_MAXIMA_DE_CUMPLIDO } from '@/domain/motivos-de-cumplido';
import { crearFrom, type Almacen, type Fila } from './postgrest';
import {
  aplicarEscenario,
  aplicarNombresLargos,
  escenarioDeLaUrl,
  marcaDeLaUrl,
  nombresLargosDeLaUrl,
} from './escenarios';
import {
  DEMO_EMAIL,
  DEMO_LOCATION_1,
  DEMO_ORG_ID,
  DEMO_USER_ID,
  DEMO_VENDEDOR_EMAIL,
  DEMO_EMPLEADOS_DENTRO,
  DEMO_VENDEDOR_USER_ID,
  TZ,
  crearAlmacen,
} from './seed';
import { registrarFichajeDemo } from './reconstruir';
import { addDaysToKey, dateKeyOf, localDateTimeToInstant } from '@/features/schedules/week';
import type { DataClient } from '@/lib/firebase/query';
import {
  esMarcaFueraDelTurno,
  marcasFueraDelTurno,
  MINUTOS_FUERA_DEL_TURNO_POR_DEFECTO,
} from '@/domain/fuera-del-turno';

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

/** Quién entra en la demostración: quien administra, o el vendedor (ver la semilla). */
type QuienDemo = 'admin' | 'vendedor';

function usuarioDemo(quien: QuienDemo) {
  return {
    id: quien === 'vendedor' ? DEMO_VENDEDOR_USER_ID : DEMO_USER_ID,
    email: quien === 'vendedor' ? DEMO_VENDEDOR_EMAIL : DEMO_EMAIL,
    app_metadata: {},
    user_metadata: {
      full_name: quien === 'vendedor' ? 'Vendedor (demostración)' : 'Andree (demostración)',
    },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
}

function sesionDemo(quien: QuienDemo) {
  return {
    access_token: 'demo-access-token',
    refresh_token: 'demo-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: usuarioDemo(quien),
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

/** Quién había entrado, o `null`. `'1'` es quien administra, por las sesiones de antes. */
function sesionGuardada(): QuienDemo | null {
  try {
    const valor = globalThis.localStorage?.getItem(CLAVE_SESION);
    if (valor === 'vendedor') return 'vendedor';
    return valor === '1' ? 'admin' : null;
  } catch {
    // Ventana privada o almacenamiento bloqueado: se empieza fuera, que es lo correcto.
    return null;
  }
}

function recordarSesion(quien: QuienDemo | null): void {
  try {
    if (quien !== null)
      globalThis.localStorage?.setItem(CLAVE_SESION, quien === 'vendedor' ? 'vendedor' : '1');
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
  const guardada = sesionGuardada();
  let sesion: ReturnType<typeof sesionDemo> | null =
    guardada === null ? null : sesionDemo(guardada);
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
    signInWithPassword: async (credenciales: { email: string; password: string }) => {
      const quien: QuienDemo = credenciales.email === DEMO_VENDEDOR_EMAIL ? 'vendedor' : 'admin';
      sesion = sesionDemo(quien);
      recordarSesion(quien);
      avisar('SIGNED_IN');
      return sinError({ session: sesion, user: sesion.user });
    },
    signOut: async (_opciones?: { scope?: string }) => {
      sesion = null;
      recordarSesion(null);
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

      case 'remove_kiosk_device': {
        const id = argumentos.p_device_id;
        almacen.set(
          'kiosk_devices_admin',
          filas('kiosk_devices_admin').filter((fila) => fila.id !== id),
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

      /*
       * APROBAR Y REABRIR, como el servidor: por sede y fechas, creando el periodo si no
       * existe, y negándose con nombres mientras haya jornadas abiertas en él. La versión
       * de antes aprobaba cualquier cosa por id, y por eso la demo nunca enseñó que en la
       * tienda aprobar no funcionaba.
       */
      case 'approve_timesheet_period':
      case 'reopen_timesheet_period': {
        const sede = argumentos.p_location_id;
        const desde = String(argumentos.p_from ?? '');
        const hasta = String(argumentos.p_to ?? '');
        const existente = filas('timesheet_periods').find((fila) =>
          argumentos.p_period_id !== undefined
            ? fila.id === argumentos.p_period_id
            : fila.location_id === sede && fila.starts_on === desde && fila.ends_on === hasta,
        );
        const periodo = existente ?? {
          id: `periodo-${String(sede)}-${desde}-${hasta}`,
          organization_id: DEMO_ORG_ID,
          location_id: sede,
          starts_on: desde,
          ends_on: hasta,
          status: 'open',
          approved_at: null,
        };
        const aprobar = nombre === 'approve_timesheet_period';
        if (aprobar) {
          const zona = String(
            filas('locations').find((fila) => fila.id === periodo.location_id)?.timezone ??
              'America/Lima',
          );
          const diaDe = (instante: unknown) =>
            new Intl.DateTimeFormat('en-CA', {
              timeZone: zona,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date(String(instante)));
          const nombres = new Map(
            filas('employees').map((fila) => [fila.id, fila.preferred_name ?? fila.full_name]),
          );
          const abiertas = [
            ...new Set(
              filas('work_sessions')
                .filter(
                  (fila) =>
                    fila.location_id === periodo.location_id &&
                    fila.ends_at === null &&
                    diaDe(fila.starts_at) >= String(periodo.starts_on) &&
                    diaDe(fila.starts_at) <= String(periodo.ends_on),
                )
                .map((fila) => String(nombres.get(fila.employee_id) ?? '')),
            ),
          ];
          if (abiertas.length > 0) {
            return {
              data: null,
              error: {
                code: 'failed-precondition',
                message: 'Hay jornadas abiertas en el periodo.',
                details: { motivo: 'JORNADAS_ABIERTAS', nombres: abiertas },
              },
            };
          }
        }
        almacen.set('timesheet_periods', [
          ...filas('timesheet_periods').filter((fila) => fila.id !== periodo.id),
          {
            ...periodo,
            status: aprobar ? 'approved' : 'reopened',
            approved_at: aprobar ? new Date().toISOString() : null,
          },
        ]);
        return sinError({ periodId: periodo.id, status: aprobar ? 'approved' : 'reopened' });
      }

      // En la demostración las marcas no se derivan del horario: no hay nada que revisar.
      case 'recheck_sessions_for_period':
        return sinError({ cambiadas: 0 });

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
              // Una salida puesta cierra la jornada, como en el servidor (1-oct): ver
              // `functions/src/shared/salida-a-mano.ts`.
              status:
                nuevoFin === null ? fila.status : fila.status === 'open' ? 'complete' : fila.status,
              updated_at: new Date().toISOString(),
            };
          }),
        );
        if (typeof fin === 'string') {
          almacen.set(
            'employees_working_now',
            filas('employees_working_now').filter((fila) => fila.work_session_id !== id),
          );
        }
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
        // Y su corrección, como en el servidor: la cuenta Reportes.
        almacen.set('time_adjustments', [
          ...filas('time_adjustments'),
          {
            id: `ajuste-${idEvento}`,
            organization_id: DEMO_ORG_ID,
            location_id: argumentos.p_location_id,
            employee_id: argumentos.p_employee_id,
            work_session_id: null,
            target_type: 'time_event',
            target_id: idEvento,
            before_value: null,
            after_value: {
              event_type: argumentos.p_event_type,
              occurred_at: argumentos.p_occurred_at,
            },
            reason: String(argumentos.p_reason ?? ''),
            created_at: new Date().toISOString(),
            channel: 'manager_app',
            author_name: 'Andree (demostración)',
          },
        ]);
        /*
         * UNA ENTRADA QUE FALTABA ABRE SU JORNADA (1-oct), como al reconstruirla en el
         * servidor, atada al turno publicado en que cae. Sin esto, «Vino y no marcó» en las
         * faltas de Horas no quitaba la falta en la demostración: no había jornada que la
         * cubriera. Si a esa hora ya estaba dentro, no se abre otra.
         */
        if (argumentos.p_event_type === 'clock_in') {
          const entrada = String(argumentos.p_occurred_at);
          // Dentro A ESA HORA, no ahora: una entrada de la semana pasada no choca con hoy.
          const yaDentro = filas('work_sessions').some(
            (fila) =>
              fila.employee_id === argumentos.p_employee_id &&
              fila.ends_at === null &&
              String(fila.starts_at) <= entrada,
          );
          if (!yaDentro) {
            const instante = Date.parse(entrada);
            const suTurno = filas('shifts').find(
              (fila) =>
                fila.employee_id === argumentos.p_employee_id &&
                fila.status === 'published' &&
                Date.parse(String(fila.starts_at)) - 2 * 60 * 60_000 <= instante &&
                instante < Date.parse(String(fila.ends_at)),
            );
            const idSesion = `sesion-${idEvento}`;
            almacen.set('work_sessions', [
              ...filas('work_sessions'),
              {
                id: idSesion,
                organization_id: DEMO_ORG_ID,
                employee_id: argumentos.p_employee_id,
                location_id: argumentos.p_location_id,
                shift_id: suTurno?.id ?? null,
                starts_at: entrada,
                ends_at: null,
                gross_minutes: null,
                paid_break_minutes: 0,
                unpaid_break_minutes: 0,
                net_minutes: null,
                status: 'open',
                flags: suTurno === undefined ? ['unscheduled'] : [],
                updated_at: new Date().toISOString(),
              },
            ]);
            /*
             * Y DESDE ESA HORA ESTÁ DENTRO (4-oct), como en el servidor, donde «quién está
             * dentro» son las jornadas abiertas. Sin esto la entrada puesta a la hora del turno
             * —la tienda abrió tarde— no la ponía «Trabajando» en Inicio ni en Horario. La
             * salida de abajo la vuelve a quitar.
             */
            const empleado = filas('employees').find(
              (fila) => fila.id === argumentos.p_employee_id,
            );
            almacen.set('employees_working_now', [
              ...filas('employees_working_now').filter(
                (fila) => fila.employee_id !== argumentos.p_employee_id,
              ),
              {
                organization_id: DEMO_ORG_ID,
                location_id: argumentos.p_location_id,
                work_session_id: idSesion,
                employee_id: argumentos.p_employee_id,
                full_name: empleado?.full_name ?? 'Empleado',
                preferred_name: empleado?.preferred_name ?? null,
                starts_at: entrada,
                shift_id: suTurno?.id ?? null,
                break_started_at: null,
                break_reason: null,
                attendance_state: 'WORKING',
              },
            ]);
            // La forma del servidor: ver `manualEventRowSchema`.
            return sinError({ eventId: idEvento, workSessionId: idSesion });
          }
        }
        /*
         * UNA SALIDA QUE FALTABA CIERRA SU JORNADA, como al reconstruirla en el servidor:
         * sin esto, «Marcar salida a las 19:00» en «Por resolver» no cambiaba nada en la
         * demostración. Solo la jornada abierta de esa persona que empezó antes de la salida.
         */
        if (argumentos.p_event_type === 'clock_out') {
          const salida = String(argumentos.p_occurred_at);
          const abierta = filas('work_sessions').find(
            (fila) =>
              fila.employee_id === argumentos.p_employee_id &&
              fila.ends_at === null &&
              String(fila.starts_at) < salida,
          );
          if (abierta !== undefined) {
            const brutos = Math.round(
              (Date.parse(salida) - Date.parse(String(abierta.starts_at))) / 60_000,
            );
            const sinPagar = Number(abierta.unpaid_break_minutes ?? 0);
            almacen.set(
              'work_sessions',
              filas('work_sessions').map((fila) =>
                fila.id !== abierta.id
                  ? fila
                  : {
                      ...fila,
                      ends_at: salida,
                      gross_minutes: brutos,
                      net_minutes: brutos - sinPagar,
                      status: 'complete',
                    },
              ),
            );
            // Solo si la que se cierra es la de ahora: cerrar la de la semana pasada no saca
            // de la tienda a quien está trabajando hoy.
            almacen.set(
              'employees_working_now',
              filas('employees_working_now').filter((fila) => fila.work_session_id !== abierta.id),
            );
            return sinError({ eventId: idEvento, workSessionId: abierta.id });
          }
        }
        return sinError({ eventId: idEvento, workSessionId: null });
      }

      /*
       * PUBLICAR, que en la demostración NO FUNCIONABA: no estaba simulada, así que el
       * botón «Publicar horario» devolvía un error y los turnos se quedaban en borrador
       * sin que la pantalla lo dijera. Lo cazó el 30-sep `cumplido-check`, el primer arnés
       * que publica. Hace lo mismo que `publishShiftsForWeek`: solo los borradores de esa
       * sede, con la versión siguiente de la semana, y deja su publicación en el historial.
       */
      case 'publish_shifts_for_week': {
        const sede = argumentos.p_location_id;
        const semana = argumentos.p_week_start;
        const ids = new Set(Array.isArray(argumentos.p_shift_ids) ? argumentos.p_shift_ids : []);
        const version =
          Math.max(
            0,
            ...filas('shift_publications')
              .filter((fila) => fila.location_id === sede && fila.week_starts_on === semana)
              .map((fila) => Number(fila.publication_version ?? 0)),
          ) + 1;
        const ahora = new Date().toISOString();
        const publicados: unknown[] = [];
        almacen.set(
          'shifts',
          filas('shifts').map((fila) => {
            if (!ids.has(fila.id) || fila.location_id !== sede || fila.status !== 'draft') {
              return fila;
            }
            publicados.push(fila.id);
            return {
              ...fila,
              status: 'published',
              publication_version: version,
              published_at: ahora,
              updated_at: ahora,
            };
          }),
        );
        /*
         * Y LAS JORNADAS DE ESOS TURNOS SE VUELVEN A MEDIR, como en el servidor
         * (`revisarSesiones`): si el turno nuevo cubre la hora a la que entró, la marca rara
         * se va. Solo las dos marcas fuera del turno: el resto la demostración no las mide.
         */
        if (publicados.length > 0) {
          const turnos = new Map(filas('shifts').map((fila) => [fila.id, fila]));
          almacen.set(
            'work_sessions',
            filas('work_sessions').map((fila) => {
              const turno = typeof fila.shift_id === 'string' ? turnos.get(fila.shift_id) : null;
              if (turno === undefined || turno === null || !publicados.includes(fila.shift_id)) {
                return fila;
              }
              const otras = (Array.isArray(fila.flags) ? (fila.flags as string[]) : []).filter(
                (marca) => !esMarcaFueraDelTurno(marca),
              );
              return {
                ...fila,
                flags: [
                  ...otras,
                  ...marcasFueraDelTurno({
                    entrada: String(fila.starts_at),
                    salida: (fila.ends_at as string | null) ?? null,
                    turno: { starts_at: String(turno.starts_at), ends_at: String(turno.ends_at) },
                    umbralMinutos: MINUTOS_FUERA_DEL_TURNO_POR_DEFECTO,
                  }),
                ],
              };
            }),
          );
        }
        if (publicados.length > 0) {
          almacen.set('shift_publications', [
            ...filas('shift_publications'),
            {
              id: `publicacion-${String(semana)}-${version}`,
              organization_id: DEMO_ORG_ID,
              location_id: sede,
              week_starts_on: semana,
              publication_version: version,
              published_by: null,
              published_at: ahora,
              changed_shift_ids: publicados,
              created_at: ahora,
            },
          ]);
        }
        return sinError({ version, publicados: publicados.length });
      }

      /*
       * «Registrar como cumplido», con las mismas reglas que el servidor
       * (`functions/src/horario-cumplido.ts`): solo turnos publicados y terminados, de
       * días anteriores al primer fichaje del reloj en la sede, y sin jornada ya. Aquí se
       * escriben directamente la jornada y su resumen del día, que en la demostración son
       * tablas y no proyecciones.
       */
      case 'register_schedule_as_worked': {
        const sede = argumentos.p_location_id;
        const dias = new Set(Array.isArray(argumentos.p_dias) ? argumentos.p_dias : []);
        const zona = String(
          filas('locations').find((fila) => fila.id === sede)?.timezone ?? 'America/Lima',
        );
        const diaDe = (instante: unknown) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(String(instante)));
        const primero = filas('time_events')
          .filter((fila) => fila.location_id === sede && fila.source === 'kiosk')
          .map((fila) => String(fila.occurred_at))
          .sort()[0];
        const relojDesde = primero === undefined ? null : diaDe(primero);

        const saltados = {
          sinPublicar: 0,
          noTermino: 0,
          conReloj: 0,
          yaTieneMarcas: 0,
          jornadaAbierta: 0,
        };
        const porDia: Record<string, { turnos: number; minutos: number }> = {};
        const sesiones = filas('work_sessions');
        const netos = (turno: Fila) =>
          minutosEntre(String(turno.starts_at), String(turno.ends_at)) -
          Number(turno.planned_unpaid_break_minutes ?? 0);
        const aptos = filas('shifts')
          .filter(
            (fila) =>
              fila.location_id === sede &&
              fila.status !== 'cancelled' &&
              dias.has(diaDe(fila.starts_at)),
          )
          .filter((turno) => {
            const dia = diaDe(turno.starts_at);
            const pisa = sesiones.some(
              (sesion) =>
                sesion.employee_id === turno.employee_id &&
                String(sesion.starts_at) < String(turno.ends_at) &&
                String(sesion.ends_at ?? '9999') > String(turno.starts_at),
            );
            const salto =
              turno.status !== 'published'
                ? 'sinPublicar'
                : Date.parse(String(turno.ends_at)) > Date.now()
                  ? 'noTermino'
                  : relojDesde !== null && dia >= relojDesde
                    ? 'conReloj'
                    : pisa
                      ? 'yaTieneMarcas'
                      : null;
            if (salto !== null) {
              saltados[salto] += 1;
              return false;
            }
            const cuenta = porDia[dia] ?? { turnos: 0, minutos: 0 };
            cuenta.turnos += 1;
            cuenta.minutos += netos(turno);
            porDia[dia] = cuenta;
            return true;
          });
        const minutos = aptos.reduce((suma, turno) => suma + netos(turno), 0);
        if (argumentos.p_simular === true) {
          return sinError({ relojDesde, porDia, saltados, turnos: aptos.length, minutos });
        }

        const nuevas = aptos.map((turno) => {
          const brutos = minutosEntre(String(turno.starts_at), String(turno.ends_at));
          const pausa = Number(turno.planned_unpaid_break_minutes ?? 0);
          return {
            id: `horario-${String(turno.id)}`,
            organization_id: DEMO_ORG_ID,
            employee_id: turno.employee_id,
            location_id: sede,
            shift_id: turno.id,
            starts_at: turno.starts_at,
            ends_at: turno.ends_at,
            gross_minutes: brutos,
            paid_break_minutes: 0,
            unpaid_break_minutes: pausa,
            net_minutes: brutos - pausa,
            status: 'complete',
            flags: [],
            departure_reason: null,
            departure_note: null,
            source: 'import',
            updated_at: new Date().toISOString(),
          };
        });
        almacen.set('work_sessions', [...sesiones, ...nuevas]);
        almacen.set('daily_time_summary', [
          ...filas('daily_time_summary'),
          ...nuevas.map((sesion) => ({
            employee_id: sesion.employee_id,
            location_id: sede,
            work_date: diaDe(sesion.starts_at),
            sessions: 1,
            gross_minutes: sesion.gross_minutes,
            paid_break_minutes: 0,
            unpaid_break_minutes: sesion.unpaid_break_minutes,
            net_minutes: sesion.net_minutes,
            needs_review: false,
            flags: [],
          })),
        ]);
        return sinError({ relojDesde, registrados: nuevas.length, minutos, saltados });
      }

      /*
       * RESOLVER UNA SOLICITUD, como `functions/src/solicitudes.ts`.
       *
       * AQUÍ ESTABA EL AGUJERO QUE ESCONDIÓ EL FALLO: la bandeja escribía la solicitud a
       * pelo, la demostración lo aceptaba —es una tabla en memoria, sin reglas— y en
       * producción Firestore lo rechazaba. El arnés aprobaba sin problema lo que en la
       * tienda no se podía aprobar. Ahora las dos pasan por la misma función, y la
       * demostración hace su parte: registra el fichaje y arregla la jornada y el
       * resumen del día, que aquí son tablas y no proyecciones.
       */
      case 'review_time_edit_request': {
        const id = argumentos.p_request_id;
        const decision = String(argumentos.p_decision ?? '');
        const comentario =
          typeof argumentos.p_comment === 'string' && argumentos.p_comment.trim() !== ''
            ? argumentos.p_comment.trim()
            : null;
        const solicitud = filas('time_edit_requests').find((fila) => fila.id === id);
        if (solicitud === undefined) return conError('Esa solicitud no existe.');
        const guardar = (cambios: Fila) =>
          almacen.set(
            'time_edit_requests',
            filas('time_edit_requests').map((fila) =>
              fila.id === id ? { ...fila, ...cambios, updated_at: new Date().toISOString() } : fila,
            ),
          );

        if (decision === 'comment') {
          guardar({ reviewer_comment: comentario });
          return sinError({ status: solicitud.status, applied: false, eventIds: [] });
        }
        if (solicitud.status !== 'pending') {
          return {
            data: null,
            error: {
              code: 'failed-precondition',
              message: 'Esa solicitud ya se resolvió.',
              details: { motivo: 'YA_RESUELTA' },
            },
          };
        }
        const resolucion = {
          status: decision,
          reviewed_at: new Date().toISOString(),
          reviewer_comment: comentario ?? solicitud.reviewer_comment ?? null,
        };
        const fichajes = Array.isArray(argumentos.p_events)
          ? (argumentos.p_events as { type: string; occurred_at: string }[])
          : [];
        const registra = ['forgot_clock_in', 'forgot_clock_out', 'forgot_break'].includes(
          String(solicitud.kind),
        );
        if (decision !== 'approved' || !registra) {
          guardar(resolucion);
          return sinError({ status: decision, applied: false, eventIds: [] });
        }
        if (fichajes.length === 0) {
          return {
            data: null,
            error: {
              code: 'invalid-argument',
              message: 'Faltan los fichajes.',
              details: { motivo: 'FICHAJES' },
            },
          };
        }

        const empleado = solicitud.employee_id;
        const sede = solicitud.location_id;
        const zona = String(
          filas('locations').find((fila) => fila.id === sede)?.timezone ?? 'America/Lima',
        );
        const diaDe = (instante: unknown) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(String(instante)));
        const cuando = (tipo: string) =>
          fichajes.find((fichaje) => fichaje.type === tipo)?.occurred_at;
        const eventIds = fichajes.map((_, i) => `solicitud-${String(id)}-${i}`);

        almacen.set('time_events', [
          ...filas('time_events'),
          ...fichajes.map((fichaje, i) => ({
            id: eventIds[i],
            organization_id: DEMO_ORG_ID,
            employee_id: empleado,
            location_id: sede,
            event_type: fichaje.type,
            break_type: fichaje.type === 'break_start' ? 'unpaid' : null,
            occurred_at: fichaje.occurred_at,
            source: 'manager',
            is_offline: false,
          })),
        ]);

        const recalcular = (sesion: Fila, cambios: Fila): Fila => {
          const junta = { ...sesion, ...cambios };
          const fin = junta.ends_at as string | null;
          const brutos = fin === null ? null : minutosEntre(String(junta.starts_at), fin);
          const pausa = Number(junta.unpaid_break_minutes ?? 0);
          return {
            ...junta,
            gross_minutes: brutos,
            net_minutes: brutos === null ? null : brutos - pausa,
            status: fin === null ? 'open' : 'complete',
            updated_at: new Date().toISOString(),
          };
        };
        const suyas = filas('work_sessions').filter((fila) => fila.employee_id === empleado);
        const entrada = cuando('clock_in');
        const salida = cuando('clock_out');
        const inicioPausa = cuando('break_start');
        const finPausa = cuando('break_end');
        let tocada: Fila | undefined;

        if (entrada !== undefined) {
          // La entrada tardía del mismo día se sustituye; si no hay, es una jornada nueva.
          const tardia = suyas.find(
            (fila) => diaDe(fila.starts_at) === diaDe(entrada) && String(fila.starts_at) >= entrada,
          );
          tocada = recalcular(
            tardia ?? {
              id: `solicitud-sesion-${String(id)}`,
              organization_id: DEMO_ORG_ID,
              employee_id: empleado,
              location_id: sede,
              shift_id: null,
              ends_at: null,
              paid_break_minutes: 0,
              unpaid_break_minutes: 0,
              flags: [],
              departure_reason: null,
              departure_note: null,
              source: 'manager',
            },
            { starts_at: entrada, ...(salida === undefined ? {} : { ends_at: salida }) },
          );
        } else {
          const instante = salida ?? finPausa ?? inicioPausa ?? '';
          // La jornada de ESE día, o una que siga abierta: no la de la semana pasada.
          const suya = suyas
            .filter(
              (fila) =>
                String(fila.starts_at) <= instante &&
                (diaDe(fila.starts_at) === diaDe(instante) || fila.ends_at === null),
            )
            .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)))[0];
          if (suya === undefined) {
            return {
              data: null,
              error: {
                code: 'failed-precondition',
                message: 'A esa hora no figuraba dentro.',
                details: { motivo: 'NO_ENCAJA', tipo: fichajes[0]?.type, estado: 'OFF_SHIFT' },
              },
            };
          }
          const pausa =
            inicioPausa !== undefined && finPausa !== undefined
              ? minutosEntre(inicioPausa, finPausa)
              : 0;
          tocada = recalcular(suya, {
            ...(salida === undefined ? {} : { ends_at: salida }),
            unpaid_break_minutes: Number(suya.unpaid_break_minutes ?? 0) + pausa,
          });
        }

        const final = tocada;
        almacen.set('work_sessions', [
          ...filas('work_sessions').filter((fila) => fila.id !== final.id),
          final,
        ]);
        const dia = diaDe(final.starts_at);
        const delDia = filas('work_sessions').filter(
          (fila) =>
            fila.employee_id === empleado &&
            fila.location_id === sede &&
            diaDe(fila.starts_at) === dia,
        );
        const suma = (campo: string) =>
          delDia.reduce((total, fila) => total + Number(fila[campo] ?? 0), 0);
        almacen.set('daily_time_summary', [
          ...filas('daily_time_summary').filter(
            (fila) =>
              !(
                fila.employee_id === empleado &&
                fila.location_id === sede &&
                fila.work_date === dia
              ),
          ),
          {
            employee_id: empleado,
            location_id: sede,
            work_date: dia,
            sessions: delDia.length,
            gross_minutes: suma('gross_minutes'),
            paid_break_minutes: suma('paid_break_minutes'),
            unpaid_break_minutes: suma('unpaid_break_minutes'),
            net_minutes: suma('net_minutes'),
            needs_review: false,
            flags: [],
          },
        ]);

        almacen.set('time_adjustments', [
          ...filas('time_adjustments'),
          ...fichajes.map((fichaje, i) => ({
            id: `ajuste-${eventIds[i]}`,
            organization_id: DEMO_ORG_ID,
            location_id: sede,
            employee_id: empleado,
            request_id: id,
            work_session_id: final.id,
            target_type: 'time_event',
            target_id: eventIds[i],
            before_value: null,
            after_value: { event_type: fichaje.type, occurred_at: fichaje.occurred_at },
            reason: `Solicitud aprobada: ${String(solicitud.reason ?? '')}`,
            created_at: new Date().toISOString(),
            channel: 'manager_app',
            author_name: 'Andree (demostración)',
          })),
        ]);
        guardar({ ...resolucion, work_session_id: final.id, applied_event_ids: eventIds });
        return sinError({
          status: 'approved',
          applied: true,
          eventIds,
          workSessionId: final.id,
        });
      }

      /*
       * LAS CORRECCIONES DEL PERIODO, como `functions/src/correcciones.ts`: una fila por
       * corrección, en el día que corrige, de la sede pedida. Mismo criterio de tipos.
       */
      // En la demostración las jornadas no guardan marcas contra el turno: nada que revisar.
      case 'recheck_sessions_for_shift':
        return sinError(null);

      /*
       * «POR RESOLVER» EN LA DEMOSTRACIÓN (1-oct), con las mismas reglas que
       * `functions/src/casos.ts`. La jornada y su resumen del día se tocan aquí directamente:
       * en la demostración son tablas, no proyecciones.
       */
      case 'resolve_session_case': {
        const id = String(argumentos.p_work_session_id ?? '');
        const caso = String(argumentos.p_case ?? '');
        const decision = String(argumentos.p_decision ?? '');
        const sesion = filas('work_sessions').find((fila) => fila.id === id);
        if (sesion === undefined) return conError('Esa jornada no existe.');
        if (decision === 'owes') {
          const zona = String(
            filas('locations').find((fila) => fila.id === sesion.location_id)?.timezone ??
              'America/Lima',
          );
          const dia = new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(String(sesion.starts_at)));
          const ahora = new Date().toISOString();
          almacen.set('owed_hours', [
            ...filas('owed_hours').filter((fila) => fila.id !== id),
            {
              id,
              organization_id: DEMO_ORG_ID,
              location_id: sesion.location_id,
              employee_id: sesion.employee_id,
              work_session_id: id,
              work_date: dia,
              minutes: Number(argumentos.p_minutes ?? 0),
              note: typeof argumentos.p_note === 'string' ? argumentos.p_note : null,
              status: 'pending',
              created_at: ahora,
              updated_at: ahora,
            },
          ]);
        }
        almacen.set(
          'work_sessions',
          filas('work_sessions').map((fila) =>
            fila.id !== id
              ? fila
              : {
                  ...fila,
                  casos_resueltos: [
                    ...new Set([
                      ...(Array.isArray(fila.casos_resueltos)
                        ? (fila.casos_resueltos as string[])
                        : []),
                      caso,
                    ]),
                  ],
                },
          ),
        );
        return sinError({ caso, decision });
      }

      case 'apply_planned_break': {
        const id = String(argumentos.p_work_session_id ?? '');
        const sesion = filas('work_sessions').find((fila) => fila.id === id);
        const turno = filas('shifts').find((fila) => fila.id === sesion?.shift_id);
        const minutos = Number(turno?.planned_unpaid_break_minutes ?? 0);
        if (sesion === undefined || turno === undefined || minutos <= 0) {
          return conError('Su turno no tiene refrigerio que descontar.');
        }
        if (Number(sesion.unpaid_break_minutes ?? 0) + Number(sesion.paid_break_minutes ?? 0) > 0) {
          return conError('Esa jornada ya tiene su pausa.');
        }
        const zona = String(
          filas('locations').find((fila) => fila.id === sesion.location_id)?.timezone ??
            'America/Lima',
        );
        const dia = new Intl.DateTimeFormat('en-CA', {
          timeZone: zona,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(String(sesion.starts_at)));
        almacen.set(
          'work_sessions',
          filas('work_sessions').map((fila) =>
            fila.id !== id
              ? fila
              : {
                  ...fila,
                  unpaid_break_minutes: Number(fila.unpaid_break_minutes ?? 0) + minutos,
                  net_minutes: Number(fila.net_minutes ?? 0) - minutos,
                },
          ),
        );
        almacen.set(
          'daily_time_summary',
          filas('daily_time_summary').map((fila) =>
            fila.employee_id !== sesion.employee_id ||
            fila.location_id !== sesion.location_id ||
            fila.work_date !== dia
              ? fila
              : {
                  ...fila,
                  unpaid_break_minutes: Number(fila.unpaid_break_minutes ?? 0) + minutos,
                  net_minutes: Number(fila.net_minutes ?? 0) - minutos,
                },
          ),
        );
        return sinError({ minutos });
      }

      /*
       * LA DISPONIBILIDAD EN LA DEMOSTRACIÓN (1-oct), con las reglas de
       * `functions/src/disponibilidad.ts`: desde el celular es la del vendedor y llega
       * nueva; desde el panel, ya vista.
       */
      case 'save_availability': {
        const id =
          typeof argumentos.p_id === 'string' && argumentos.p_id !== '' ? argumentos.p_id : null;
        const previa = id === null ? undefined : filas('availability').find((f) => f.id === id);
        const delVendedor = filas('organization_memberships').find(
          (f) => f.user_id === DEMO_VENDEDOR_USER_ID,
        )?.employee_id;
        const desdeElCelular =
          argumentos.p_employee_id === null || argumentos.p_employee_id === undefined;
        const employeeId =
          previa?.employee_id ?? (desdeElCelular ? delVendedor : argumentos.p_employee_id);
        const conHoras = typeof argumentos.p_from === 'string' && argumentos.p_from !== '';
        const fila = {
          id: id ?? `demo-disp-${Date.now().toString(36)}`,
          organization_id: DEMO_ORG_ID,
          employee_id: employeeId,
          kind: argumentos.p_kind,
          weekday: argumentos.p_kind === 'weekly' ? Number(argumentos.p_weekday) : null,
          date: argumentos.p_kind === 'date' ? argumentos.p_date : null,
          type: argumentos.p_type,
          from_time: conHoras ? argumentos.p_from : null,
          to_time: conHoras ? argumentos.p_to : null,
          note:
            typeof argumentos.p_note === 'string' && argumentos.p_note !== ''
              ? argumentos.p_note
              : null,
          status: desdeElCelular ? 'new' : 'seen',
          source: desdeElCelular ? 'employee' : 'manager',
          updated_at: new Date().toISOString(),
        };
        almacen.set('availability', [
          ...filas('availability').filter((f) => f.id !== fila.id),
          fila,
        ]);
        return sinError({ id: fila.id });
      }

      case 'delete_availability': {
        almacen.set(
          'availability',
          filas('availability').filter((f) => f.id !== argumentos.p_id),
        );
        return sinError({ id: argumentos.p_id });
      }

      case 'mark_availability_seen': {
        const ids = new Set(Array.isArray(argumentos.p_ids) ? argumentos.p_ids : []);
        almacen.set(
          'availability',
          filas('availability').map((f) => (ids.has(f.id) ? { ...f, status: 'seen' } : f)),
        );
        return sinError({ vistas: ids.size });
      }

      case 'settle_owed_hours': {
        const id = String(argumentos.p_owed_id ?? '');
        const estado = String(argumentos.p_status ?? 'pending');
        almacen.set(
          'owed_hours',
          filas('owed_hours').map((fila) => (fila.id === id ? { ...fila, status: estado } : fila)),
        );
        return sinError({ status: estado });
      }

      /* «Visto, está bien así», como `acknowledgeUnusualClock`: por marca, en la jornada. */
      case 'acknowledge_unusual_clock': {
        const id = argumentos.p_work_session_id;
        let vistos: string[] = [];
        almacen.set(
          'work_sessions',
          filas('work_sessions').map((fila) => {
            if (fila.id !== id) return fila;
            const raras = (Array.isArray(fila.flags) ? (fila.flags as string[]) : []).filter(
              esMarcaFueraDelTurno,
            );
            const antes = Array.isArray(fila.avisos_vistos) ? (fila.avisos_vistos as string[]) : [];
            vistos = [...new Set([...antes, ...raras])];
            return { ...fila, avisos_vistos: vistos, updated_at: new Date().toISOString() };
          }),
        );
        return sinError({ vistos });
      }

      /*
       * «¿POR QUÉ FALTÓ?» (2-oct), como `resolveAbsence` en el servidor: un turno publicado
       * que ya terminó, un tipo y un motivo que vayan juntos, y la nota si es «Otro».
       */
      case 'resolve_absence': {
        const turno = filas('shifts').find((fila) => fila.id === argumentos.p_shift_id);
        if (turno === undefined || turno.status !== 'published') {
          return conError('Ese turno no está publicado.');
        }
        if (Date.parse(String(turno.ends_at)) > Date.now()) {
          return conError('Ese turno todavía no terminó.');
        }
        if (!motivoValido(argumentos.p_kind, argumentos.p_reason)) {
          return conError('Ese motivo no vale para ese tipo de falta.');
        }
        const nota =
          typeof argumentos.p_note === 'string' && argumentos.p_note.trim() !== ''
            ? argumentos.p_note.trim().slice(0, NOTA_MAXIMA_DE_FALTA)
            : null;
        if (argumentos.p_reason === 'other' && nota === null) {
          return conError('Con «Otro motivo» hay que escribir qué pasó.');
        }
        const zona = String(
          filas('locations').find((fila) => fila.id === turno.location_id)?.timezone ??
            'America/Lima',
        );
        const ahora = new Date().toISOString();
        const previa = filas('absence_resolutions').find((fila) => fila.id === turno.id);
        const fila = {
          id: turno.id,
          organization_id: DEMO_ORG_ID,
          location_id: turno.location_id,
          employee_id: turno.employee_id,
          shift_id: turno.id,
          work_date: new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(String(turno.starts_at))),
          kind: argumentos.p_kind,
          reason: argumentos.p_reason,
          note: nota,
          decided_at: previa?.decided_at ?? ahora,
          updated_at: ahora,
        };
        almacen.set('absence_resolutions', [
          ...filas('absence_resolutions').filter((f) => f.id !== fila.id),
          fila,
        ]);
        return sinError({ id: fila.id });
      }

      /*
       * «VINO Y NO MARCÓ» DE UNA VEZ (4-oct), como `registerMissedAttendance`: entrada y
       * salida juntas, con ids fijos por turno, y repetirlo no duplica nada.
       */
      case 'register_missed_attendance': {
        const turno = filas('shifts').find((fila) => fila.id === argumentos.p_shift_id);
        if (turno === undefined) return conError('Ese turno ya no existe.');
        const entrada = String(argumentos.p_starts_at);
        const salida = String(argumentos.p_ends_at);
        if (Date.parse(salida) <= Date.parse(entrada)) {
          return conError('La salida tiene que ser después de la entrada.');
        }
        const idEntrada = `vino-${String(turno.id)}-entrada`;
        if (filas('time_events').some((fila) => fila.id === idEntrada)) {
          return sinError({
            eventIds: [idEntrada, `vino-${String(turno.id)}-salida`],
            repetido: true,
          });
        }
        const pisa = filas('work_sessions').some(
          (sesion) =>
            sesion.employee_id === turno.employee_id &&
            Date.parse(String(sesion.starts_at)) < Date.parse(salida) &&
            Date.parse(String(sesion.ends_at ?? '9999-12-31')) > Date.parse(entrada),
        );
        if (pisa) {
          return {
            data: null,
            error: {
              code: 'failed-precondition',
              message: 'Entre esa entrada y esa salida ya hay marcas: corrígelas en Horas.',
              details: { motivo: 'CON_MARCAS' },
            },
          };
        }
        const ahora = new Date().toISOString();
        const eventos = (['clock_in', 'clock_out'] as const).map((tipo) => ({
          id: tipo === 'clock_in' ? idEntrada : `vino-${String(turno.id)}-salida`,
          organization_id: DEMO_ORG_ID,
          employee_id: turno.employee_id,
          location_id: turno.location_id,
          shift_id: turno.id,
          event_type: tipo,
          break_type: null,
          occurred_at: tipo === 'clock_in' ? entrada : salida,
          source: 'manager',
          is_offline: false,
        }));
        almacen.set('time_events', [...filas('time_events'), ...eventos]);
        const brutos = minutosEntre(entrada, salida);
        almacen.set('work_sessions', [
          ...filas('work_sessions'),
          {
            id: `vino-${String(turno.id)}`,
            organization_id: DEMO_ORG_ID,
            employee_id: turno.employee_id,
            location_id: turno.location_id,
            shift_id: turno.id,
            starts_at: entrada,
            ends_at: salida,
            gross_minutes: brutos,
            paid_break_minutes: 0,
            unpaid_break_minutes: 0,
            net_minutes: brutos,
            status: 'complete',
            flags: [],
            source: 'manager',
            updated_at: ahora,
          },
        ]);
        almacen.set('time_adjustments', [
          ...filas('time_adjustments'),
          ...eventos.map((evento) => ({
            id: `ajuste-${evento.id}`,
            organization_id: DEMO_ORG_ID,
            location_id: turno.location_id,
            employee_id: turno.employee_id,
            work_session_id: null,
            target_type: 'time_event',
            target_id: evento.id,
            before_value: null,
            after_value: { event_type: evento.event_type, occurred_at: evento.occurred_at },
            reason: String(argumentos.p_reason ?? ''),
            created_at: ahora,
            channel: 'manager_app',
            author_name: 'Andree (demostración)',
          })),
        ]);
        return sinError({ eventIds: eventos.map((evento) => evento.id), repetido: false });
      }

      /*
       * DAR UN TURNO POR CUMPLIDO POR UN MOTIVO ESPECIAL (4-oct), con las reglas de
       * `functions/src/cumplido-especial.ts`: publicado, terminado, sin marcas cerca; crea la
       * jornada a la hora del turno con el motivo, y lo que se dijo de su falta sobra.
       */
      case 'credit_shift_as_worked': {
        const turno = filas('shifts').find((fila) => fila.id === argumentos.p_shift_id);
        if (turno === undefined || turno.status !== 'published') {
          return conError('Ese turno no está publicado.');
        }
        if (Date.parse(String(turno.ends_at)) > Date.now()) {
          return conError('Ese turno todavía no terminó.');
        }
        if (!motivoDeCumplidoValido(argumentos.p_reason)) return conError('Elige el motivo.');
        const nota =
          typeof argumentos.p_note === 'string' && argumentos.p_note.trim() !== ''
            ? argumentos.p_note.trim().slice(0, NOTA_MAXIMA_DE_CUMPLIDO)
            : null;
        if (argumentos.p_reason === 'other' && nota === null) return conError('Escribe qué pasó.');
        // Solo DENTRO de las horas del turno, como `marcasDentroDelTurno` en el servidor:
        // quien trabajó la mañana y faltó al cierre se puede dar por cumplido.
        const pisa = filas('work_sessions').some(
          (sesion) =>
            sesion.employee_id === turno.employee_id &&
            Date.parse(String(sesion.starts_at)) < Date.parse(String(turno.ends_at)) &&
            Date.parse(String(sesion.ends_at ?? '9999-12-31')) >
              Date.parse(String(turno.starts_at)),
        );
        if (pisa) {
          return {
            data: null,
            error: {
              code: 'failed-precondition',
              message: 'Ese día ya tiene marcas: corrige sus horas en Horas.',
              details: { motivo: 'CON_MARCAS' },
            },
          };
        }
        const brutos = minutosEntre(String(turno.starts_at), String(turno.ends_at));
        const pausa = Number(turno.planned_unpaid_break_minutes ?? 0);
        const ahora = new Date().toISOString();
        almacen.set('work_sessions', [
          ...filas('work_sessions'),
          {
            id: `especial-${String(turno.id)}`,
            organization_id: DEMO_ORG_ID,
            employee_id: turno.employee_id,
            location_id: turno.location_id,
            shift_id: turno.id,
            starts_at: turno.starts_at,
            ends_at: turno.ends_at,
            gross_minutes: brutos,
            paid_break_minutes: 0,
            unpaid_break_minutes: pausa,
            net_minutes: brutos - pausa,
            status: 'complete',
            flags: [],
            departure_reason: null,
            departure_note: null,
            source: 'import',
            credit_reason: argumentos.p_reason,
            credit_note: nota,
            updated_at: ahora,
          },
        ]);
        almacen.set('time_adjustments', [
          ...filas('time_adjustments'),
          {
            id: `especial-ajuste-${String(turno.id)}`,
            organization_id: DEMO_ORG_ID,
            location_id: turno.location_id,
            employee_id: turno.employee_id,
            work_session_id: `especial-${String(turno.id)}`,
            target_type: 'work_session',
            target_id: `especial-${String(turno.id)}`,
            before_value: null,
            after_value: {
              starts_at: turno.starts_at,
              ends_at: turno.ends_at,
              origen: 'especial',
              motivo_especial: argumentos.p_reason,
            },
            reason: `Cumplido por motivo especial (${String(argumentos.p_reason)})`,
            created_by: DEMO_USER_ID,
            created_at: ahora,
          },
        ]);
        almacen.set(
          'absence_resolutions',
          filas('absence_resolutions').filter((f) => f.id !== turno.id),
        );
        // El resumen del día, que en la demo es una tabla y en el servidor se calcula de las
        // jornadas: sin esta fila, Equipo no sumaría el día.
        const zona = String(
          filas('locations').find((fila) => fila.id === turno.location_id)?.timezone ??
            'America/Lima',
        );
        almacen.set('daily_time_summary', [
          ...filas('daily_time_summary'),
          {
            employee_id: turno.employee_id,
            location_id: turno.location_id,
            work_date: new Intl.DateTimeFormat('en-CA', {
              timeZone: zona,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date(String(turno.starts_at))),
            sessions: 1,
            gross_minutes: brutos,
            paid_break_minutes: 0,
            unpaid_break_minutes: pausa,
            net_minutes: brutos - pausa,
            needs_review: false,
            flags: [],
            cumplido_de: turno.id,
          },
        ]);
        return sinError({ id: turno.id, minutos: brutos - pausa });
      }

      case 'undo_shift_credit': {
        const id = `especial-${String(argumentos.p_shift_id)}`;
        if (!filas('work_sessions').some((f) => f.id === id)) {
          return conError('Ese turno no está dado por cumplido.');
        }
        almacen.set(
          'work_sessions',
          filas('work_sessions').filter((f) => f.id !== id),
        );
        almacen.set(
          'daily_time_summary',
          filas('daily_time_summary').filter((f) => f.cumplido_de !== argumentos.p_shift_id),
        );
        return sinError({ id: argumentos.p_shift_id });
      }

      case 'clear_absence_resolution': {
        almacen.set(
          'absence_resolutions',
          filas('absence_resolutions').filter((f) => f.id !== argumentos.p_shift_id),
        );
        return sinError({ id: argumentos.p_shift_id });
      }

      case 'view_clock_start': {
        /*
         * El primer día con un fichaje del reloj en cada sede, en su zona: la misma cuenta
         * que `primerDiaDelReloj` en el servidor (1-oct).
         */
        const sedes = Array.isArray(argumentos.p_location_ids)
          ? (argumentos.p_location_ids as unknown[]).map(String)
          : [];
        return sinError(
          [...new Set(sedes)].map((sede) => {
            const zona = String(
              filas('locations').find((fila) => fila.id === sede)?.timezone ?? 'America/Lima',
            );
            const primero = filas('time_events')
              .filter((fila) => fila.location_id === sede && fila.source === 'kiosk')
              .map((fila) => String(fila.occurred_at))
              .sort()[0];
            return {
              location_id: sede,
              clock_since:
                primero === undefined
                  ? null
                  : new Intl.DateTimeFormat('en-CA', {
                      timeZone: zona,
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    }).format(new Date(primero)),
            };
          }),
        );
      }
      case 'view_corrections_summary': {
        const sede = argumentos.p_location_id;
        const desde = String(argumentos.p_from ?? '');
        const hasta = String(argumentos.p_to ?? '');
        const zona = String(
          filas('locations').find((fila) => fila.id === sede)?.timezone ?? 'America/Lima',
        );
        const diaDe = (instante: string) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(instante));
        const sesiones = new Map(filas('work_sessions').map((fila) => [fila.id, fila]));
        const resultado = [];
        for (const fila of filas('time_adjustments')) {
          const despues = (fila.after_value ?? {}) as Record<string, unknown>;
          const antes = (fila.before_value ?? {}) as Record<string, unknown>;
          const sesion = sesiones.get(fila.work_session_id);
          const instante = [
            despues.occurred_at,
            despues.starts_at,
            antes.occurred_at,
            antes.starts_at,
            sesion?.starts_at,
            fila.created_at,
          ].find((valor) => typeof valor === 'string');
          if (typeof instante !== 'string') continue;
          const dia = diaDe(instante);
          if (dia < desde || dia > hasta) continue;
          if ((fila.location_id ?? sesion?.location_id) !== sede) continue;
          const tipo =
            typeof fila.request_id === 'string'
              ? 'solicitud_aprobada'
              : despues.origen === 'horario'
                ? 'segun_horario'
                : despues.origen === 'especial'
                  ? 'cumplido_especial'
                  : typeof despues.reclassified_as === 'string'
                    ? 'salida_a_pausa'
                    : fila.target_type === 'time_event'
                      ? 'fichaje_anadido'
                      : 'hora_corregida';
          resultado.push({
            tipo,
            employee_id: fila.employee_id ?? sesion?.employee_id ?? null,
            work_date: dia,
            author_name: fila.author_name ?? null,
          });
        }
        return sinError({ filas: resultado });
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
        /*
         * Como `exportTimesheetRows` (2-oct): las jornadas de los días de la SEDE pedidos,
         * abiertas incluidas, con la misma forma. Antes aquí salía el día en UTC y sin las
         * abiertas, y el servidor mandaba otra forma: la demostración funcionaba y
         * producción no.
         */
        const ubicacion = argumentos.p_location_id;
        const desde = String(argumentos.p_from ?? '');
        const hasta = String(argumentos.p_to ?? '\uffff');
        const zona = String(
          filas('locations').find((fila) => fila.id === ubicacion)?.timezone ?? 'America/Lima',
        );
        const diaDe = (instante: string) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(instante));
        const nombres = new Map(
          filas('employees').map((fila) => [fila.id, String(fila.full_name ?? '')]),
        );
        const salida = filas('work_sessions')
          .filter((fila) => {
            if (fila.location_id !== ubicacion) return false;
            const dia = diaDe(String(fila.starts_at));
            return dia >= desde && dia <= hasta;
          })
          .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
          .map((fila) => {
            const netos = Number(fila.net_minutes ?? 0);
            return {
              employee_id: fila.employee_id,
              employee_name: nombres.get(fila.employee_id) ?? 'Empleado',
              work_date: diaDe(String(fila.starts_at)),
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

/**
 * Cuándo entró, si entró en esta demostración. Hace falta para que el reloj diga «desde
 * ayer» cuando de verdad es desde ayer: con una hora siempre relativa a ahora, una jornada
 * olvidada no se podía enseñar nunca.
 */
function entradaDemo(almacen: Almacen): string | null {
  const desde = (almacen.get('demo_estado_kiosco') ?? [])[0]?.desde;
  return typeof desde === 'string' ? desde : null;
}

/**
 * Los turnos de la demostración a horas FIJAS del día de la tienda: hoy un turno partido
 * (10–14 y 17–21) y mañana uno entero (10–21). A horas fijas y no relativas a ahora porque
 * lo que se prueba es justo el día: que el reloj diga «hoy» y «mañana», que al entrar solo
 * ofrezca los de hoy, y que con la jornada abierta no pida elegir nada.
 */
function turnosDelDiaDemo(ahora: Date) {
  const hoy = dateKeyOf(ahora, TZ);
  const manana = addDaysToKey(hoy, 1);
  const turno = (id: string, dia: string, desde: string, hasta: string) => ({
    id,
    startsAt: localDateTimeToInstant(dia, desde, TZ) ?? ahora.toISOString(),
    endsAt: localDateTimeToInstant(dia, hasta, TZ) ?? ahora.toISOString(),
    jobRoleName: 'Cajero',
    employeeNote: null,
    plannedUnpaidBreakMinutes: 0,
    changedSinceLastPublication: false,
  });
  return [
    turno('demo-turno-hoy-manana', hoy, '10:00', '14:00'),
    turno('demo-turno-hoy-tarde', hoy, '17:00', '21:00'),
    turno('demo-turno-de-manana', manana, '10:00', '21:00'),
  ];
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
  almacen.set('demo_estado_kiosco', [
    {
      estado: estadoTrasEventoDemo(tipo),
      // La hora de la entrada se guarda y sobrevive a las pausas; la salida la borra.
      desde:
        tipo === 'clock_in'
          ? new Date().toISOString()
          : tipo === 'clock_out'
            ? null
            : entradaDemo(almacen),
    },
  ]);
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
    invoke: async (nombre: string, opciones?: { body?: unknown }) => {
      switch (nombre) {
        /*
         * ELIMINAR A UN EMPLEADO DE PRUEBA, de verdad: quita sus filas de cada tabla, igual
         * que el servidor. Con un `{ ok: true }` que no borrara nada, la pantalla diría
         * «eliminada» y la persona seguiría en la lista: dos cosas contradiciéndose.
         */
        /*
         * DAR DE BAJA CON SU ÚLTIMO DÍA (4-oct), con las mismas reglas que
         * `functions/src/baja-de-empleado.ts`: lo de antes no se toca, sus turnos de después
         * se cancelan —no se borran— y sus días libres de después se quitan.
         */
        case 'dischargeEmployee': {
          const cuerpo = (opciones?.body ?? {}) as {
            employeeId?: string;
            lastDay?: string;
            dryRun?: boolean;
          };
          const id = cuerpo.employeeId ?? '';
          const empleado = (almacen.get('employees') ?? []).find((f) => f.id === id);
          if (empleado === undefined) return conError('Ese empleado no existe.');
          const hoy = dateKeyOf(new Date(), TZ);
          const ultimaJornada = (almacen.get('work_sessions') ?? [])
            .filter((f) => f.employee_id === id)
            .map((f) => String(f.starts_at))
            .sort()
            .at(-1);
          const ultimoDiaMarcado =
            ultimaJornada === undefined ? null : dateKeyOf(ultimaJornada, TZ);
          const ultimoDia = cuerpo.lastDay;
          const valido = typeof ultimoDia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ultimoDia);
          if (!valido && cuerpo.dryRun !== true) return conError('Falta el último día de trabajo.');
          if (valido && ultimoDia > hoy) return conError('El último día no puede ser futuro.');
          const despues = (dia: string) => valido && dia > ultimoDia;
          const turnos = (almacen.get('shifts') ?? []).filter(
            (f) =>
              f.employee_id === id &&
              (f.status === 'draft' || f.status === 'published') &&
              despues(dateKeyOf(String(f.starts_at), TZ)),
          );
          const descansos = (almacen.get('rest_days') ?? []).filter(
            (f) => f.employee_id === id && despues(String(f.date_key)),
          );
          const resumen = {
            nombre: String(empleado.full_name ?? ''),
            hoy,
            ultimoDiaMarcado,
            turnos: turnos.length,
            descansos: descansos.length,
          };
          if (cuerpo.dryRun === true) return sinError(resumen);
          empleado.status = 'inactive';
          empleado.end_date = ultimoDia;
          for (const turno of turnos) turno.status = 'cancelled';
          almacen.set(
            'rest_days',
            (almacen.get('rest_days') ?? []).filter((f) => !descansos.includes(f)),
          );
          return sinError(resumen);
        }
        case 'deleteEmployee': {
          const cuerpo = (opciones?.body ?? {}) as { employeeId?: string; dryRun?: boolean };
          const id = cuerpo.employeeId ?? '';
          const suyas = (tabla: string) =>
            (almacen.get(tabla) ?? []).filter((f) => f.employee_id === id);
          const empleado = (almacen.get('employees') ?? []).find((f) => f.id === id);
          const nombreCompleto = String(empleado?.full_name ?? '');
          const recuento = {
            fichajes: suyas('time_events').length,
            jornadas: suyas('work_sessions').length,
            turnos: suyas('shifts').length,
            descansosLibres: suyas('rest_days').length,
            solicitudes: suyas('time_edit_requests').length,
            correcciones: 0,
            otros:
              suyas('employee_location_assignments').length + suyas('employee_job_roles').length,
          };
          if (cuerpo.dryRun === true) return sinError({ nombre: nombreCompleto, recuento });
          for (const tabla of [
            'time_events',
            'work_sessions',
            'shifts',
            'rest_days',
            'time_edit_requests',
            'employee_location_assignments',
            'employee_job_roles',
            'daily_time_summary',
            'employees_working_now',
          ]) {
            almacen.set(
              tabla,
              (almacen.get(tabla) ?? []).filter((f) => f.employee_id !== id),
            );
          }
          almacen.set(
            'employees',
            (almacen.get('employees') ?? []).filter((f) => f.id !== id),
          );
          return sinError({ nombre: nombreCompleto, recuento });
        }
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
          const ahora = Date.now();
          /*
           * LA JORNADA ABIERTA: desde la entrada que se marcó en la demostración, con un
           * turno de ocho horas que empieza con ella. Sin entrada guardada —un estado de
           * antes de este cambio— Ana lleva tres horas de un turno que acaba en cinco.
           */
          const desde = entradaDemo(almacen);
          const inicio = desde ?? new Date(ahora - 3 * 3600_000).toISOString();
          const turnoAbierto = {
            id: 'demo-turno-abierto',
            startsAt: inicio,
            endsAt:
              desde === null
                ? new Date(ahora + 5 * 3600_000).toISOString()
                : new Date(Date.parse(desde) + 8 * 3600_000).toISOString(),
            jobRoleName: 'Cajero',
            employeeNote: null,
            plannedUnpaidBreakMinutes: 60,
            changedSinceLastPublication: false,
          };
          const deManana = turnosDelDiaDemo(new Date(ahora)).slice(-1);
          return sinError({
            actionToken: 'demo-action-token-suficientemente-largo',
            // Cinco minutos, como el servidor de verdad. Ver `ACTION_TOKEN_TTL_SECONDS`.
            expiresAt: new Date(ahora + 300_000).toISOString(),
            expiresInSeconds: 300,
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
             * Y EL DE MAÑANA DETRÁS, como manda el servidor de verdad (4-oct): es lo que
             * tenía el reloj de la tienda cuando una vendedora no pudo salir, y el reloj
             * no debe pedir elegir entre los dos. Fuera de turno, los de hoy y mañana.
             */
            eligibleShifts:
              estado === 'OFF_SHIFT'
                ? turnosDelDiaDemo(new Date(ahora))
                : [turnoAbierto, ...deManana],
            openSession:
              estado === 'OFF_SHIFT'
                ? null
                : {
                    startedAt: inicio,
                    shiftId: turnoAbierto.id,
                    shiftStartsAt: turnoAbierto.startsAt,
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
                    shiftEndsAt: turnoAbierto.endsAt,
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
          const cuerpo = (opciones?.body ?? {}) as Record<string, unknown>;
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
          const cuerpo = (opciones?.body ?? {}) as Record<string, unknown>;
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
          const cuerpo = (opciones?.body ?? {}) as Record<string, unknown>;
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
                // Un gerente gestiona las sedes que se le eligen (4-oct).
                managedLocationIds: [DEMO_LOCATION_1],
              },
              {
                // La vendedora de la demo YA entró a su celular: es la cuenta de
                // `sign-in-demo-vendedor`, ligada a la ficha 1 (ver `seed.ts`).
                userId: DEMO_VENDEDOR_USER_ID,
                email: DEMO_VENDEDOR_EMAIL,
                displayName: 'Vendedora (demostración)',
                role: 'employee',
                status: 'active',
                isSelf: false,
                employeeId: DEMO_EMPLEADOS_DENTRO[0],
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
        case 'setMemberLocations':
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
  const marca = marcaDeLaUrl();
  const nombresLargos = nombresLargosDeLaUrl();
  const sembrar = () => {
    let almacen = aplicarEscenario(crearAlmacen(), escenario);
    if (nombresLargos) almacen = aplicarNombresLargos(almacen);
    if (marca !== null) {
      // Se pinta sobre TODAS las empresas sembradas: la demostración crea una segunda al
      // probar el alta, y una marca que solo alcanza a la primera no probaría el cambio.
      for (const fila of almacen.get('organizations') ?? []) fila.brand_color = marca;
    }
    return almacen;
  };

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
