/**
 * Tipos de esquema para el cliente de Supabase.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * Sin un tipo `Database`, supabase-js infiere `never` para los cuerpos de
 * `insert()` y `update()`, y cualquier escritura falla el typecheck con un mensaje
 * que no señala la causa real. Es exactamente lo que pasó al construir el panel
 * administrativo.
 *
 * LO QUE ES Y LO QUE NO ES
 * Esto es un esquema PERMISIVO a propósito, no los tipos generados. Acepta
 * cualquier tabla y cualquier columna JSON-serializable. A cambio:
 *   - las escrituras compilan y siguen validadas en el servidor por RLS, por las
 *     restricciones de la base y por Zod en el cliente;
 *   - las lecturas vuelven como `Record<string, Json>`, así que cada consulta
 *     tiene que decir explícitamente qué forma espera. Eso es honesto: el tipo no
 *     puede prometer una forma que nadie verificó.
 *
 * CÓMO REEMPLAZARLO POR LOS TIPOS REALES
 * Cuando exista el proyecto de Supabase:
 *
 *   supabase gen types typescript --project-id <ref> --schema public \
 *     > src/lib/supabase/database.types.ts
 *
 * y cambiar el import de `Database` en `client.ts` por ese archivo. Ahí las
 * lecturas quedan tipadas de verdad y este archivo se borra. No se generaron
 * ahora porque generarlos exige un proyecto en la nube, y escribirlos a mano
 * sería inventar una promesa de tipos que nada verifica.
 */

/**
 * Nombres de las colecciones de Firestore, las vistas servidas por Cloud Function y
 * las funciones invocables. Son los MISMOS nombres que tenian las tablas en Postgres,
 * y eso es deliberado: conservarlos dejo intactos los esquemas Zod, las pruebas y los
 * 62 puntos de llamada al migrar de backend.
 */
export const TABLES = {
  organizations: 'organizations',
  organizationMemberships: 'organization_memberships',
  profiles: 'profiles',
  locations: 'locations',
  employees: 'employees',
  employeeLocationAssignments: 'employee_location_assignments',
  jobRoles: 'job_roles',
  employeeJobRoles: 'employee_job_roles',
  shifts: 'shifts',
  shiftPublications: 'shift_publications',
  restDays: 'rest_days',
  /**
   * Horas extra APROBADAS por quien gestiona, una fila por persona y día (30-sep). Ver
   * `src/features/timesheets/horas-extra.ts`: extra es lo que se aprueba, no lo que pasa
   * de un umbral.
   */
  overtimeApprovals: 'overtime_approvals',
  timeEvents: 'time_events',
  workSessions: 'work_sessions',
  breakIntervals: 'break_intervals',
  timeAdjustments: 'time_adjustments',
  timesheetPeriods: 'timesheet_periods',
  timeEditRequests: 'time_edit_requests',
  /**
   * Las horas que alguien debe a la tienda (1-oct): las registra quien gestiona desde
   * «Por resolver» en Horas y la persona las ve en su celular. Solo lectura desde la app.
   */
  owedHours: 'owed_hours',
  announcements: 'announcements',
  auditLogs: 'audit_logs',
  pushTokens: 'push_tokens',
  notificationPreferences: 'notification_preferences',
  /**
   * AHORA SI SE PUEDE LEER, y por eso vuelve a `TABLES` tras estar prohibida.
   *
   * En Postgres estaba revocada porque la fila mezclaba el inventario con dos
   * secretos del dispositivo (`credential_hash` y `offline_key`). Al pasar a
   * Firestore esos dos se separaron a `kiosk_device_secrets`, cerrada a cal y canto
   * en las reglas, asi que lo que queda aqui no tiene nada que esconder.
   */
  kioskDevices: 'kiosk_devices',
} as const;

/**
 * Lo que eran VISTAS de Postgres (§14). Firestore no une ni agrega, asi que cada una
 * la sirve una Cloud Function que devuelve las mismas filas; el enrutado esta en
 * `query.ts` y los puntos de llamada no se enteraron.
 */
export const VIEWS = {
  employeesWorkingNow: 'employees_working_now',
  /**
   * Correcciones con el nombre del autor resuelto (§11.4).
   *
   * Se lee la VISTA y no `time_adjustments` porque el autor es un `uuid` que apunta a
   * `auth.users`, y el cliente no puede leer esa tabla —ni debe—. La vista lo traduce
   * con `app_actor_display_name`, que se cierra por quién pregunta y por quién se
   * pregunta; el razonamiento largo está en la migración
   * `20260827002200_autor_de_correcciones.sql`.
   *
   * `time_adjustments` SIGUE en `TABLES` porque las pruebas SQL la usan y porque leerla
   * directamente no es un fallo de seguridad, solo se queda sin el autor.
   */
  timeAdjustmentsWithAuthor: 'time_adjustments_with_author',

  dailyTimeSummary: 'daily_time_summary',
  /**
   * Minutos de pausa por empleado, día y motivo (§11.4, pedido de Andree 2026-09-15).
   *
   * Responde a «en qué se va el tiempo que no se trabaja» sin traerse los intervalos
   * crudos al cliente para sumarlos ahí: son cientos de filas por semana y la cuenta
   * la hace mejor la base. La vista es `security_invoker = true`, así que cada quien ve
   * exactamente las sedes que su RLS le deja ver, ni una más.
   */
  breakTimeByReason: 'break_time_by_reason',
  /**
   * Inventario de kioscos. Se lee la VISTA y nunca la tabla: `kiosk_devices` está
   * revocada para `authenticated` porque tiene dos secretos del dispositivo
   * (`credential_hash` y `offline_key`) que ninguna sesión de la app debe leer.
   * Con `offline_key` y el archivo SQLite de un iPad se prueban los 10⁶ PIN.
   *
   * `kiosk_devices` NO está en `TABLES` a propósito, y por eso: tenerla ahí ya
   * llevó una vez a consultarla desde el panel, la pantalla mostró "permiso
   * denegado" y el botón de revocar un iPad perdido quedó inalcanzable. `tsc` no
   * puede detectar eso, porque el nombre de una tabla es una cadena válida.
   * Las Edge Functions sí la leen: van con `service_role` y su propio cliente.
   */
  kioskDevicesAdmin: 'kiosk_devices_admin',
} as const;

/** Funciones invocables por RPC desde la app. Cada una valida el rol por dentro. */
export const RPC = {
  createKioskActivationCode: 'create_kiosk_activation_code',
  revokeKioskDevice: 'revoke_kiosk_device',
  setEmployeePin: 'set_employee_pin',
  /**
   * El logo NO se sube directo a Storage, y la razon esta en la propia funcion:
   * las reglas de Storage no pueden consultar Firestore, asi que la comprobacion de
   * «eres administrador de esta empresa» no se puede hacer alli. Ver
   * `setOrganizationLogo` en functions/src/manager.ts.
   */
  setOrganizationLogo: 'set_organization_logo',
  /** Quitarlo tambien pasa por la funcion: la regla de Storage no deja borrar al cliente. */
  clearOrganizationLogo: 'clear_organization_logo',
  managerAdjustTime: 'manager_adjust_time',
  /**
   * Fichaje manual del gerente (§11.4 "agregar fichaje manual con motivo").
   *
   * CREA un evento nuevo marcado `source = 'manager'`; no edita ninguno existente,
   * porque `time_events` es append-only. El motivo es obligatorio y queda en
   * `time_adjustments` y en `audit_logs`: un fichaje que el gerente añade sin
   * explicación es indistinguible de un fraude en una auditoría laboral.
   *
   * Valida la transición contra el estado del empleado EN EL INSTANTE del fichaje,
   * no en el actual, porque una corrección casi siempre se pone en el pasado.
   */
  managerAddTimeEvent: 'manager_add_time_event',
  /**
   * «Esa salida fue al almacén, no a casa» (§11.4, pedido de Andree 2026-09-22).
   *
   * Convierte una salida y la entrada siguiente en una PAUSA con motivo. NO edita ni
   * borra ningún fichaje: los dos siguen diciendo lo que la persona marcó y ganan un
   * `reclassified_as` que solo mira el cálculo de horas. El motivo y el autor quedan en
   * `time_adjustments`, como toda corrección.
   */
  managerReclassifyDeparture: 'manager_reclassify_departure',
  /**
   * Publicar el horario de una semana (§11.3 pasos 6-7).
   *
   * LA VERSIÓN LA SELLA EL SERVIDOR. El cliente publicaba por su cuenta y nunca escribía
   * `publication_version` en el turno, así que la etiqueta «Cambiado» —que es
   * `status === 'draft' && publication_version > 0`— no podía salir jamás. Y no se
   * arregló con un `update` más desde el panel porque el propio código decía que esa
   * versión no puede depender de lo que envíe una app: las tardanzas se miden contra el
   * turno publicado vigente.
   */
  publishShiftsForWeek: 'publish_shifts_for_week',
  /**
   * Alta de empresa (2026-09-23, la segunda empresa de Andree).
   *
   * NO EXISTIA NADA QUE CREARA UNA ORGANIZACION. Las reglas de Firestore dicen
   * `allow create, delete: if false` sobre `organizations` —«solo servidor»— y en el
   * servidor no habia ninguna funcion que lo hiciera: la empresa que hay hoy se
   * escribio a mano en la consola de Firebase. Solo la puede llamar quien ya es
   * `owner` de otra empresa activa, y crea organizacion + membresia de dueño +
   * primera sede en una sola transaccion.
   */
  createOrganization: 'create_organization',
  /**
   * Registrar como cumplido el horario publicado de los días de ANTES del reloj (30-sep):
   * escribe entrada, refrigerio y salida de cada turno, como si se hubieran fichado. El
   * servidor se niega a tocar un día desde que la sede ficha con el reloj, un turno con
   * marcas o un borrador. Ver `functions/src/horario-cumplido.ts`.
   */
  registerScheduleAsWorked: 'register_schedule_as_worked',
  /**
   * Resolver una solicitud de la Bandeja (30-sep): aprobar, rechazar o comentar. Las reglas
   * no dejan tocar una solicitud desde la app —cambia horas pagadas— y esta función no
   * existía, así que aprobar fallaba en silencio. Aprobar un «olvidé marcar» registra los
   * fichajes que faltaban. Ver `functions/src/solicitudes.ts`.
   */
  reviewTimeEditRequest: 'review_time_edit_request',
  /**
   * Las correcciones de hora de un periodo, una fila por corrección y contada en el día que
   * corrige (30-sep). Ver `functions/src/correcciones.ts`.
   */
  viewCorrectionsSummary: 'view_corrections_summary',
  /**
   * Después de cancelar un turno publicado: que las jornadas de ese turno dejen de tenerlo
   * (30-sep). Publicar ya lo hace solo; cancelar lo escribe el panel directamente.
   */
  recheckSessionsForShift: 'recheck_sessions_for_shift',
  /**
   * «Visto, está bien así» sobre una marca rara —entró una hora o más antes de su turno o
   * salió una hora o más después— (1-oct). La jornada no se escribe desde la app: sostiene
   * las horas que se pagan. Ver `acknowledgeUnusualClock` en `functions/src/manager.ts`.
   */
  acknowledgeUnusualClock: 'acknowledge_unusual_clock',
  /**
   * «Por resolver» en Horas (1-oct): «le debe N h», «está justificado», «trabajó sin
   * refrigerio». Ver `functions/src/casos.ts`.
   */
  resolveSessionCase: 'resolve_session_case',
  /** «Descontar el refrigerio del turno» de quien no lo marcó. */
  applyPlannedBreak: 'apply_planned_break',
  /** Las horas que debía, compensadas o perdonadas. */
  settleOwedHours: 'settle_owed_hours',
  attendanceStateAt: 'attendance_state_at',
  approveTimesheetPeriod: 'approve_timesheet_period',
  /** Reabrir un periodo aprobado: también sella horas, así que va por función (30-sep). */
  reopenTimesheetPeriod: 'reopen_timesheet_period',
  /**
   * Las jornadas del periodo que se está mirando, al día con el horario de ahora (30-sep).
   * Horas, Reportes e Inicio la llaman al abrirse. Ver `useJornadasAlDia`.
   */
  recheckSessionsForPeriod: 'recheck_sessions_for_period',
  exportTimesheetRows: 'export_timesheet_rows',
  rebuildWorkSession: 'rebuild_work_session',
  currentAttendanceState: 'current_attendance_state',
} as const;
