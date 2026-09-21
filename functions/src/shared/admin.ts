import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

/**
 * Raiz del servidor. Todo lo que antes era una funcion `security definer` de
 * Postgres pasa por aqui.
 *
 * EL ADMIN SDK SE SALTA LAS REGLAS DE FIRESTORE, y eso no es un atajo: es
 * exactamente el equivalente de `security definer`. Una funcion asi se ejecutaba con
 * permisos que quien la llamaba no tenia, y por eso podia escribir en `time_events`
 * cuando ninguna sesion podia. El precio es el mismo que alli: CADA funcion tiene que
 * comprobar por dentro quien llama y que puede hacer, porque la pared de las reglas
 * no existe en este lado.
 */

initializeApp();

/**
 * LA REGION TIENE QUE COINCIDIR CON LA DE FIRESTORE. La base vive en
 * southamerica-east1; una funcion en us-central1 pagaria un viaje de ida y vuelta a
 * traves del continente por cada lectura, y el cliente la llamaria a la region
 * equivocada dando un `functions/not-found` que parece que la funcion no existe.
 */
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

export const db: Firestore = getFirestore();
export const auth = getAuth();

/** Marca de tiempo del servidor, en ISO. */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Las fechas se guardan como texto ISO 8601 EN UTC, no como Timestamp.
 *
 * Dos motivos, y el segundo es el que decide. Primero: los esquemas Zod de la app
 * esperan `z.string()` desde que hablaba con PostgREST, y cambiarlos habria tocado
 * los catorce `api.ts`. Segundo, y mas importante: ISO 8601 en UTC ordena igual como
 * texto que como instante, asi que los rangos y los `order by` de Firestore funcionan
 * sobre el texto sin conversion. Un formato local, o sin la Z, romperia justo eso.
 */
export function toISO(value: Date | string): string {
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

export const COLLECTIONS = {
  organizations: 'organizations',
  memberships: 'organization_memberships',
  invitations: 'organization_invitations',
  profiles: 'profiles',
  locations: 'locations',
  employees: 'employees',
  employeeLocations: 'employee_location_assignments',
  jobRoles: 'job_roles',
  employeeJobRoles: 'employee_job_roles',
  pinCredentials: 'employee_pin_credentials',
  kioskDevices: 'kiosk_devices',
  kioskDeviceSecrets: 'kiosk_device_secrets',
  kioskActivationCodes: 'kiosk_activation_codes',
  kioskRejectedAttempts: 'kiosk_rejected_attempts',
  shifts: 'shifts',
  shiftPublications: 'shift_publications',
  timeEvents: 'time_events',
  workSessions: 'work_sessions',
  breakIntervals: 'break_intervals',
  timeAdjustments: 'time_adjustments',
  timesheetPeriods: 'timesheet_periods',
  timeEditRequests: 'time_edit_requests',
  announcements: 'announcements',
  pushTokens: 'push_tokens',
  notificationPreferences: 'notification_preferences',
  managerAlertDeliveries: 'manager_alert_deliveries',
  auditLogs: 'audit_logs',
} as const;
