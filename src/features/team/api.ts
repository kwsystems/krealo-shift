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
  /*
   * `.default(null)` Y NO SOLO `.nullable()`, y la diferencia rompio la pantalla de
   * Equipo en produccion.
   *
   * `.nullable()` acepta `null` pero NO acepta que el campo no este: un documento sin
   * `hire_date` llega como `undefined` y Zod lo rechaza. `createEmployee` nunca escribia
   * estos dos campos, asi que TODO empleado dado de alta desde la app producia un
   * documento que la propia app no podia volver a leer: «Algo no salio bien. La
   * respuesta del servidor no es la esperada», sin nada en la consola.
   *
   * Se arregla en los dos lados a proposito. El escritor ya los escribe —abajo— pero eso
   * no arregla las filas que ya estan en la base; esto si, y ademas hace que un campo
   * añadido en el futuro no tumbe la pantalla de quien todavia no lo tiene.
   */
  hire_date: z.string().nullable().default(null),
  user_id: docId().nullable().default(null),
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

/**
 * LAS FILAS LLEVAN `organization_id`, Y NO LO LLEVABAN. Sin el, esto no funcionaba de
 * dos formas a la vez:
 *
 *   1. LA REGLA LO DENIEGA. `allow create: if isStaff(request.resource.data
 *      .organization_id)` con el campo ausente evalua `isStaff(undefined)`, que es
 *      falso. Cada alta de empleado fallaba justo en este paso.
 *   2. Y AUNQUE SE ESCRIBIERA, NADIE LA ENCONTRARIA: `fetchLocationAssignments` filtra
 *      por `organization_id`, asi que una fila sin el es invisible para la consulta que
 *      la busca. Una regla que se apoya en un campo obliga a que la consulta lo acote.
 *
 * `can_manage` tambien faltaba, y el esquema de lectura lo exige como booleano —ni
 * siquiera nullable—, asi que una fila sin el tampoco se podia leer. Va en `false`:
 * administrar una sede se concede por el ROL de la membresia, no por estar asignado a
 * trabajar en ella.
 */
async function replaceAssignments(params: {
  organizationId: string;
  employeeId: string;
  locationIds: string[];
}): Promise<void> {
  /*
   * EL BORRADO TAMBIEN ACOTA POR `organization_id`, y sin eso fallaba TODO.
   *
   * «Borrar donde employee_id = X» no existe en Firestore: el adaptador lo resuelve
   * haciendo primero una CONSULTA DE LISTA y borrando lo que encuentra. Y la regla de
   * lectura de esta coleccion se apoya en `organization_id`, asi que una consulta que
   * no lo acota se DENIEGA ENTERA —las reglas no son filtros: Firestore tiene que poder
   * demostrar con las condiciones de la propia consulta que todo lo que devuelve es
   * legible—.
   *
   * O sea que el alta de un empleado reventaba aqui, en el paso de limpiar, antes de
   * escribir una sola asignacion. Y como el error no se pintaba en ningun sitio, la
   * hoja se quedaba quieta: «le doy guardar y no pasa nada», con un empleado huerfano
   * por cada intento.
   */
  await execute((db) =>
    db
      .from(TABLES.employeeLocationAssignments)
      .delete()
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
  if (params.locationIds.length === 0) return;

  await execute((db) =>
    db.from(TABLES.employeeLocationAssignments).insert(
      params.locationIds.map((locationId, index) => ({
        organization_id: params.organizationId,
        employee_id: params.employeeId,
        location_id: locationId,
        can_manage: false,
        is_primary: index === 0,
      })),
    ),
  );
}

/** Lo mismo que las asignaciones: sin `organization_id` ni se escribe ni se encuentra. */
async function replaceJobRoles(params: {
  organizationId: string;
  employeeId: string;
  jobRoleIds: string[];
}): Promise<void> {
  // Mismo motivo que en las asignaciones de sede: la consulta que precede al borrado
  // tiene que acotar lo que la regla lee.
  await execute((db) =>
    db
      .from(TABLES.employeeJobRoles)
      .delete()
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
  if (params.jobRoleIds.length === 0) return;

  await execute((db) =>
    db.from(TABLES.employeeJobRoles).insert(
      params.jobRoleIds.map((jobRoleId, index) => ({
        organization_id: params.organizationId,
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
        // Explicitos aunque vayan en nulo: ver el comentario del esquema de arriba.
        hire_date: null,
        user_id: null,
      })
      .select('id')
      .single(),
  );

  await replaceAssignments({
    organizationId,
    employeeId: inserted.id,
    locationIds: draft.locationIds,
  });
  await replaceJobRoles({
    organizationId,
    employeeId: inserted.id,
    jobRoleIds: draft.jobRoleIds,
  });

  return inserted.id;
}

export async function updateEmployee(params: {
  organizationId: string;
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

  await replaceAssignments({
    organizationId: params.organizationId,
    employeeId,
    locationIds: draft.locationIds,
  });
  await replaceJobRoles({
    organizationId: params.organizationId,
    employeeId,
    jobRoleIds: draft.jobRoleIds,
  });
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
