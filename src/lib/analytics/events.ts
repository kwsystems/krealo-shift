/**
 * Eventos de producto (§31).
 *
 * §31 nombra NUEVE eventos y exige no capturar datos sensibles. No había ninguno
 * instrumentado: la sección entera estaba sin hacer, y en silencio, porque nada falla
 * cuando un evento no se envía.
 *
 * DÓNDE VA CADA COSA, Y POR QUÉ ASÍ
 *
 * La lista de eventos y sus propiedades viven aquí, en un tipo cerrado. El SITIO al que
 * se envían —Amplitude, PostHog, lo que Andree elija— no vive aquí y todavía no existe:
 * elegir el servicio y dar sus credenciales es suyo, y no se puede inventar. Lo que sí
 * es mío es la parte que se podría, y esa es la que se pudre si se deja: SABER CUÁNDO se
 * envía cada evento. Un `time_action_completed` puesto en el sitio equivocado se
 * descubre meses después, cuando los números no cuadran y ya nadie recuerda qué se
 * quiso medir.
 *
 * Así que los nueve están instrumentados, con su contrato y su prueba, y el destino es
 * un `sink` reemplazable. Hoy el de desarrollo escribe en consola —útil de inmediato
 * para seguir la cola offline— y el de producción no hace nada. Conectar un servicio es
 * cambiar `setAnalyticsSink`, no buscar nueve sitios.
 *
 * LO QUE NUNCA PUEDE LLEVAR
 * §31: "No enviar nombre, PIN, foto ni notas en analítica". Las propiedades de cada
 * evento son un tipo cerrado de números, booleanos y enumerados —ni un solo campo de
 * texto libre— y hay una prueba que lo comprueba leyendo este archivo. Un identificador
 * opaco de dispositivo no identifica a una persona; un nombre sí, y por eso no hay
 * ningún campo donde pudiera entrar.
 */

export type AnalyticsEvent =
  | { name: 'login_succeeded'; role: 'owner' | 'admin' | 'manager' | 'employee' }
  | { name: 'kiosk_activated' }
  /** Se pulsó la acción; todavía no se sabe si llega al servidor. */
  | { name: 'time_action_started'; action: TimeActionName; offline: boolean }
  | {
      name: 'time_action_completed';
      action: TimeActionName;
      offline: boolean;
      /** El servidor ya tenía el evento (misma clave de idempotencia). */
      duplicate: boolean;
      withPhoto: boolean;
    }
  | { name: 'time_action_queued_offline'; action: TimeActionName; queueSize: number }
  | { name: 'sync_completed'; accepted: number; pending: number; needsReview: number }
  | { name: 'sync_failed'; reason: SyncFailureReason }
  | { name: 'schedule_published'; shiftCount: number; weekOffset: number }
  | { name: 'timesheet_exported'; rowCount: number; dayCount: number };

export type TimeActionName = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

/**
 * Por qué falló la sincronización, en categorías y NO con el mensaje del servidor.
 *
 * Un mensaje de error es texto libre, y texto libre es por donde se escapa un dato
 * personal sin que nadie lo decida: basta con que un día una restricción de la base
 * incluya el nombre de un empleado en su mensaje.
 */
export type SyncFailureReason = 'offline' | 'rejected' | 'device_credential' | 'unknown';

export type AnalyticsEventName = AnalyticsEvent['name'];

/** Los nueve de §31, en el mismo orden. Sirve de contrato para la prueba. */
export const SPEC_EVENTS: readonly AnalyticsEventName[] = [
  'login_succeeded',
  'kiosk_activated',
  'time_action_started',
  'time_action_completed',
  'time_action_queued_offline',
  'sync_completed',
  'sync_failed',
  'schedule_published',
  'timesheet_exported',
] as const;
