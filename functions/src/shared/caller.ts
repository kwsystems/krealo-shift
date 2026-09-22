import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './admin';

/**
 * Quien llama, y que se le permite. El equivalente de `app_is_member`,
 * `app_role_in` y `app_manages_location`.
 *
 * ESTO NO ES UN ADORNO NI UNA SEGUNDA CAPA: es la UNICA. El Admin SDK no evalua
 * `firestore.rules`, asi que una funcion que no compruebe aqui quien la llama es una
 * puerta abierta a toda la base para cualquiera con una cuenta de Google. En
 * Postgres, `security definer` tenia exactamente el mismo filo y por eso la
 * migracion `001500_authorize_rpc.sql` existia: conceder `execute` no era conceder
 * permiso.
 */

export type AppRole = 'owner' | 'admin' | 'manager' | 'employee';

export type Membership = {
  organizationId: string;
  userId: string;
  role: AppRole;
  status: 'invited' | 'active' | 'suspended';
  managedLocationIds: string[];
  employeeId: string | null;
};

export function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (uid === undefined) {
    throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
  }
  return uid;
}

/**
 * La membresia de quien llama EN LA ORGANIZACION QUE PIDE.
 *
 * El id es determinista (`{orgId}_{uid}`) igual que en las reglas, asi que esto es
 * una lectura de documento y no una consulta. Una membresia que no esta `active` no
 * vale: era el indice parcial `where status = 'active'` de Postgres, y perderlo aqui
 * dejaria entrar a alguien a quien se le retiro el acceso sin borrarle la fila.
 */
export async function membershipOf(uid: string, organizationId: string): Promise<Membership> {
  const snapshot = await db
    .collection(COLLECTIONS.memberships)
    .doc(`${organizationId}_${uid}`)
    .get();

  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'No perteneces a esta organización.');
  }

  const data = snapshot.data() ?? {};
  if (data.status !== 'active') {
    throw new HttpsError('permission-denied', 'Tu acceso a esta organización no está activo.');
  }

  return {
    organizationId,
    userId: uid,
    role: data.role as AppRole,
    status: data.status as Membership['status'],
    managedLocationIds: Array.isArray(data.managed_location_ids)
      ? (data.managed_location_ids as string[])
      : [],
    employeeId: typeof data.employee_id === 'string' ? data.employee_id : null,
  };
}

/** La organizacion de quien llama, cuando la peticion no la trae. */
export async function soleMembership(uid: string): Promise<Membership> {
  const found = await db
    .collection(COLLECTIONS.memberships)
    .where('user_id', '==', uid)
    .where('status', '==', 'active')
    .orderBy('created_at', 'asc')
    .limit(1)
    .get();

  const doc = found.docs[0];
  if (doc === undefined) {
    throw new HttpsError('permission-denied', 'No perteneces a ninguna organización.');
  }
  return membershipOf(uid, doc.data().organization_id as string);
}

export function requireRole(membership: Membership, roles: readonly AppRole[]): void {
  if (!roles.includes(membership.role)) {
    throw new HttpsError('permission-denied', 'Tu rol no permite esta operación.');
  }
}

/**
 * Que gestione ESA ubicacion, no cualquiera.
 *
 * Un owner o admin gestiona todas las de su organizacion y por eso no depende de la
 * lista: si dependiera, un admin recien creado no podria tocar nada hasta que
 * alguien le asignara ubicaciones a mano. Un manager solo las suyas — es lo que
 * impide que el encargado de una tienda corrija las horas de otra.
 */
export function managesLocation(membership: Membership, locationId: string): boolean {
  if (membership.role === 'owner' || membership.role === 'admin') return true;
  return membership.role === 'manager' && membership.managedLocationIds.includes(locationId);
}

export function requireManagesLocation(membership: Membership, locationId: string): void {
  if (managesLocation(membership, locationId)) return;
  throw new HttpsError('permission-denied', 'No administras esta ubicación.');
}

/**
 * Registro de auditoria. Nunca guarda PIN, token ni secreto (§14).
 *
 * No lanza: si la auditoria falla, la operacion que la genero ya ocurrio y hacerla
 * fracasar por no poder anotarla deja la base peor de lo que la deja el hueco en el
 * registro. El fallo se avisa en los logs para que se note.
 */
export async function audit(params: {
  organizationId: string;
  actorUserId?: string | null;
  actorDeviceId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await db.collection(COLLECTIONS.auditLogs).add({
      organization_id: params.organizationId,
      actor_user_id: params.actorUserId ?? null,
      actor_device_id: params.actorDeviceId ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      before_data: params.before ?? null,
      after_data: params.after ?? null,
      created_at: nowISO(),
    });
  } catch (error) {
    console.error('[krealo-shift] no se pudo escribir en audit_logs:', error);
  }
}
