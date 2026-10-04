import type { DocumentData } from 'firebase/firestore';

/**
 * Identidad de cada documento.
 *
 * Las tablas que en Postgres tenian clave primaria compuesta la conservan aqui como
 * id determinista. No es cosmetico: es lo que permite que las reglas de seguridad
 * hagan UN `get()` en vez de una consulta —una regla no puede consultar— y lo que
 * hace que `upsert` sea realmente idempotente sin leer antes.
 *
 * VIVE APARTE (auditoría, 4-oct) para que la demostración use la MISMA regla
 * (`src/lib/demo/postgrest.ts`): allí cada alta tenía un id nuevo, así que pegar dos veces
 * duplicaba los descansos y «Quitar descanso» quitaba uno y dejaba el otro, y los arneses
 * no veían lo que en producción no pasa.
 */
export const COMPOSITE_IDS: Record<string, readonly string[]> = {
  organization_memberships: ['organization_id', 'user_id'],
  employee_location_assignments: ['employee_id', 'location_id'],
  employee_job_roles: ['employee_id', 'job_role_id'],
  notification_preferences: ['user_id', 'organization_id'],
  employee_pin_credentials: ['employee_id'],
  push_tokens: ['expo_token'],
  /*
   * UN DIA LIBRE ES UN HECHO POR PERSONA Y POR DIA, asi que su identificador lo dice y no
   * puede haber dos. Sin esto, pegar la misma tabla dos veces —que es lo que hace
   * cualquiera cuando duda de si se guardo— dejaria el descanso duplicado, y quitarlo
   * desde la rejilla borraria uno y dejaria el otro puesto: el descanso «no se quita».
   */
  rest_days: ['location_id', 'employee_id', 'date_key'],
  /*
   * UNA NOTA PRIVADA POR TURNO, con el id del turno: así la regla de seguridad puede mirar
   * el turno con un `get()` y guardar dos veces escribe encima en vez de duplicar.
   */
  shift_private_notes: ['shift_id'],
};

export function documentId(table: string, row: DocumentData): string | null {
  const parts = COMPOSITE_IDS[table];
  if (parts === undefined) {
    return typeof row.id === 'string' ? row.id : null;
  }
  const values = parts.map((part) => row[part]);
  if (values.some((value) => typeof value !== 'string' || value === '')) return null;
  return values.join('_');
}
