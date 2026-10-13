import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { audit, membershipOf, requireRole, requireUid } from './shared/caller';

/**
 * EL SUELDO DE CADA PERSONA (13-oct), para el sueldo aproximado del mes
 * (`src/domain/sueldo-estimado.ts`). Andree: «que cada uno pueda ver más o menos cuánto va a
 * ganar».
 *
 * PRIVADO. Lo escribe SOLO este servidor y solo el dueño o un administrador de la empresa:
 * un gerente de sede no ve ni cambia sueldos. Lo leen ese dueño o administrador y la propia
 * persona (reglas de `employee_pay`); un compañero, nunca.
 *
 * Uno por ficha, con el id de la ficha: guardarlo otra vez lo cambia. Sin sueldo
 * (`p_monthly_salary` nulo) se borra, y el celular deja de enseñar la cuenta.
 */

/** Ningún sueldo de tienda pasa de esto: un número así es un dedo de más. */
const SUELDO_MAXIMO = 100_000;

export const setEmployeePay = onCall(async (request) => {
  const uid = requireUid(request);
  const datos = (request.data ?? {}) as Record<string, unknown>;
  const employeeId = typeof datos.p_employee_id === 'string' ? datos.p_employee_id.trim() : '';
  if (employeeId === '') throw new HttpsError('invalid-argument', 'Falta la persona.');

  const ficha = (await db.collection(COLLECTIONS.employees).doc(employeeId).get()).data();
  if (ficha === undefined) throw new HttpsError('not-found', 'Esa persona ya no existe.');
  const organizationId = String(ficha.organization_id);
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  const ref = db.collection(COLLECTIONS.employeePay).doc(employeeId);
  const previa = (await ref.get()).data();

  const sueldo = datos.p_monthly_salary;
  if (sueldo === null || sueldo === undefined) {
    if (previa !== undefined) {
      await ref.delete();
      await audit({
        organizationId,
        actorUserId: uid,
        action: 'employee_pay_cleared',
        entityType: 'employee_pay',
        entityId: employeeId,
        before: previa,
      });
    }
    return { id: employeeId };
  }
  if (typeof sueldo !== 'number' || !Number.isFinite(sueldo) || sueldo <= 0) {
    throw new HttpsError('invalid-argument', 'El sueldo tiene que ser un monto mayor que cero.', {
      motivo: 'SUELDO',
    });
  }
  if (sueldo > SUELDO_MAXIMO) {
    throw new HttpsError('invalid-argument', 'Ese sueldo es demasiado alto: revisa el monto.', {
      motivo: 'SUELDO',
    });
  }
  const pension = datos.p_pension;
  if (pension !== null && pension !== undefined && pension !== 'onp' && pension !== 'afp') {
    throw new HttpsError('invalid-argument', 'El sistema de pensiones no se entiende.', {
      motivo: 'PENSION',
    });
  }

  const ahora = nowISO();
  const fila = {
    id: employeeId,
    organization_id: organizationId,
    employee_id: employeeId,
    monthly_salary: Math.round(sueldo * 100) / 100,
    family_allowance: datos.p_family_allowance === true,
    pension: pension ?? null,
    updated_by: uid,
    updated_at: ahora,
  };
  await ref.set(fila);
  await audit({
    organizationId,
    actorUserId: uid,
    action: previa === undefined ? 'employee_pay_set' : 'employee_pay_changed',
    entityType: 'employee_pay',
    entityId: employeeId,
    before: previa ?? null,
    after: {
      monthly_salary: fila.monthly_salary,
      family_allowance: fila.family_allowance,
      pension: fila.pension,
    },
  });
  return { id: employeeId };
});
