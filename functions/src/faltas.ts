import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  NOTA_MAXIMA_DE_FALTA,
  motivoValido,
  type MotivoDeFalta,
  type TipoDeFalta,
} from '../../src/domain/motivos-de-falta';
import { diaLocal } from './horario-cumplido';
import { COLLECTIONS, db, nowISO } from './shared/admin';
import {
  audit,
  membershipOf,
  requireManagesLocation,
  requireRole,
  requireUid,
} from './shared/caller';

/**
 * POR QUÉ FALTÓ (2-oct): lo que quien gestiona dice de una falta —justificada o no, y el
 * motivo—. Una por turno, con el id del turno: decirlo dos veces lo cambia, no lo duplica.
 *
 * Qué es una falta lo decide la app con los datos de siempre (`timesheets/faltas.ts`): un
 * turno publicado que terminó sin ninguna marca. Aquí no se vuelve a decidir: se guarda lo
 * que se dijo de ese turno, y si después resulta que vino —un fichaje manual—, la falta
 * deja de serlo y esto se queda sin efecto, sin que haga falta borrarlo.
 *
 * SOLO EL SERVIDOR LA ESCRIBE, y solo quien gestiona la sede del turno: cambia el bono de
 * alguien. La persona la LEE en su celular —es sobre ella— y las reglas no dejan
 * escribirla desde la app.
 */

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

async function turnoQueSeGestiona(uid: string, shiftId: string) {
  const turno = (await db.collection(COLLECTIONS.shifts).doc(shiftId).get()).data();
  if (turno === undefined) throw new HttpsError('not-found', 'Ese turno ya no existe.');
  const organizationId = String(turno.organization_id);
  const locationId = String(turno.location_id);
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin', 'manager']);
  requireManagesLocation(membership, locationId);
  return { turno, organizationId, locationId };
}

export const resolveAbsence = onCall(async (request) => {
  const uid = requireUid(request);
  const datos = (request.data ?? {}) as Record<string, unknown>;
  const shiftId = texto(datos.p_shift_id);
  if (shiftId === null) throw new HttpsError('invalid-argument', 'Falta el turno.');
  const { turno, organizationId, locationId } = await turnoQueSeGestiona(uid, shiftId);

  if (turno.status !== 'published') {
    throw new HttpsError('failed-precondition', 'Ese turno no está publicado.');
  }
  if (Date.parse(String(turno.ends_at)) > Date.now()) {
    throw new HttpsError('failed-precondition', 'Ese turno todavía no terminó.', {
      motivo: 'NO_TERMINO',
    });
  }

  const tipo = datos.p_kind as TipoDeFalta;
  const motivo = datos.p_reason as MotivoDeFalta;
  if (!motivoValido(tipo, motivo)) {
    throw new HttpsError('invalid-argument', 'Ese motivo no vale para ese tipo de falta.', {
      motivo: 'MOTIVO',
    });
  }
  const nota = texto(datos.p_note);
  if (nota !== null && nota.length > NOTA_MAXIMA_DE_FALTA) {
    throw new HttpsError('invalid-argument', 'El comentario es demasiado largo.', {
      motivo: 'NOTA',
    });
  }
  if (motivo === 'other' && nota === null) {
    throw new HttpsError('invalid-argument', 'Escribe qué pasó.', { motivo: 'NOTA' });
  }

  const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const zona = typeof sede?.timezone === 'string' ? sede.timezone : 'America/Lima';
  const ref = db.collection(COLLECTIONS.absenceResolutions).doc(shiftId);
  const previa = (await ref.get()).data();
  const ahora = nowISO();
  const fila = {
    id: shiftId,
    organization_id: organizationId,
    location_id: locationId,
    employee_id: String(turno.employee_id),
    shift_id: shiftId,
    work_date: diaLocal(String(turno.starts_at), zona),
    kind: tipo,
    reason: motivo,
    note: nota,
    decided_by: uid,
    decided_at: ahora,
    updated_at: ahora,
  };
  await ref.set(fila);
  await audit({
    organizationId,
    actorUserId: uid,
    action: previa === undefined ? 'absence_resolved' : 'absence_resolution_changed',
    entityType: 'absence_resolution',
    entityId: shiftId,
    before: previa ?? null,
    after: { kind: tipo, reason: motivo },
  });
  return { id: shiftId };
});

/** Volver a «sin revisar»: lo que se dijo deja de valer y queda en la auditoría. */
export const clearAbsenceResolution = onCall(async (request) => {
  const uid = requireUid(request);
  const shiftId = texto((request.data as Record<string, unknown> | undefined)?.p_shift_id);
  if (shiftId === null) throw new HttpsError('invalid-argument', 'Falta el turno.');
  const ref = db.collection(COLLECTIONS.absenceResolutions).doc(shiftId);
  const previa = (await ref.get()).data();
  if (previa === undefined) return { id: shiftId };
  const membership = await membershipOf(uid, String(previa.organization_id));
  requireRole(membership, ['owner', 'admin', 'manager']);
  requireManagesLocation(membership, String(previa.location_id));
  await ref.delete();
  await audit({
    organizationId: String(previa.organization_id),
    actorUserId: uid,
    action: 'absence_resolution_cleared',
    entityType: 'absence_resolution',
    entityId: shiftId,
    before: previa,
  });
  return { id: shiftId };
});
