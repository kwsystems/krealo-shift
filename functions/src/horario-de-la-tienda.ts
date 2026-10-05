import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db } from './shared/admin';
import { membershipOf, requireUid } from './shared/caller';

/**
 * EL HORARIO DE TODA LA TIENDA, PARA EL CELULAR DE CADA PERSONA (5-oct).
 *
 * Andree: «en la parte personal que ve cada uno de los trabajadores, necesito que también
 * puedan ver el horario general donde salen todas, aparte de solo el de uno, para que sepan
 * con quién estarán en horario».
 *
 * VA POR EL SERVIDOR PORQUE LAS REGLAS NO DEJAN OTRA COSA, y está bien que no dejen: un
 * `employee` lee solo sus turnos (`isSelfEmployee`). Abrirle `shifts` entero le daría
 * también los borradores sin publicar, las notas para cada persona y los turnos de sedes
 * donde no trabaja. Aquí se elige campo a campo lo que sale:
 *
 *   - de sus SEDES (las de su ficha), no de toda la empresa;
 *   - PUBLICADOS, más los que ya se publicaron y se están cambiando («por confirmar»,
 *     como en su propio horario). Un borrador nunca publicado no existe para nadie;
 *   - nombre visible, puesto y horas. NI NOTAS NI NADA MÁS: la nota de un turno es para
 *     su persona, y la privada de quien gestiona no sale ni a la persona.
 *
 * Como mucho 16 días por llamada: el celular pide esta semana y la siguiente juntas.
 */

const DIAS_MAXIMOS = 16;
const SEDES_MAXIMAS = 10;

export type TurnoDeLaTienda = {
  id: string;
  employee_id: string;
  nombre: string;
  puesto: string | null;
  color: string | null;
  location_id: string;
  starts_at: string;
  ends_at: string;
  por_confirmar: boolean;
  es_mio: boolean;
};

function instante(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) {
    throw new HttpsError('invalid-argument', `Falta ${campo}, o no es una fecha.`);
  }
  return new Date(Date.parse(valor)).toISOString();
}

/** El nombre con el que la conoce el equipo: el preferido si lo tiene. */
export function nombreVisible(ficha: Record<string, unknown>): string | null {
  const preferido = typeof ficha.preferred_name === 'string' ? ficha.preferred_name.trim() : '';
  if (preferido !== '') return preferido;
  const completo = typeof ficha.full_name === 'string' ? ficha.full_name.trim() : '';
  return completo === '' ? null : completo;
}

/** ¿Este turno existe para el equipo? Publicado, o publicado y ahora cambiándose. */
export function turnoVisible(turno: Record<string, unknown>): {
  visible: boolean;
  porConfirmar: boolean;
} {
  if (typeof turno.employee_id !== 'string' || turno.employee_id === '') {
    return { visible: false, porConfirmar: false };
  }
  if (turno.status === 'published') return { visible: true, porConfirmar: false };
  const version = typeof turno.publication_version === 'number' ? turno.publication_version : 0;
  if (turno.status === 'draft' && version > 0) return { visible: true, porConfirmar: true };
  return { visible: false, porConfirmar: false };
}

export const viewStoreSchedule = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = request.data?.p_organization_id;
  if (typeof organizationId !== 'string' || organizationId === '') {
    throw new HttpsError('invalid-argument', 'Falta la empresa.');
  }
  const desde = instante(request.data?.p_from, 'el inicio');
  const hasta = instante(request.data?.p_to, 'el final');
  if (Date.parse(hasta) <= Date.parse(desde)) {
    throw new HttpsError('invalid-argument', 'El final tiene que ser después del inicio.');
  }
  if (Date.parse(hasta) - Date.parse(desde) > DIAS_MAXIMOS * 24 * 60 * 60 * 1000) {
    throw new HttpsError('invalid-argument', `Como mucho ${DIAS_MAXIMOS} días de una vez.`);
  }

  const membership = await membershipOf(uid, organizationId);
  if (membership.employeeId === null) {
    throw new HttpsError('permission-denied', 'Tu cuenta no está unida a una ficha del equipo.');
  }
  const miFicha = (
    await db.collection(COLLECTIONS.employees).doc(membership.employeeId).get()
  ).data();
  // Una ficha dada de baja ya no ve el horario del equipo, igual que no ve el suyo.
  if (
    miFicha === undefined ||
    miFicha.organization_id !== organizationId ||
    miFicha.status !== 'active'
  ) {
    throw new HttpsError('permission-denied', 'Tu ficha no está activa.');
  }

  const asignaciones = await db
    .collection(COLLECTIONS.employeeLocations)
    .where('organization_id', '==', organizationId)
    .where('employee_id', '==', membership.employeeId)
    .get();
  const sedes = [...new Set(asignaciones.docs.map((doc) => String(doc.data().location_id ?? '')))]
    .filter((sede) => sede !== '')
    .slice(0, SEDES_MAXIMAS);

  const filas: { id: string; datos: Record<string, unknown>; porConfirmar: boolean }[] = [];
  for (const locationId of sedes) {
    const turnos = await db
      .collection(COLLECTIONS.shifts)
      .where('organization_id', '==', organizationId)
      .where('location_id', '==', locationId)
      .where('starts_at', '>=', desde)
      .where('starts_at', '<', hasta)
      .get();
    for (const doc of turnos.docs) {
      const datos = doc.data();
      const { visible, porConfirmar } = turnoVisible(datos);
      if (visible) filas.push({ id: doc.id, datos, porConfirmar });
    }
  }

  const leerVarios = async (coleccion: string, ids: readonly string[]) => {
    const unicos = [...new Set(ids.filter((id) => id !== ''))];
    if (unicos.length === 0) return new Map<string, Record<string, unknown>>();
    const docs = await db.getAll(...unicos.map((id) => db.collection(coleccion).doc(id)));
    return new Map(
      docs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data() ?? {}] as const),
    );
  };
  const fichas = await leerVarios(
    COLLECTIONS.employees,
    filas.map((fila) => String(fila.datos.employee_id)),
  );
  const puestos = await leerVarios(
    COLLECTIONS.jobRoles,
    filas.map((fila) => (typeof fila.datos.job_role_id === 'string' ? fila.datos.job_role_id : '')),
  );
  const nombresDeSede = await leerVarios(COLLECTIONS.locations, sedes);

  const turnos: TurnoDeLaTienda[] = [];
  for (const { id, datos, porConfirmar } of filas) {
    const employeeId = String(datos.employee_id);
    const ficha = fichas.get(employeeId);
    // Una ficha borrada no tiene nombre que enseñar: su turno no se inventa a nadie.
    const nombre = ficha === undefined ? null : nombreVisible(ficha);
    if (nombre === null) continue;
    const puesto =
      typeof datos.job_role_id === 'string' ? puestos.get(datos.job_role_id) : undefined;
    turnos.push({
      id,
      employee_id: employeeId,
      nombre,
      puesto: typeof puesto?.name === 'string' ? puesto.name : null,
      color: typeof puesto?.color === 'string' ? puesto.color : null,
      location_id: String(datos.location_id),
      starts_at: String(datos.starts_at),
      ends_at: String(datos.ends_at),
      por_confirmar: porConfirmar,
      es_mio: employeeId === membership.employeeId,
    });
  }
  turnos.sort((a, b) =>
    a.starts_at === b.starts_at
      ? a.nombre.localeCompare(b.nombre)
      : a.starts_at.localeCompare(b.starts_at),
  );

  return {
    turnos,
    sedes: sedes.map((id) => ({
      id,
      name:
        typeof nombresDeSede.get(id)?.name === 'string' ? String(nombresDeSede.get(id)?.name) : '',
    })),
  };
});
