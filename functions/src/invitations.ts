import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { cerrarContrasenaAjena, proveedorDeLaSesion } from './acceso-por-correo';
import { ligarFichaDeEmpleado } from './ficha-de-empleado';
import { COLLECTIONS, auth, db, nowISO } from './shared/admin';
import { audit, membershipOf, requireRole, requireUid, type AppRole } from './shared/caller';

/**
 * Invitaciones por correo (§7, estado `invited` de `membership_status`).
 *
 * POR QUE HACEN FALTA, Y NO SE PUEDE «DAR DE ALTA» A ALGUIEN SIN MAS
 *
 * La membresia se identifica por el `uid` que Firebase asigna al entrar con Google, y
 * ese `uid` NO EXISTE hasta que la persona entra por primera vez. Asi que hay dos
 * caminos posibles y solo uno es aceptable:
 *
 *   1. crearle la cuenta desde aqui con su correo — se puede tecnicamente, y significa
 *      fabricar la identidad de otra persona en un sistema de fichajes donde esa
 *      identidad firma horas que se pagan. No se hace.
 *   2. dejar una invitacion escrita y que la reclame quien de verdad demuestre ser ese
 *      correo, entrando con Google. Es esto.
 *
 * El estado `invited` ya estaba en el modelo de datos desde el principio: esto lo usa,
 * no lo inventa.
 */

/** Un correo se compara siempre en minusculas y sin espacios. */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

export function idDeInvitacion(organizationId: string, correo: string): string {
  return `${organizationId}_${normalizarCorreo(correo)}`;
}

/**
 * Reclama la invitacion de quien llama, si la hay.
 *
 * EL CORREO SALE DEL TOKEN VERIFICADO, NUNCA DE UN PARAMETRO, y eso es toda la
 * seguridad de este mecanismo: con un parametro, cualquiera con una cuenta de Google
 * podria reclamar la invitacion de administrador de otro escribiendo su correo.
 *
 * Y se exige `email_verified`. Con Google como unico proveedor viene siempre en true,
 * pero eso es una propiedad de la configuracion de HOY: el dia que se habilite el
 * acceso por correo y contrasena, sin esta comprobacion bastaria con registrarse
 * diciendo ser `andree@` para heredar su rol.
 *
 * Es idempotente: si ya hay membresia, la devuelve y no toca nada.
 */
export const claimInvitation = onCall(async (request) => {
  const uid = requireUid(request);
  const token = request.auth?.token;

  const correo = typeof token?.email === 'string' ? normalizarCorreo(token.email) : null;
  if (correo === null) {
    throw new HttpsError('failed-precondition', 'Tu cuenta no tiene un correo asociado.');
  }
  if (token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Tu correo no está verificado.');
  }

  /*
   * AQUÍ SE RECHAZABA TODA SESIÓN `password`, Y ESO DEJABA FUERA A QUIEN ENTRA POR ENLACE
   * (30-sep). Firebase marca las dos igual: el enlace al correo es de la familia «correo»,
   * y su token dice `sign_in_provider: 'password'` como el de una alta con contraseña —se
   * midió contra el emulador de Auth—. Las pruebas usaban un 'emailLink' inventado que
   * Firebase no manda nunca, así que pasaban, y en producción una administradora invitada
   * entraba por su enlace, su invitación no se canjeaba y el panel le decía «tu rol no
   * permite ver esto».
   *
   * LO QUE SÍ LAS DISTINGUE ES `email_verified`, que ya se exige arriba: el enlace lo pone
   * en true —abrirlo demuestra el correo— y una alta con contraseña lo deja en false. Esa es
   * la puerta. Ver `acceso-por-correo.ts`.
   */
  const proveedor = proveedorDeLaSesion(token);

  const pendientes = await db
    .collection(COLLECTIONS.invitations)
    .where('email', '==', correo)
    .where('status', '==', 'pending')
    .get();

  const invitacion = pendientes.docs[0];
  /*
   * SIN INVITACIÓN, SE MIRA SI ESE CORREO ES EL DE UNA FICHA DE EMPLEADO: así entra un
   * vendedor a ver su horario desde el celular. La invitación manda cuando hay las dos:
   * quien fue invitado a administrar entra a administrar. Ver `ficha-de-empleado.ts`.
   */
  if (invitacion === undefined) {
    return ligarFichaDeEmpleado({ uid, correo, proveedor, token });
  }

  /*
   * ANTES DE CANJEAR CON UNA SESIÓN DE CORREO —el enlace, que Firebase llama `password`—,
   * se cierra cualquier contraseña que la cuenta tuviera: es el secuestro previo de
   * `acceso-por-correo.ts`. La app no pone contraseñas, así que una que exista es ajena. En
   * el caso normal no hay ninguna y no se toca nada.
   */
  const contrasenaAnulada =
    proveedor === 'password' ? await cerrarContrasenaAjena(uid, auth) : false;

  const datos = invitacion.data();
  const organizationId = datos.organization_id as string;
  const rol = datos.role as string;

  const membresiaRef = db.collection(COLLECTIONS.memberships).doc(`${organizationId}_${uid}`);

  const ubicaciones = await db
    .collection(COLLECTIONS.locations)
    .where('organization_id', '==', organizationId)
    .get();
  /*
   * UN GERENTE GESTIONA LAS SEDES QUE SE ELIGIERON AL INVITARLO (4-oct). Se quedaba con la
   * lista vacía y nada la rellenaba: entraba al panel y Horas, Inicio, Bandeja y Reportes le
   * decían «Falta un permiso». Solo las que siguen siendo de la empresa.
   */
  const deLaEmpresa = new Set(ubicaciones.docs.map((d) => d.id));
  const sedesDelGerente = Array.isArray(datos.location_ids)
    ? (datos.location_ids as unknown[]).filter(
        (id): id is string => typeof id === 'string' && deLaEmpresa.has(id),
      )
    : [];

  await db.runTransaction(async (tx) => {
    const actual = await tx.get(invitacion.ref);
    if (actual.data()?.status !== 'pending') {
      throw new HttpsError('aborted', 'Esa invitación ya se usó.');
    }
    // Su ficha de empleado, si ya la tenía ligada, no se pierde al canjear (4-oct).
    const membresiaPrevia = (await tx.get(membresiaRef)).data();

    tx.set(
      membresiaRef,
      {
        id: membresiaRef.id,
        organization_id: organizationId,
        user_id: uid,
        role: rol,
        status: 'active',
        /**
         * Un owner o admin administra TODAS las ubicaciones de su organizacion, asi
         * que la lista se rellena entera. Para un manager vendria de sus asignaciones,
         * que todavia no existen cuando reclama: se queda vacia y la rellena
         * `syncManagedLocations` al asignarle tiendas.
         */
        managed_location_ids:
          rol === 'owner' || rol === 'admin'
            ? ubicaciones.docs.map((d) => d.id)
            : rol === 'manager'
              ? sedesDelGerente
              : [],
        employee_id: (membresiaPrevia?.employee_id as string | null | undefined) ?? null,
        created_at: nowISO(),
        updated_at: nowISO(),
      },
      { merge: true },
    );

    tx.set(
      db.collection(COLLECTIONS.profiles).doc(uid),
      {
        id: uid,
        full_name: (token?.name as string | undefined) ?? correo,
        preferred_name: null,
        avatar_path: (token?.picture as string | undefined) ?? null,
        locale: 'es-PE',
        phone: null,
        created_at: nowISO(),
        updated_at: nowISO(),
      },
      { merge: true },
    );

    tx.update(invitacion.ref, {
      status: 'claimed',
      claimed_by: uid,
      claimed_at: nowISO(),
    });
  });

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'invitation_claimed',
    entityType: 'organization_membership',
    entityId: membresiaRef.id,
    after: { role: rol, email: correo, via: proveedor, contrasenaAnulada },
  });

  return { claimed: true, organizationId, role: rol };
});

const RANGO: Record<AppRole, number> = { employee: 0, manager: 1, admin: 2, owner: 3 };

/**
 * Invita a alguien por correo. Solo owner o admin, y solo a su organizacion.
 *
 * NO SE PUEDE INVITAR POR ENCIMA DE UNO MISMO, y ahora se comprueba POR RANGO y no
 * con una lista fija de roles. La version anterior prohibia `owner` a secas, lo que
 * cerraba el agujero —un admin no puede fabricarse un owner— pero de paso impedia
 * que un OWNER invitara a otro owner, que es legitimo y necesario: sin eso, sumar un
 * segundo propietario solo se podia por terminal, justo lo que esta pantalla vino a
 * quitar.
 *
 * `setMemberRole` ya comparaba por rango; esto lo alinea con aquello. Dos reglas
 * distintas para la misma decision es como se acaban abriendo agujeros: alguien
 * arregla una y no sabe que hay otra.
 */
export const inviteMember = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = String(request.data?.organizationId ?? '');
  const correo = normalizarCorreo(String(request.data?.email ?? ''));
  const rol = String(request.data?.role ?? 'manager');
  const pedidas: unknown[] = Array.isArray(request.data?.locationIds)
    ? request.data.locationIds
    : [];

  if (!correo.includes('@')) {
    throw new HttpsError('invalid-argument', 'Ese correo no parece válido.');
  }
  if (!['owner', 'admin', 'manager', 'employee'].includes(rol)) {
    throw new HttpsError('invalid-argument', 'Rol no válido para una invitación.');
  }

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  if (RANGO[rol as AppRole] > RANGO[membership.role]) {
    throw new HttpsError('permission-denied', 'No puedes invitar con un rol superior al tuyo.');
  }

  // Un gerente sin sedes no puede hacer nada: se eligen al invitarlo (4-oct).
  const sedes = rol === 'manager' ? await sedesDeLaEmpresa(organizationId, pedidas) : [];
  if (rol === 'manager' && sedes.length === 0) {
    throw new HttpsError('invalid-argument', 'Elige al menos una sede para el gerente.', {
      motivo: 'SIN_SEDES',
    });
  }

  const id = idDeInvitacion(organizationId, correo);
  await db.collection(COLLECTIONS.invitations).doc(id).set(
    {
      id,
      organization_id: organizationId,
      email: correo,
      role: rol,
      location_ids: sedes,
      status: 'pending',
      invited_by: uid,
      created_at: nowISO(),
    },
    { merge: true },
  );

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'member_invited',
    entityType: 'invitation',
    entityId: id,
    after: { email: correo, role: rol },
  });

  return { invitationId: id };
});

/** Las sedes pedidas que de verdad son de la empresa, sin repetir. */
export async function sedesDeLaEmpresa(
  organizationId: string,
  pedidas: readonly unknown[],
): Promise<string[]> {
  const ubicaciones = await db
    .collection(COLLECTIONS.locations)
    .where('organization_id', '==', organizationId)
    .get();
  const deLaEmpresa = new Set(ubicaciones.docs.map((d) => d.id));
  return [
    ...new Set(pedidas.filter((id): id is string => typeof id === 'string' && deLaEmpresa.has(id))),
  ];
}
