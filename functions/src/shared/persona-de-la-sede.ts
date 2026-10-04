import { HttpsError } from 'firebase-functions/v2/https';

import { COLLECTIONS, db } from './admin';

/**
 * QUE LA PERSONA SEA DE ESA EMPRESA Y TRABAJE EN ESA SEDE (4-oct).
 *
 * Quien gestiona la sede A podía registrar fichajes de alguien de la sede B —o de otra
 * empresa— pasando su id: se comprobaba que gestionara la sede, nunca que la persona fuera
 * de ella. El reloj de B la veía entonces dentro, con una jornada armada en A. Es la misma
 * clase de fallo que ya se cerró al poner un PIN (`setEmployeePin`).
 *
 * No se exige que esté activa: corregir un día pasado de alguien que ya se fue es justo
 * lo que hay que poder hacer.
 */
export async function exigirQueSeaDeLaSede(
  employeeId: string,
  organizationId: string,
  locationId: string,
): Promise<void> {
  const empleado = (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).data();
  if (empleado === undefined || empleado.organization_id !== organizationId) {
    throw new HttpsError('not-found', 'Esa persona no es de esta empresa.');
  }
  const asignacion = await db
    .collection(COLLECTIONS.employeeLocations)
    .where('organization_id', '==', organizationId)
    .where('employee_id', '==', employeeId)
    .where('location_id', '==', locationId)
    .limit(1)
    .get();
  if (asignacion.empty) {
    throw new HttpsError('permission-denied', 'Esa persona no trabaja en esta sede.', {
      motivo: 'OTRA_SEDE',
    });
  }
}
