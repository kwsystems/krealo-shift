import { COLLECTIONS, db } from './admin';

/**
 * El puesto de cada persona, resuelto en UN solo sitio.
 *
 * POR QUE NO VIVE DENTRO DE `refreshKioskRoster`, que es donde estaba. Lo necesitan dos
 * caminos del reloj que no se hablan: la lista que el iPad guarda para funcionar sin
 * conexión, y el contexto que se arma justo después de teclear el PIN. El segundo lo
 * devolvía como `null` fijo, así que el reloj nunca enseñaba el puesto debajo del nombre
 * ni como pista al elegir turno.
 *
 * Copiar la consulta habría dejado dos versiones de la misma regla —incluida la de qué
 * pasa cuando alguien tiene varios puestos— y esas dos versiones se separan: se arregla
 * una, se olvida la otra, y la misma persona aparece como «Caja» en un sitio y sin puesto
 * en el otro.
 */
export type MapasDePuestos = {
  /** Nombre del puesto por su id. Lo usan los turnos, que guardan `job_role_id`. */
  porPuesto: Map<string, string>;
  /** Nombre del puesto de cada persona, ya resuelto con la regla del principal. */
  porEmpleado: Map<string, string>;
};

export async function puestosPorEmpleado(organizationId: string): Promise<MapasDePuestos> {
  const puestos = new Map<string, string>();
  for (const doc of (
    await db.collection(COLLECTIONS.jobRoles).where('organization_id', '==', organizationId).get()
  ).docs) {
    puestos.set(doc.id, String(doc.data().name ?? ''));
  }

  const porEmpleado = new Map<string, string>();
  for (const doc of (
    await db
      .collection(COLLECTIONS.employeeJobRoles)
      .where('organization_id', '==', organizationId)
      .get()
  ).docs) {
    const fila = doc.data();
    const nombre = puestos.get(String(fila.job_role_id));
    if (nombre === undefined) continue;
    // El principal gana; si no hay ninguno marcado, vale el primero que aparezca.
    if (fila.is_primary === true || !porEmpleado.has(String(fila.employee_id))) {
      porEmpleado.set(String(fila.employee_id), nombre);
    }
  }

  return { porPuesto: puestos, porEmpleado };
}
