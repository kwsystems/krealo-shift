import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { auth, COLLECTIONS, db, nowISO } from './shared/admin';
import { audit, membershipOf, requireRole, requireUid, type AppRole } from './shared/caller';
import { idDeInvitacion, normalizarCorreo } from './invitations';

/**
 * Quien tiene acceso a la organizacion, y con que rol.
 *
 * Esto existia solo como script de terminal (`dar-acceso.mjs`), o sea que dar acceso
 * a alguien requeria una maquina con credenciales de administrador del proyecto. Para
 * un negocio que contrata a un encargado nuevo eso no es una herramienta: es una
 * llamada a quien programo la app.
 *
 * LAS TRES GUARDAS QUE HACEN QUE ESTO SEA SEGURO, y ninguna es opcional:
 *
 *   1. NADIE REPARTE POR ENCIMA DE SI MISMO. Un admin no crea owners. Sin esto,
 *      cualquier admin se fabrica un owner y escala; es la forma mas comun de que un
 *      sistema de roles se rompa.
 *   2. NO SE PUEDE DEJAR LA ORGANIZACION SIN NADIE QUE MANDE. Quitar o degradar al
 *      ultimo owner/admin deja una empresa que nadie puede administrar y que solo se
 *      recupera con acceso al proyecto de Firebase. Es `guard_last_owner` de Postgres,
 *      que existia por lo mismo.
 *   3. NADIE SE DEGRADA A SI MISMO POR ERROR. Cambiarse el propio rol se rechaza con
 *      un mensaje que lo explica, en vez de dejar a alguien fuera de su propio panel
 *      con un clic mal dado.
 */

const RANGO: Record<AppRole, number> = { employee: 0, manager: 1, admin: 2, owner: 3 };

function rolValido(valor: unknown): AppRole {
  if (valor === 'owner' || valor === 'admin' || valor === 'manager' || valor === 'employee') {
    return valor;
  }
  throw new HttpsError('invalid-argument', 'Rol no válido.');
}

function textoRequerido(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new HttpsError('invalid-argument', `Falta «${campo}».`);
  }
  return valor.trim();
}

/** Las membresias activas con rango de mando. Se usa para no dejar la casa vacia. */
async function quienesMandan(organizationId: string): Promise<{ userId: string; role: AppRole }[]> {
  const encontrados = await db
    .collection(COLLECTIONS.memberships)
    .where('organization_id', '==', organizationId)
    .where('status', '==', 'active')
    .get();

  return encontrados.docs
    .map((d) => ({ userId: d.data().user_id as string, role: d.data().role as AppRole }))
    .filter((m) => m.role === 'owner' || m.role === 'admin');
}

/**
 * Quien tiene acceso y quien esta invitado.
 *
 * El correo NO esta en Firestore: vive en Firebase Auth, que el cliente no puede
 * consultar. Por eso esta lista la sirve una funcion y no una consulta directa — y de
 * paso permite devolver membresias e invitaciones juntas, que es como se miran.
 */
export const listMembers = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = textoRequerido(request.data?.organizationId, 'organizationId');
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  const membresias = await db
    .collection(COLLECTIONS.memberships)
    .where('organization_id', '==', organizationId)
    .get();

  const reales = membresias.docs.filter((d) => d.data()._centinela !== true);

  /**
   * `getUsers` en UN viaje y no uno por persona. Con veinte miembros son veinte
   * llamadas a Auth desde una funcion que ademas cobra por tiempo; y las que fallan
   * —cuentas borradas— no deben tumbar la lista entera.
   */
  const identificadores = reales
    .map((d) => d.data().user_id as string)
    .filter((u) => typeof u === 'string' && u !== '')
    .map((uidMiembro) => ({ uid: uidMiembro }));

  const cuentas = new Map<string, { email: string | null; displayName: string | null }>();
  if (identificadores.length > 0) {
    const resultado = await auth.getUsers(identificadores);
    for (const u of resultado.users) {
      cuentas.set(u.uid, { email: u.email ?? null, displayName: u.displayName ?? null });
    }
  }

  const invitaciones = await db
    .collection(COLLECTIONS.invitations)
    .where('organization_id', '==', organizationId)
    .where('status', '==', 'pending')
    .get();

  return {
    members: reales.map((d) => {
      const m = d.data();
      const cuenta = cuentas.get(m.user_id as string);
      return {
        userId: m.user_id,
        email: cuenta?.email ?? null,
        displayName: cuenta?.displayName ?? null,
        role: m.role,
        status: m.status,
        // Para que la pantalla pueda decir «eres tú» y no ofrecerte quitarte.
        isSelf: m.user_id === uid,
      };
    }),
    invitations: invitaciones.docs.map((d) => ({
      email: d.data().email,
      role: d.data().role,
      createdAt: d.data().created_at,
    })),
  };
});

export const setMemberRole = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = textoRequerido(request.data?.organizationId, 'organizationId');
  const objetivo = textoRequerido(request.data?.userId, 'userId');
  const nuevoRol = rolValido(request.data?.role);

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  if (objetivo === uid) {
    throw new HttpsError(
      'failed-precondition',
      'No puedes cambiarte el rol a ti mismo. Pídeselo a otro administrador.',
    );
  }
  if (RANGO[nuevoRol] > RANGO[membership.role]) {
    throw new HttpsError('permission-denied', 'No puedes dar un rol superior al tuyo.');
  }

  const ref = db.collection(COLLECTIONS.memberships).doc(`${organizationId}_${objetivo}`);
  const actual = (await ref.get()).data();
  if (actual === undefined) throw new HttpsError('not-found', 'Esa persona no tiene acceso.');

  const rolAnterior = actual.role as AppRole;
  if (RANGO[rolAnterior] > RANGO[membership.role]) {
    throw new HttpsError('permission-denied', 'No puedes cambiar el rol de alguien por encima.');
  }

  // Degradar al ultimo que manda deja la organizacion sin nadie que la administre.
  const mandan = await quienesMandan(organizationId);
  const bajaDeMando = RANGO[nuevoRol] < RANGO.admin;
  /**
   * ESTA GUARDA NO SE ALCANZA NUNCA, medido el 2026-09-22. Se deja y se explica en vez
   * de borrarse porque quitarla es decision de quien escribio esto.
   *
   * Para llegar aqui hay que haber pasado `requireRole(['owner','admin'])` —o sea,
   * estar dentro de `quienesMandan`— y no ser el objetivo, porque eso se rechaza antes.
   * Con las dos cosas ciertas, `mandan` tiene DOS entradas como minimo y `<= 1` no puede
   * cumplirse. Comprobado desactivandola: las doce pruebas de `members.test.ts` siguen
   * en verde.
   *
   * El invariante que pretende proteger —que la empresa nunca se quede sin nadie que la
   * administre— si se cumple, pero lo sostiene la comprobacion de «no te tocas a ti
   * mismo» de unas lineas mas arriba. Eso es lo que fija la prueba.
   *
   * Conviene decidir: o se borra, o se hace alcanzable. Mientras siga asi, alguien puede
   * quitar el «no te tocas a ti mismo» creyendo que esto lo cubre, y entonces el ultimo
   * admin si podra dejar la organizacion sin llaves.
   */
  if (bajaDeMando && mandan.length <= 1 && mandan.some((m) => m.userId === objetivo)) {
    throw new HttpsError(
      'failed-precondition',
      'Es la única persona que administra esta organización. Nombra a otra antes.',
    );
  }

  const ubicaciones = await db
    .collection(COLLECTIONS.locations)
    .where('organization_id', '==', organizationId)
    .get();

  await ref.update({
    role: nuevoRol,
    managed_location_ids:
      nuevoRol === 'owner' || nuevoRol === 'admin' ? ubicaciones.docs.map((d) => d.id) : [],
    updated_at: nowISO(),
  });

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'member_role_changed',
    entityType: 'organization_membership',
    entityId: ref.id,
    before: { role: rolAnterior },
    after: { role: nuevoRol },
  });

  return { ok: true };
});

/**
 * Retira el acceso. NO BORRA LA MEMBRESIA: la deja en `suspended`.
 *
 * Un borrado se lleva por delante el rastro de que esa persona tuvo acceso y con que
 * rol, y eso es justo lo que una auditoria laboral quiere poder ver. `suspended` no
 * pasa `isMember`, asi que el efecto es el mismo y la historia se conserva.
 */
export const revokeMember = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = textoRequerido(request.data?.organizationId, 'organizationId');
  const objetivo = textoRequerido(request.data?.userId, 'userId');

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  if (objetivo === uid) {
    throw new HttpsError('failed-precondition', 'No puedes quitarte el acceso a ti mismo.');
  }

  const ref = db.collection(COLLECTIONS.memberships).doc(`${organizationId}_${objetivo}`);
  const actual = (await ref.get()).data();
  if (actual === undefined) throw new HttpsError('not-found', 'Esa persona no tiene acceso.');

  if (RANGO[actual.role as AppRole] > RANGO[membership.role]) {
    throw new HttpsError('permission-denied', 'No puedes quitar el acceso a alguien por encima.');
  }

  const mandan = await quienesMandan(organizationId);
  // Tampoco se alcanza, y por el mismo motivo exacto que en `setMemberRole`: quien llama
  // esta dentro de `mandan` y no es el objetivo, asi que `mandan` tiene dos o mas.
  if (mandan.length <= 1 && mandan.some((m) => m.userId === objetivo)) {
    throw new HttpsError(
      'failed-precondition',
      'Es la única persona que administra esta organización. Nombra a otra antes.',
    );
  }

  await ref.update({ status: 'suspended', updated_at: nowISO() });

  /**
   * Y se revocan sus sesiones. Sin esto, quien acaba de perder el acceso sigue
   * dentro hasta que su token caduque —hasta una hora— y en ese rato puede seguir
   * leyendo horas y aprobando periodos. Quitar el acceso tiene que quitar el acceso.
   */
  await auth.revokeRefreshTokens(objetivo).catch((error: unknown) => {
    console.error('[krealo-shift] no se pudieron revocar las sesiones:', error);
  });

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'member_revoked',
    entityType: 'organization_membership',
    entityId: ref.id,
    before: { role: actual.role, status: actual.status },
  });

  return { ok: true };
});

export const cancelInvitation = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = textoRequerido(request.data?.organizationId, 'organizationId');
  const correo = normalizarCorreo(textoRequerido(request.data?.email, 'email'));

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  const id = idDeInvitacion(organizationId, correo);
  const ref = db.collection(COLLECTIONS.invitations).doc(id);
  if (!(await ref.get()).exists) {
    throw new HttpsError('not-found', 'No hay invitación para ese correo.');
  }

  await ref.delete();

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'invitation_cancelled',
    entityType: 'invitation',
    entityId: id,
    before: { email: correo },
  });

  return { ok: true };
});
