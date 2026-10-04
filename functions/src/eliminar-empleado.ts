import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { DocumentReference, Query } from 'firebase-admin/firestore';

import { COLLECTIONS, db } from './shared/admin';
import { audit, membershipOf, requireRole, requireUid } from './shared/caller';

/**
 * ELIMINAR A UN EMPLEADO Y TODO SU HISTORIAL. Para quien se dio de alta por error o para
 * probar, no para quien se fue: a quien se va se le DESACTIVA, y su historial se queda.
 *
 * POR QUÉ EXISTE. Andree, el 29-sep: «Joseph, Ana, esos son de prueba, hay que sacarlos;
 * de equipo aparecen, borrarlos hasta de inactivos». Desactivar no bastaba: seguían en
 * Inactivos, en los filtros de Horas y —lo que de verdad importa— sus fichajes de prueba
 * seguían sumando en Horas y en Reportes.
 *
 * POR QUÉ BORRAR Y NO ESCONDER. Esconder obligaba a filtrarlos en una decena de sitios
 * —Equipo, Horas, Reportes, Inicio, Horario, el CSV y los totales que suma el servidor—,
 * y bastaba con que se escapara uno para que las horas de prueba ensuciaran un reporte.
 * Borrando, todo lo demás queda coherente solo.
 *
 * LOS TRES SEGUROS, porque borrar a la persona equivocada no tiene vuelta atrás y el resto
 * del equipo ya está usando la app:
 *   1. Solo a alguien YA INACTIVO. Primero se desactiva y luego se elimina: dos pasos.
 *   2. `dryRun` devuelve cuánto se va a borrar SIN borrar nada, para que la pantalla lo
 *      diga antes de pedir la confirmación, y la confirmación exige el nombre exacto.
 *   3. Solo dueño o administrador, y queda en la auditoría con lo que se borró.
 */

const TROZO = 30; // el máximo de valores de un `in` en Firestore

type Recuento = {
  fichajes: number;
  jornadas: number;
  turnos: number;
  descansosLibres: number;
  solicitudes: number;
  correcciones: number;
  otros: number;
};

function porEmpleado(coleccion: string, organizationId: string, employeeId: string): Query {
  return db
    .collection(coleccion)
    .where('organization_id', '==', organizationId)
    .where('employee_id', '==', employeeId);
}

async function refsDe(consulta: Query): Promise<DocumentReference[]> {
  return (await consulta.get()).docs.map((d) => d.ref);
}

async function porLotes<T>(valores: T[], hacer: (trozo: T[]) => Promise<DocumentReference[]>) {
  const salida: DocumentReference[] = [];
  for (let i = 0; i < valores.length; i += TROZO) {
    salida.push(...(await hacer(valores.slice(i, i + TROZO))));
  }
  return salida;
}

export const deleteEmployee = onCall(async (request) => {
  const uid = requireUid(request);
  const employeeId = request.data?.employeeId;
  const dryRun = request.data?.dryRun === true;
  const confirmacion =
    typeof request.data?.confirmName === 'string' ? request.data.confirmName : '';
  if (typeof employeeId !== 'string' || employeeId === '') {
    throw new HttpsError('invalid-argument', 'Falta el empleado.');
  }

  const empleadoRef = db.collection(COLLECTIONS.employees).doc(employeeId);
  const empleado = (await empleadoRef.get()).data();
  if (empleado === undefined) throw new HttpsError('not-found', 'Ese empleado no existe.');

  const organizationId = empleado.organization_id as string;
  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  if (empleado.status !== 'inactive') {
    throw new HttpsError('failed-precondition', 'Primero hay que desactivarlo.', {
      code: 'must_be_inactive',
    });
  }

  /*
   * TODO LO SUYO, cada consulta atada a SU organización además de a su id: si un id se
   * repitiera en otra empresa, esto no la tocaría.
   */
  /*
   * Y LO QUE SE AÑADIÓ DESPUÉS (auditoría, 4-oct): horas que debe, disponibilidad, lo que se
   * dijo de sus faltas y sus horas extra aprobadas. Se quedaban, y Reportes seguía contando
   * las horas debidas de alguien que ya no existe.
   */
  const [
    eventos,
    sesiones,
    turnos,
    descansosLibres,
    solicitudes,
    sedes,
    puestos,
    intervalos,
    debidas,
    disponibilidad,
    justificaciones,
    horasExtra,
    notasPrivadas,
    cuentas,
  ] = await Promise.all([
    porEmpleado(COLLECTIONS.timeEvents, organizationId, employeeId).get(),
    porEmpleado(COLLECTIONS.workSessions, organizationId, employeeId).get(),
    refsDe(porEmpleado(COLLECTIONS.shifts, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.restDays, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.timeEditRequests, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.employeeLocations, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.employeeJobRoles, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.breakIntervals, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.owedHours, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.availability, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.absenceResolutions, organizationId, employeeId)),
    refsDe(porEmpleado(COLLECTIONS.overtimeApprovals, organizationId, employeeId)),
    // Las notas privadas de sus turnos (4-oct): ver `src/features/schedules/notas-privadas.ts`.
    refsDe(porEmpleado(COLLECTIONS.shiftPrivateNotes, organizationId, employeeId)),
    // Su cuenta NO se borra —es de la persona—: se desliga de una ficha que ya no existe.
    refsDe(porEmpleado(COLLECTIONS.memberships, organizationId, employeeId)),
  ]);

  // Las correcciones cuelgan de la jornada o del fichaje que corrigieron, no del empleado.
  const idsDeSesion = sesiones.docs.map((d) => d.id);
  const idsDeEvento = eventos.docs.map((d) => d.id);
  const correcciones = [
    ...(await porLotes(idsDeSesion, async (trozo) =>
      refsDe(
        db
          .collection(COLLECTIONS.timeAdjustments)
          .where('organization_id', '==', organizationId)
          .where('work_session_id', 'in', trozo),
      ),
    )),
    ...(await porLotes(idsDeEvento, async (trozo) =>
      refsDe(
        db
          .collection(COLLECTIONS.timeAdjustments)
          .where('organization_id', '==', organizationId)
          .where('target_id', 'in', trozo),
      ),
    )),
  ];
  const correccionesUnicas = [...new Map(correcciones.map((r) => [r.path, r])).values()];

  const recuento: Recuento = {
    fichajes: eventos.size,
    jornadas: sesiones.size,
    turnos: turnos.length,
    descansosLibres: descansosLibres.length,
    solicitudes: solicitudes.length,
    correcciones: correccionesUnicas.length,
    otros:
      sedes.length +
      puestos.length +
      intervalos.length +
      debidas.length +
      disponibilidad.length +
      justificaciones.length +
      horasExtra.length +
      notasPrivadas.length,
  };

  if (dryRun) {
    return { nombre: String(empleado.full_name ?? ''), recuento };
  }

  const nombre = String(empleado.full_name ?? '').trim();
  if (confirmacion.trim().toLocaleLowerCase() !== nombre.toLocaleLowerCase()) {
    throw new HttpsError('failed-precondition', 'El nombre no coincide.', {
      code: 'name_mismatch',
    });
  }

  /*
   * LAS FOTOS DE SUS FICHAJES TAMBIÉN, que son su cara. `ignoreNotFound`: una foto que
   * nunca llegó a subirse o que ya caducó no es un fallo.
   */
  const bucket = getStorage().bucket();
  for (const evento of eventos.docs) {
    const ruta = evento.data().photo_path;
    if (typeof ruta === 'string' && ruta !== '') {
      await bucket.file(ruta).delete({ ignoreNotFound: true });
    }
  }

  const aBorrar: DocumentReference[] = [
    ...eventos.docs.map((d) => d.ref),
    ...sesiones.docs.map((d) => d.ref),
    ...turnos,
    ...descansosLibres,
    ...solicitudes,
    ...sedes,
    ...puestos,
    ...intervalos,
    ...debidas,
    ...disponibilidad,
    ...justificaciones,
    ...horasExtra,
    ...notasPrivadas,
    ...correccionesUnicas,
    db.collection(COLLECTIONS.pinCredentials).doc(employeeId),
    empleadoRef,
  ];
  const escritor = db.bulkWriter();
  for (const ref of aBorrar) void escritor.delete(ref);
  for (const cuenta of cuentas) void escritor.update(cuenta, { employee_id: null });
  await escritor.close();

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'employee.deleted',
    entityType: 'employee',
    entityId: employeeId,
    before: { full_name: nombre, employee_number: empleado.employee_number ?? null },
    after: recuento,
  });

  return { nombre, recuento };
});
