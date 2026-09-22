import * as Crypto from 'expo-crypto';
import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import { generatePin } from './pin';
import { execute, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { RPC, TABLES } from '@/lib/firebase/tables';

/**
 * Datos del equipo (§11.2).
 *
 * Dos reglas de la especificación que este archivo hace cumplir:
 *   - un empleado se puede crear SIN cuenta y SIN correo: `email` y `user_id`
 *     quedan nulos y el empleado ficha con su PIN en el iPad;
 *   - desactivar no borra: se cambia `status`, nunca se elimina la fila, para no
 *     perder el historial de fichajes.
 *
 * El PIN existente no se lee nunca. La base solo guarda su hash y `set_employee_pin`
 * es la única puerta: el gerente ve el PIN temporal una sola vez, al generarlo.
 */

export const employeeStatusValues = ['invited', 'active', 'inactive'] as const;
export type EmployeeStatus = (typeof employeeStatusValues)[number];

const employeeSchema = z.object({
  id: docId(),
  full_name: z.string(),
  preferred_name: z.string().nullable(),
  email: z.string().nullable(),
  employee_number: z.string().nullable(),
  status: z.enum(employeeStatusValues),
  hire_date: z.string().nullable(),
  user_id: docId().nullable(),
});

export type Employee = z.infer<typeof employeeSchema>;

const assignmentSchema = z.object({
  employee_id: docId(),
  location_id: docId(),
  can_manage: z.boolean(),
  is_primary: z.boolean(),
});

export type LocationAssignment = z.infer<typeof assignmentSchema>;

const employeeJobRoleSchema = z.object({
  employee_id: docId(),
  job_role_id: docId(),
  is_primary: z.boolean(),
});

export type EmployeeJobRole = z.infer<typeof employeeJobRoleSchema>;

const jobRoleSchema = z.object({
  id: docId(),
  name: z.string(),
  color: z.string(),
  is_active: z.boolean(),
});

export type JobRole = z.infer<typeof jobRoleSchema>;

export async function fetchEmployees(organizationId: string): Promise<Employee[]> {
  return selectRows(z.array(employeeSchema), (db) =>
    db
      .from(TABLES.employees)
      .select('id, full_name, preferred_name, email, employee_number, status, hire_date, user_id')
      .eq('organization_id', organizationId)
      .order('full_name', { ascending: true }),
  );
}

/**
 * Asignaciones de ubicación. La tabla no lleva `organization_id`, así que se
 * filtra por las ubicaciones visibles y RLS hace el resto.
 */
export async function fetchLocationAssignments(params: {
  organizationId: string;
  locationIds: string[];
}): Promise<LocationAssignment[]> {
  if (params.locationIds.length === 0) return [];
  return selectRows(z.array(assignmentSchema), (db) =>
    db
      .from(TABLES.employeeLocationAssignments)
      .select('employee_id, location_id, can_manage, is_primary')
      .eq('organization_id', params.organizationId)
      .in('location_id', params.locationIds),
  );
}

export async function fetchEmployeeJobRoles(params: {
  organizationId: string;
  employeeIds: string[];
}): Promise<EmployeeJobRole[]> {
  if (params.employeeIds.length === 0) return [];
  return selectRows(z.array(employeeJobRoleSchema), (db) =>
    db
      .from(TABLES.employeeJobRoles)
      .select('employee_id, job_role_id, is_primary')
      .eq('organization_id', params.organizationId)
      .in('employee_id', params.employeeIds),
  );
}

export async function fetchJobRoles(organizationId: string): Promise<JobRole[]> {
  return selectRows(z.array(jobRoleSchema), (db) =>
    db
      .from(TABLES.jobRoles)
      .select('id, name, color, is_active')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
  );
}

/**
 * Los colores que se le pueden dar a un puesto.
 *
 * NO HAY SELECTOR DE COLOR, y es deliberado: `color` se guarda, se lee y se valida con
 * Zod, pero NINGUNA pantalla lo pinta —comprobado buscando consumidores en todo el
 * proyecto, no hay ninguno—. Un selector para un campo que no se ve sería trabajo para
 * nadie y una decisión más que pedirle a quien solo quiere añadir «Cajero».
 *
 * Se asigna rotando esta lista, que es la misma de `configurar-empresa.mjs`, para que
 * el día que el horario sí pinte el puesto los colores ya estén repartidos y validados
 * en vez de ser todos iguales.
 */
const COLORES_DE_PUESTO = ['#7157E8', '#2FA36B', '#B56B00', '#2A6FA8', '#C43D4D'] as const;

/**
 * Abrir un puesto nuevo.
 *
 * NO SE PODIA DESDE LA APP, aunque la regla lo permite desde el primer dia
 * (`allow create: if isAdmin(...)`). Los puestos se ASIGNAN al empleado —eso si estaba—
 * pero tenian que existir antes, y solo los plantaba `configurar-empresa.mjs` desde una
 * terminal con credenciales del proyecto de Google. En una empresa nueva el selector de
 * «Puestos» salia vacio y no habia forma de añadir el primero.
 */
export async function createJobRole(params: {
  organizationId: string;
  name: string;
  /** Cuántos hay ya, solo para repartir colores distintos. */
  existentes: number;
}): Promise<string> {
  const creado = await selectRows(z.object({ id: docId() }), (db) =>
    db
      .from(TABLES.jobRoles)
      .insert({
        organization_id: params.organizationId,
        name: params.name.trim(),
        color: COLORES_DE_PUESTO[params.existentes % COLORES_DE_PUESTO.length],
        is_active: true,
      })
      .select('id')
      .single(),
  );
  return creado.id;
}

export async function renameJobRole(params: { jobRoleId: string; name: string }): Promise<void> {
  await execute((db) =>
    db.from(TABLES.jobRoles).update({ name: params.name.trim() }).eq('id', params.jobRoleId),
  );
}

/**
 * Cerrar o reabrir un puesto. NO hay borrado, aunque la regla lo permitiria.
 *
 * Un puesto lo referencian las asignaciones de cada empleado y los turnos publicados.
 * Borrar la fila dejaria a gente con un puesto que no existe y turnos apuntando al
 * vacio, y el historial de quien cubrio que se volveria ilegible. Es el mismo
 * razonamiento que con las sedes y con los empleados, que tampoco se borran.
 */
export async function setJobRoleActive(params: {
  jobRoleId: string;
  isActive: boolean;
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.jobRoles).update({ is_active: params.isActive }).eq('id', params.jobRoleId),
  );
}

export type EmployeeDraft = {
  fullName: string;
  preferredName: string | null;
  employeeNumber: string | null;
  /** Opcional a propósito: el empleado del kiosco no necesita correo (§11.2). */
  email: string | null;
  locationIds: string[];
  jobRoleIds: string[];
};

const insertedIdSchema = z.object({ id: docId() });

async function replaceAssignments(params: {
  employeeId: string;
  locationIds: string[];
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.employeeLocationAssignments).delete().eq('employee_id', params.employeeId),
  );
  if (params.locationIds.length === 0) return;

  await execute((db) =>
    db.from(TABLES.employeeLocationAssignments).insert(
      params.locationIds.map((locationId, index) => ({
        employee_id: params.employeeId,
        location_id: locationId,
        is_primary: index === 0,
      })),
    ),
  );
}

async function replaceJobRoles(params: {
  employeeId: string;
  jobRoleIds: string[];
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.employeeJobRoles).delete().eq('employee_id', params.employeeId),
  );
  if (params.jobRoleIds.length === 0) return;

  await execute((db) =>
    db.from(TABLES.employeeJobRoles).insert(
      params.jobRoleIds.map((jobRoleId, index) => ({
        employee_id: params.employeeId,
        job_role_id: jobRoleId,
        is_primary: index === 0,
      })),
    ),
  );
}

export async function createEmployee(params: {
  organizationId: string;
  draft: EmployeeDraft;
}): Promise<string> {
  const { organizationId, draft } = params;

  const inserted = await selectRows(insertedIdSchema, (db) =>
    db
      .from(TABLES.employees)
      .insert({
        organization_id: organizationId,
        full_name: draft.fullName.trim(),
        preferred_name: draft.preferredName,
        employee_number: draft.employeeNumber,
        email: draft.email,
        status: 'active',
      })
      .select('id')
      .single(),
  );

  await replaceAssignments({ employeeId: inserted.id, locationIds: draft.locationIds });
  await replaceJobRoles({ employeeId: inserted.id, jobRoleIds: draft.jobRoleIds });

  return inserted.id;
}

export async function updateEmployee(params: {
  employeeId: string;
  draft: EmployeeDraft;
}): Promise<void> {
  const { employeeId, draft } = params;

  await execute((db) =>
    db
      .from(TABLES.employees)
      .update({
        full_name: draft.fullName.trim(),
        preferred_name: draft.preferredName,
        employee_number: draft.employeeNumber,
        email: draft.email,
      })
      .eq('id', employeeId),
  );

  await replaceAssignments({ employeeId, locationIds: draft.locationIds });
  await replaceJobRoles({ employeeId, jobRoleIds: draft.jobRoleIds });
}

/** Activar o desactivar sin borrar historial (§11.2). */
export async function setEmployeeStatus(params: {
  employeeId: string;
  status: EmployeeStatus;
}): Promise<void> {
  await execute((db) =>
    db.from(TABLES.employees).update({ status: params.status }).eq('id', params.employeeId),
  );
}

/**
 * Genera un PIN nuevo y lo guarda hasheado con `set_employee_pin`.
 * Devuelve el PIN en claro solo para mostrarlo una vez; no se persiste en la app.
 */
export async function resetEmployeePin(params: {
  employeeId: string;
  pinLength: number;
}): Promise<string> {
  const pin = generatePin(params.pinLength, (length) => Crypto.getRandomBytes(length));

  const db = requireClient();
  try {
    const { error } = await db.rpc(RPC.setEmployeePin, {
      p_employee_id: params.employeeId,
      p_pin: pin,
    });
    if (error !== null) throw toAdminError(error);
  } catch (error) {
    throw toAdminError(error);
  }

  return pin;
}

const upcomingShiftSchema = z.object({
  id: docId(),
  starts_at: z.string(),
  ends_at: z.string(),
  location_id: docId(),
  job_role_id: docId().nullable(),
  status: z.enum(['draft', 'published', 'cancelled']),
});

export type UpcomingShift = z.infer<typeof upcomingShiftSchema>;

export async function fetchUpcomingShifts(params: {
  organizationId: string;
  employeeId: string;
  fromISO: string;
  limit?: number;
}): Promise<UpcomingShift[]> {
  return selectRows(z.array(upcomingShiftSchema), (db) =>
    db
      .from(TABLES.shifts)
      .select('id, starts_at, ends_at, location_id, job_role_id, status')
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId)
      .neq('status', 'cancelled')
      .gte('starts_at', params.fromISO)
      .order('starts_at', { ascending: true })
      .limit(params.limit ?? 5),
  );
}

/** Identidad del usuario en sesión: se usa para `created_by` y auditoría local. */
export function currentUserId(): string | null {
  return useSessionStore.getState().user?.userId ?? null;
}
