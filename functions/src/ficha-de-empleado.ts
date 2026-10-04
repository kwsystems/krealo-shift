import type { DecodedIdToken } from 'firebase-admin/auth';

import { cerrarContrasenaAjena } from './acceso-por-correo';
import { COLLECTIONS, auth, db, nowISO } from './shared/admin';
import { audit } from './shared/caller';

/**
 * EL CORREO DE LA FICHA ES LA INVITACIÓN DEL VENDEDOR.
 *
 * Lo pidió Andree el 30-sep: que cada vendedor entre desde su celular y vea SOLO lo suyo
 * —su horario, sus horas, si llegó tarde—. Para eso tiene que existir una cuenta ligada a
 * su ficha de empleado, y la forma más simple de decir «esta cuenta es esta persona» ya
 * estaba en la app: el campo de correo de la ficha. Quien administra lo escribe en Equipo,
 * y la primera vez que alguien entra con ese correo —verificado por Google o por el enlace
 * al correo—, queda ligado a la ficha con el rol `employee`.
 *
 * No hace falta una invitación aparte, ni un paso más en Ajustes: sería pedir el mismo
 * dato dos veces, y el día que no coincidieran nadie sabría cuál vale.
 *
 * LO QUE NO SE LIGA, y por qué:
 *   - una ficha INACTIVA: quien ya no trabaja no tiene por qué entrar;
 *   - un correo que está en DOS fichas de la misma empresa: no se sabe cuál de las dos es
 *     quien entra, y adivinar le enseñaría a una persona las horas de otra;
 *   - una ficha que YA tiene otra cuenta ligada: la segunda cuenta vería las horas de la
 *     primera persona;
 *   - una empresa donde esa cuenta YA es miembro —un gerente que también ficha—: su
 *     membresía no se toca. Ver lo suyo desde el panel es otra obra.
 *
 * Las reglas de Firestore hacen el resto: un `employee` solo lee su ficha, sus turnos, sus
 * jornadas y sus fichajes (`isSelfEmployee`).
 */

export type ResultadoDeLaFicha =
  | { claimed: true; organizationId: string; role: 'employee' }
  | { claimed: false; reason: 'sin-invitacion' | 'correo-repetido' | 'ya-ligada' };

export async function ligarFichaDeEmpleado(params: {
  uid: string;
  correo: string;
  proveedor: string | null;
  token: DecodedIdToken | undefined;
}): Promise<ResultadoDeLaFicha> {
  const { uid, correo, proveedor, token } = params;

  const fichas = await db
    .collection(COLLECTIONS.employees)
    .where('email', '==', correo)
    .where('status', '==', 'active')
    .get();
  if (fichas.empty) return { claimed: false, reason: 'sin-invitacion' };

  const porEmpresa = new Map<string, typeof fichas.docs>();
  for (const ficha of fichas.docs) {
    const org = ficha.data().organization_id as string;
    porEmpresa.set(org, [...(porEmpresa.get(org) ?? []), ficha]);
  }

  // Un correo en dos fichas de la misma empresa no dice quién es: esa empresa no se liga.
  const candidatas = [...porEmpresa].filter(([, docs]) => docs.length === 1);
  if (candidatas.length === 0) return { claimed: false, reason: 'correo-repetido' };

  const ligables: { org: string; employeeId: string }[] = [];
  for (const [org, [ficha]] of candidatas) {
    if (ficha === undefined) continue;
    const otras = await db
      .collection(COLLECTIONS.memberships)
      .where('organization_id', '==', org)
      .where('employee_id', '==', ficha.id)
      .get();
    // Solo una cuenta ACTIVA la tiene tomada: una retirada no bloquea a la nueva (4-oct).
    if (otras.docs.some((m) => m.data().user_id !== uid && m.data().status === 'active')) continue;
    ligables.push({ org, employeeId: ficha.id });
  }
  if (ligables.length === 0) return { claimed: false, reason: 'ya-ligada' };

  // El secuestro previo, igual que al canjear una invitación: ver `acceso-por-correo.ts`.
  const contrasenaAnulada =
    proveedor === 'password' ? await cerrarContrasenaAjena(uid, auth) : false;

  let primera: string | null = null;
  for (const { org, employeeId } of ligables) {
    const ref = db.collection(COLLECTIONS.memberships).doc(`${org}_${uid}`);
    const creada = await db.runTransaction(async (tx) => {
      const previa = (await tx.get(ref)).data();
      if (previa !== undefined) {
        /*
         * YA ES MIEMBRO. Si es una cuenta de EMPLEADO, activa y sin ficha —la que queda al
         * invitar a alguien como Empleado desde Ajustes—, se liga ahora (4-oct): antes nunca
         * se ligaba y su celular decía para siempre «pide que pongan este correo en tu
         * ficha», aunque ya estuviera puesto. Un gerente o administrador no se toca.
         */
        const sinFicha = (previa.employee_id ?? null) === null;
        if (previa.role !== 'employee' || previa.status !== 'active' || !sinFicha) return false;
        tx.update(ref, { employee_id: employeeId, updated_at: nowISO() });
        return true;
      }
      tx.set(ref, {
        id: ref.id,
        organization_id: org,
        user_id: uid,
        role: 'employee',
        status: 'active',
        managed_location_ids: [],
        employee_id: employeeId,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
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
      return true;
    });
    if (!creada) continue;
    primera ??= org;
    await audit({
      organizationId: org,
      actorUserId: uid,
      action: 'employee_account_linked',
      entityType: 'organization_membership',
      entityId: ref.id,
      after: { employee_id: employeeId, email: correo, via: proveedor, contrasenaAnulada },
    });
  }

  return primera === null
    ? { claimed: false, reason: 'ya-ligada' }
    : { claimed: true, organizationId: primera, role: 'employee' };
}
