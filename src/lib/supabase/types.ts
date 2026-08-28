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

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** Forma genérica de una tabla: fila, inserción y actualización. */
export type GenericTable = {
  Row: Record<string, Json>;
  Insert: Record<string, Json>;
  Update: Record<string, Json>;
  Relationships: [];
};

export type GenericView = {
  Row: Record<string, Json>;
  Relationships: [];
};

export type GenericFunction = {
  Args: Record<string, Json>;
  Returns: Json;
};

export type Database = {
  public: {
    Tables: Record<string, GenericTable>;
    Views: Record<string, GenericView>;
    Functions: Record<string, GenericFunction>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, Record<string, Json>>;
  };
};

/**
 * Los nombres de tabla que la app usa. No los impone el tipo —el esquema es
 * permisivo— pero tenerlos en un solo lugar evita que un typo en un `from('...')`
 * pase inadvertido hasta producción.
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
  timeEvents: 'time_events',
  workSessions: 'work_sessions',
  breakIntervals: 'break_intervals',
  timeAdjustments: 'time_adjustments',
  timesheetPeriods: 'timesheet_periods',
  timeEditRequests: 'time_edit_requests',
  announcements: 'announcements',
  auditLogs: 'audit_logs',
  pushTokens: 'push_tokens',
  notificationPreferences: 'notification_preferences',
} as const;

/** Vistas de consulta que expone la base (§14). */
export const VIEWS = {
  employeesWorkingNow: 'employees_working_now',
  dailyTimeSummary: 'daily_time_summary',
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
  attendanceStateAt: 'attendance_state_at',
  approveTimesheetPeriod: 'approve_timesheet_period',
  exportTimesheetRows: 'export_timesheet_rows',
  rebuildWorkSession: 'rebuild_work_session',
  currentAttendanceState: 'current_attendance_state',
} as const;
