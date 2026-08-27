import * as Crypto from 'expo-crypto';
import { z } from 'zod';

import { generatePin } from './pin';
import { execute, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';

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
  id: z.string().uuid(),
  full_name: z.string(),
  preferred_name: z.string().nullable(),
  email: z.string().nullable(),
  employee_number: z.string().nullable(),
  status: z.enum(employeeStatusValues),
  hire_date: z.string().nullable(),
  user_id: z.string().uuid().nullable(),
});

export type Employee = z.infer<typeof employeeSchema>;

const assignmentSchema = z.object({
  employee_id: z.string().uuid(),
  location_id: z.string().uuid(),
  can_manage: z.boolean(),
  is_primary: z.boolean(),
});

export type LocationAssignment = z.infer<typeof assignmentSchema>;

const employeeJobRoleSchema = z.object({
  employee_id: z.string().uuid(),
  job_role_id: z.string().uuid(),
  is_primary: z.boolean(),
});

export type EmployeeJobRole = z.infer<typeof employeeJobRoleSchema>;

const jobRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  is_active: z.boolean(),
});

export type JobRole = z.infer<typeof jobRoleSchema>;

export async function fetchEmployees(organizationId: string): Promise<Employee[]> {
  return selectRows(z.array(employeeSchema), (db) =>
    db
      .from('employees')
      .select('id, full_name, preferred_name, email, employee_number, status, hire_date, user_id')
      .eq('organization_id', organizationId)
      .order('full_name', { ascending: true }),
  );
}

/**
 * Asignaciones de ubicación. La tabla no lleva `organization_id`, así que se
 * filtra por las ubicaciones visibles y RLS hace el resto.
 */
export async function fetchLocationAssignments(
  locationIds: string[],
): Promise<LocationAssignment[]> {
  if (locationIds.length === 0) return [];
  return selectRows(z.array(assignmentSchema), (db) =>
    db
      .from('employee_location_assignments')
      .select('employee_id, location_id, can_manage, is_primary')
      .in('location_id', locationIds),
  );
}

export async function fetchEmployeeJobRoles(employeeIds: string[]): Promise<EmployeeJobRole[]> {
  if (employeeIds.length === 0) return [];
  return selectRows(z.array(employeeJobRoleSchema), (db) =>
    db
      .from('employee_job_roles')
      .select('employee_id, job_role_id, is_primary')
      .in('employee_id', employeeIds),
  );
}

export async function fetchJobRoles(organizationId: string): Promise<JobRole[]> {
  return selectRows(z.array(jobRoleSchema), (db) =>
    db
      .from('job_roles')
      .select('id, name, color, is_active')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
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

const insertedIdSchema = z.object({ id: z.string().uuid() });

async function replaceAssignments(params: {
  employeeId: string;
  locationIds: string[];
}): Promise<void> {
  await execute((db) =>
    db.from('employee_location_assignments').delete().eq('employee_id', params.employeeId),
  );
  if (params.locationIds.length === 0) return;

  await execute((db) =>
    db.from('employee_location_assignments').insert(
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
    db.from('employee_job_roles').delete().eq('employee_id', params.employeeId),
  );
  if (params.jobRoleIds.length === 0) return;

  await execute((db) =>
    db.from('employee_job_roles').insert(
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
      .from('employees')
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
      .from('employees')
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
    db.from('employees').update({ status: params.status }).eq('id', params.employeeId),
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
    const { error } = await db.rpc('set_employee_pin', {
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
  id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  location_id: z.string().uuid(),
  job_role_id: z.string().uuid().nullable(),
  status: z.enum(['draft', 'published', 'cancelled']),
});

export type UpcomingShift = z.infer<typeof upcomingShiftSchema>;

export async function fetchUpcomingShifts(params: {
  employeeId: string;
  fromISO: string;
  limit?: number;
}): Promise<UpcomingShift[]> {
  return selectRows(z.array(upcomingShiftSchema), (db) =>
    db
      .from('shifts')
      .select('id, starts_at, ends_at, location_id, job_role_id, status')
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
