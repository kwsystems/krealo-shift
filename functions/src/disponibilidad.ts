import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import {
  audit,
  managesLocation,
  membershipOf,
  requireRole,
  requireUid,
  type Membership,
} from './shared/caller';

/**
 * LA DISPONIBILIDAD DE CADA PERSONA (1-oct), como en Homebase.
 *
 * Andree: «ahí hay un apartado donde todos los vendedores pueden poner sus comentarios en
 * los días, diciendo qué días tienen problemas para trabajar». Cada fila es una de dos:
 *
 *   - CADA SEMANA (`weekly`): un día de la semana que se repite —«los martes no puedo,
 *     estudio»—.
 *   - UN DÍA (`date`): una fecha concreta —«el 15 tengo cita médica»—.
 *
 * Y dice una de tres cosas: NO PUEDE (todo el día o una franja), PREFIERE una franja, o
 * solo deja una NOTA. La escribe la propia persona desde su celular o quien gestiona en su
 * nombre; quien gestiona la ve en Equipo → Disponibilidad y en el Horario, y la da por
 * vista. No se aprueba ni se rechaza: es lo que la persona dice, no un permiso.
 *
 * TODO VA POR AQUÍ, y las reglas no dejan escribirla desde la app: así se valida igual
 * venga de donde venga, y se sabe quién la escribió.
 */

const TIPOS = ['unavailable', 'preferred', 'note'] as const;
type Tipo = (typeof TIPOS)[number];
const NOTA_MAXIMA = 280;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

type Quien = { membership: Membership; esLaPersona: boolean };

/**
 * Quien llama puede tocar la disponibilidad de esa persona si ES esa persona, o si
 * gestiona alguna de las sedes donde trabaja (dueño y administración, todas).
 */
async function puedeTocar(uid: string, organizationId: string, employeeId: string): Promise<Quien> {
  const membership = await membershipOf(uid, organizationId);
  if (membership.employeeId === employeeId) return { membership, esLaPersona: true };
  requireRole(membership, ['owner', 'admin', 'manager']);
  if (membership.role === 'manager') {
    const sedes = (
      await db
        .collection(COLLECTIONS.employeeLocations)
        .where('employee_id', '==', employeeId)
        .get()
    ).docs.map((doc) => String(doc.data().location_id));
    if (!sedes.some((sede) => managesLocation(membership, sede))) {
      throw new HttpsError('permission-denied', 'No gestionas ninguna sede de esta persona.');
    }
  }
  return { membership, esLaPersona: false };
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/** Guardar —nueva o cambiada— una fila de disponibilidad. */
export const saveAvailability = onCall(async (request) => {
  const uid = requireUid(request);
  const datos = (request.data ?? {}) as Record<string, unknown>;
  const organizationId = texto(datos.p_organization_id);
  if (organizationId === null) throw new HttpsError('invalid-argument', 'Falta la empresa.');

  const id = texto(datos.p_id);
  const ref =
    id === null
      ? db.collection(COLLECTIONS.availability).doc()
      : db.collection(COLLECTIONS.availability).doc(id);
  const previa = id === null ? undefined : (await ref.get()).data();
  if (id !== null && previa === undefined) {
    throw new HttpsError('not-found', 'Esa disponibilidad ya no existe.');
  }
  if (previa !== undefined && previa.organization_id !== organizationId) {
    throw new HttpsError('permission-denied', 'Esa disponibilidad es de otra empresa.');
  }

  // La persona: la de la fila si ya existe, la pedida, o —desde su celular— ella misma.
  const membresia = await membershipOf(uid, organizationId);
  const employeeId =
    (previa?.employee_id as string | undefined) ??
    texto(datos.p_employee_id) ??
    membresia.employeeId;
  if (employeeId === null) throw new HttpsError('invalid-argument', 'Falta la persona.');
  const quien = await puedeTocar(uid, organizationId, employeeId);

  const kind = datos.p_kind === 'date' ? 'date' : datos.p_kind === 'weekly' ? 'weekly' : null;
  if (kind === null) throw new HttpsError('invalid-argument', 'Di si es cada semana o un día.');
  const weekday = kind === 'weekly' ? Number(datos.p_weekday) : null;
  if (weekday !== null && !(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)) {
    throw new HttpsError('invalid-argument', 'Ese día de la semana no existe.');
  }
  const date = kind === 'date' ? texto(datos.p_date) : null;
  if (kind === 'date' && (date === null || !DIA.test(date))) {
    throw new HttpsError('invalid-argument', 'Esa fecha no es válida.');
  }

  const type = datos.p_type as Tipo;
  if (!TIPOS.includes(type)) throw new HttpsError('invalid-argument', 'Ese tipo no existe.');
  const desde = texto(datos.p_from);
  const hasta = texto(datos.p_to);
  if ((desde === null) !== (hasta === null)) {
    throw new HttpsError('invalid-argument', 'Pon las dos horas, o ninguna para todo el día.');
  }
  if (desde !== null && hasta !== null) {
    if (!HORA.test(desde) || !HORA.test(hasta)) {
      throw new HttpsError('invalid-argument', 'Esa hora no es válida.');
    }
    if (hasta <= desde) {
      throw new HttpsError(
        'invalid-argument',
        'La hora final tiene que ser después de la inicial.',
        {
          motivo: 'HORAS',
        },
      );
    }
  }
  if (type === 'preferred' && desde === null) {
    throw new HttpsError('invalid-argument', 'Di qué horas prefieres.', { motivo: 'HORAS' });
  }
  const note = texto(datos.p_note);
  if (note !== null && note.length > NOTA_MAXIMA) {
    throw new HttpsError('invalid-argument', `La nota es demasiado larga (máximo ${NOTA_MAXIMA}).`);
  }
  if (type === 'note' && note === null) {
    throw new HttpsError('invalid-argument', 'Escribe el comentario.', { motivo: 'NOTA' });
  }

  const ahora = nowISO();
  await ref.set(
    {
      id: ref.id,
      organization_id: organizationId,
      employee_id: employeeId,
      kind,
      weekday,
      date,
      type,
      from_time: desde,
      to_time: hasta,
      note,
      /*
       * LO QUE ESCRIBE LA PERSONA LLEGA COMO NUEVO, y lo que escribe quien gestiona ya
       * está visto: es suyo. Cambiar una fila la vuelve a poner como nueva si la cambia
       * la persona, para que se vea que dijo otra cosa.
       */
      status: quien.esLaPersona ? 'new' : 'seen',
      source: quien.esLaPersona ? 'employee' : 'manager',
      updated_by: uid,
      updated_at: ahora,
      ...(previa === undefined ? { created_by: uid, created_at: ahora } : {}),
    },
    { merge: true },
  );

  await audit({
    organizationId,
    actorUserId: uid,
    action: previa === undefined ? 'availability_created' : 'availability_updated',
    entityType: 'availability',
    entityId: ref.id,
  });
  return { id: ref.id };
});

/** Quitar una fila. */
export const deleteAvailability = onCall(async (request) => {
  const uid = requireUid(request);
  const id = texto((request.data as Record<string, unknown> | undefined)?.p_id);
  if (id === null) throw new HttpsError('invalid-argument', 'Falta cuál.');
  const ref = db.collection(COLLECTIONS.availability).doc(id);
  const fila = (await ref.get()).data();
  if (fila === undefined) return { id };
  await puedeTocar(uid, String(fila.organization_id), String(fila.employee_id));
  await ref.delete();
  await audit({
    organizationId: String(fila.organization_id),
    actorUserId: uid,
    action: 'availability_deleted',
    entityType: 'availability',
    entityId: id,
  });
  return { id };
});

/** Darlas por vistas: solo quien gestiona, y solo las de sus personas. */
export const markAvailabilitySeen = onCall(async (request) => {
  const uid = requireUid(request);
  const ids = (request.data as Record<string, unknown> | undefined)?.p_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
    throw new HttpsError('invalid-argument', 'Faltan cuáles.');
  }
  const ahora = nowISO();
  let vistas = 0;
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const ref = db.collection(COLLECTIONS.availability).doc(id);
    const fila = (await ref.get()).data();
    if (fila === undefined) continue;
    const quien = await puedeTocar(uid, String(fila.organization_id), String(fila.employee_id));
    if (quien.esLaPersona) {
      throw new HttpsError('permission-denied', 'La da por vista quien gestiona.');
    }
    await ref.update({ status: 'seen', seen_by: uid, seen_at: ahora });
    vistas += 1;
  }
  return { vistas };
});
