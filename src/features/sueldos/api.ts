import { z } from 'zod';

import type { SistemaDePension } from '@/domain/sueldo-estimado';
import { horaExtraSchema, type HoraExtraAprobada } from '@/features/timesheets/horas-extra';
import { requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { docId } from '@/lib/firebase/ids';
import { RPC, TABLES } from '@/lib/firebase/tables';

/**
 * EL SUELDO DE CADA PERSONA (13-oct): leerlo y guardarlo. Lo escribe solo el servidor
 * (`functions/src/sueldos.ts`) y solo el dueño o un administrador; lo leen ellos y la propia
 * persona. Ver `src/domain/sueldo-estimado.ts` para lo que se hace con él.
 */

export const sueldoSchema = z.object({
  id: docId(),
  organization_id: docId(),
  employee_id: docId(),
  monthly_salary: z.number().positive(),
  family_allowance: z.boolean().default(false),
  pension: z.enum(['onp', 'afp']).nullable().default(null),
  updated_at: z.string().nullable().default(null),
});
export type Sueldo = z.infer<typeof sueldoSchema>;

/** Una clave para todas las pantallas: guardar en Equipo refresca el celular y la ficha. */
export const CLAVE_DE_SUELDOS = 'sueldos';

/** El de una persona, o `null` si nadie lo ha guardado. */
export async function fetchSueldo(params: {
  organizationId: string;
  employeeId: string;
}): Promise<Sueldo | null> {
  const filas = await selectRows(z.array(sueldoSchema), (db) =>
    db
      .from(TABLES.employeePay)
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
  return filas[0] ?? null;
}

export async function guardarSueldo(params: {
  employeeId: string;
  /** `null` lo borra. */
  sueldoMensual: number | null;
  asignacionFamiliar: boolean;
  pension: SistemaDePension | null;
}): Promise<void> {
  try {
    const { error } = await requireClient().rpc(RPC.setEmployeePay, {
      p_employee_id: params.employeeId,
      p_monthly_salary: params.sueldoMensual,
      p_family_allowance: params.asignacionFamiliar,
      p_pension: params.pension,
    });
    if (error !== null) throw toAdminError(error);
  } catch (error) {
    throw toAdminError(error);
  }
}

/**
 * Las horas extra APROBADAS de una persona en un mes. Por persona y no por sede: así la
 * puede pedir ella misma desde su celular (la regla le deja leer las suyas, no las de otros).
 */
export async function fetchExtrasDeLaPersona(params: {
  organizationId: string;
  employeeId: string;
  desde: string;
  hasta: string;
}): Promise<HoraExtraAprobada[]> {
  const filas = await selectRows(z.array(horaExtraSchema), (db) =>
    db
      .from(TABLES.overtimeApprovals)
      .select('id, employee_id, location_id, work_date, minutes, approved_by, updated_at')
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
  // Por fecha aquí: son pocas, y acotarlas en la consulta pediría otro índice.
  return filas.filter((fila) => fila.work_date >= params.desde && fila.work_date <= params.hasta);
}
