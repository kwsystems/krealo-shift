import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import {
  attendanceStateAt,
  filaDelEvento,
  rebuildWorkSession,
  reservarSecuencias,
  type TimeEventInput,
} from './shared/attendance';
import { audit, membershipOf, requireRole, requireUid } from './shared/caller';

/**
 * REGISTRAR COMO CUMPLIDO EL HORARIO DE ANTES DEL RELOJ.
 *
 * POR QUÉ EXISTE. Andree, el 30-sep: «quiero subir semana por semana los horarios que ya
 * puse antes, y haz como si todos hubieran cumplido su horario: a partir del 1 de
 * septiembre todos cumplieron, solo que la app no estaba creada aún». Sin esto, septiembre
 * sale en Horas y en Reportes como un mes en que nadie trabajó, el bono no se puede
 * calcular y el mes no cuadra con lo que se pagó.
 *
 * QUÉ HACE. Por cada turno PUBLICADO y ya terminado de los días elegidos, escribe los
 * fichajes que habría hecho quien lo cumplió: entrada a la hora del turno, el refrigerio
 * que el turno tiene planificado —centrado en la jornada— y salida a su hora. Luego arma
 * la sesión con el mismo código que usa el reloj (`rebuildWorkSession`), así que las
 * horas, las marcas y el bono salen de la misma cuenta que un día fichado.
 *
 * LO QUE NO HACE, y son los seguros, porque esto escribe horas que se pagan:
 *   1. SOLO ANTES DEL RELOJ. No toca ningún día desde el primero en que se fichó con el
 *      reloj en esa sede. Pasado ese día, un turno sin marcas es alguien que no vino o no
 *      marcó, y eso se corrige con «Agregar fichaje manual», con su motivo, persona por
 *      persona. Si esto sirviera también para esos días, marcar una falta como trabajada
 *      sería un clic.
 *   2. NO PISA NADA. Un turno con cualquier fichaje cerca —1 h antes o después— se salta,
 *      y lo mismo si la persona tenía una jornada abierta a esa hora. Los ids de los
 *      fichajes salen del turno, así que dos pulsaciones no duplican nada.
 *   3. SOLO LO PUBLICADO: un borrador no existe para el reloj, tampoco aquí.
 *   4. Solo dueño o administrador, y queda escrito: los fichajes llevan `source: 'import'`
 *      y quién los hizo, cada jornada una corrección con el motivo, y la llamada entera en
 *      la auditoría. En Horas salen como «Según horario», no como fichados.
 *
 * `p_simular` devuelve lo que haría sin escribir nada: la hoja lo enseña antes de pedir
 * la confirmación.
 */

/** Una semana normal son unos 30 turnos. Más de esto es un error de quien llama. */
const MAXIMO_DE_TURNOS = 150;

/**
 * Fichajes a esta distancia del turno cuentan como «ya tiene marcas». Una hora y no más: la
 * segunda mitad de un turno partido (10–13 y 15–19) empieza dos horas después de que acabe
 * la primera, y con un margen mayor se saltaría por la salida recién escrita de la otra.
 */
const MARGEN_MS = 60 * 60 * 1000;

const MOTIVO_DE_LA_CORRECCION =
  'Registrado como cumplido desde el horario publicado: jornada de antes de usar el reloj.';

export type Salto = 'sinPublicar' | 'noTermino' | 'conReloj' | 'yaTieneMarcas' | 'jornadaAbierta';

type Turno = {
  id: string;
  organization_id: string;
  location_id: string;
  employee_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  planned_unpaid_break_minutes: number;
};

/** El día del calendario de la sede en que cae un instante: «2026-09-01». */
export function diaLocal(instante: string, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instante));
}

/**
 * Dónde va el refrigerio de un turno que no se fichó: en el centro de la jornada, en
 * cuartos de hora. 10:00–19:00 con una hora da 14:00–15:00. No es un dato —nadie lo
 * marcó—, es la forma más neutra de que la jornada descuente lo que el turno planificó.
 */
export function refrigerioCentrado(
  startsAt: string,
  endsAt: string,
  minutos: number,
): { desde: string; hasta: string } | null {
  const inicio = Date.parse(startsAt);
  const total = Math.floor((Date.parse(endsAt) - inicio) / 60000);
  if (minutos <= 0 || minutos >= total) return null;
  const antes = Math.min(Math.round((total - minutos) / 2 / 15) * 15, total - minutos);
  const desde = inicio + antes * 60000;
  return {
    desde: new Date(desde).toISOString(),
    hasta: new Date(desde + minutos * 60000).toISOString(),
  };
}

/**
 * El primer día en que se fichó con el reloj en la sede, o `null` si nunca. Solo cuenta
 * el reloj: lo registrado desde el horario va antes y no puede mover esta fecha.
 */
async function primerDiaDelReloj(
  organizationId: string,
  locationId: string,
  zona: string,
): Promise<string | null> {
  const primero = await db
    .collection(COLLECTIONS.timeEvents)
    .where('organization_id', '==', organizationId)
    .where('location_id', '==', locationId)
    .where('source', '==', 'kiosk')
    .orderBy('occurred_at', 'asc')
    .limit(1)
    .get();
  const doc = primero.docs[0];
  return doc === undefined ? null : diaLocal(String(doc.data().occurred_at), zona);
}

async function tieneMarcasCerca(turno: Turno): Promise<boolean> {
  const cerca = await db
    .collection(COLLECTIONS.timeEvents)
    .where('employee_id', '==', turno.employee_id)
    .where('occurred_at', '>=', new Date(Date.parse(turno.starts_at) - MARGEN_MS).toISOString())
    .where('occurred_at', '<=', new Date(Date.parse(turno.ends_at) + MARGEN_MS).toISOString())
    .limit(1)
    .get();
  return !cerca.empty;
}

function esDiaValido(dia: unknown): dia is string {
  return typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia);
}

function minutosNetos(turno: Turno): number {
  const brutos = Math.floor((Date.parse(turno.ends_at) - Date.parse(turno.starts_at)) / 60000);
  return brutos - Math.max(0, turno.planned_unpaid_break_minutes);
}

export const registerScheduleAsWorked = onCall({ timeoutSeconds: 300 }, async (request) => {
  const uid = requireUid(request);
  const locationId = request.data?.p_location_id;
  const dias = request.data?.p_dias;
  const simular = request.data?.p_simular === true;

  if (typeof locationId !== 'string' || locationId === '') {
    throw new HttpsError('invalid-argument', 'Falta la sede.');
  }
  if (!Array.isArray(dias) || dias.length === 0 || dias.length > 7 || !dias.every(esDiaValido)) {
    throw new HttpsError('invalid-argument', 'Elige entre uno y siete días.');
  }

  const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  if (sede === undefined) throw new HttpsError('not-found', 'Esa sede no existe.');
  const organizationId = String(sede.organization_id);
  const zona = typeof sede.timezone === 'string' ? sede.timezone : 'America/Lima';

  const membership = await membershipOf(uid, organizationId);
  requireRole(membership, ['owner', 'admin']);

  const elegidos = new Set<string>(dias);
  const ordenados = [...elegidos].sort();
  const relojDesde = await primerDiaDelReloj(organizationId, locationId, zona);

  /*
   * Los turnos de la sede con un día de margen a cada lado: el día local no coincide con
   * el día UTC en que se guarda el instante, y un turno de las 20:00 en Lima empieza al
   * día siguiente en UTC.
   */
  const desde = new Date(Date.parse(`${ordenados[0]}T00:00:00Z`) - 86400000).toISOString();
  const hasta = new Date(
    Date.parse(`${ordenados[ordenados.length - 1]}T00:00:00Z`) + 2 * 86400000,
  ).toISOString();
  const snapshot = await db
    .collection(COLLECTIONS.shifts)
    .where('location_id', '==', locationId)
    .where('starts_at', '>=', desde)
    .where('starts_at', '<', hasta)
    .get();

  const turnos = snapshot.docs
    .map((doc) => ({ ...(doc.data() as Omit<Turno, 'id'>), id: doc.id }))
    .filter(
      (turno) =>
        turno.organization_id === organizationId &&
        turno.status !== 'cancelled' &&
        elegidos.has(diaLocal(turno.starts_at, zona)),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  if (turnos.length > MAXIMO_DE_TURNOS) {
    throw new HttpsError('invalid-argument', 'Demasiados turnos de una vez: ve semana por semana.');
  }

  const ahora = Date.now();
  const saltados: Record<Salto, number> = {
    sinPublicar: 0,
    noTermino: 0,
    conReloj: 0,
    yaTieneMarcas: 0,
    jornadaAbierta: 0,
  };
  const porDia: Record<string, { turnos: number; minutos: number }> = {};
  const aptos: Turno[] = [];

  for (const turno of turnos) {
    const dia = diaLocal(turno.starts_at, zona);
    let salto: Salto | null = null;
    if (turno.status !== 'published') salto = 'sinPublicar';
    else if (Date.parse(turno.ends_at) > ahora) salto = 'noTermino';
    else if (relojDesde !== null && dia >= relojDesde) salto = 'conReloj';
    else if (await tieneMarcasCerca(turno)) salto = 'yaTieneMarcas';
    else if ((await attendanceStateAt(turno.employee_id, turno.starts_at)) !== 'OFF_SHIFT') {
      salto = 'jornadaAbierta';
    }
    if (salto !== null) {
      saltados[salto] += 1;
      continue;
    }
    aptos.push(turno);
    const cuenta = porDia[dia] ?? { turnos: 0, minutos: 0 };
    cuenta.turnos += 1;
    cuenta.minutos += minutosNetos(turno);
    porDia[dia] = cuenta;
  }

  const minutosAptos = aptos.reduce((suma, turno) => suma + minutosNetos(turno), 0);
  if (simular) {
    return { relojDesde, porDia, saltados, turnos: aptos.length, minutos: minutosAptos };
  }

  let registrados = 0;
  let minutos = 0;
  for (const turno of aptos) {
    /*
     * SE VUELVE A MIRAR JUSTO ANTES DE ESCRIBIR: dos turnos de la misma persona que se
     * pisan —o alguien que fichó mientras tanto— se ven aquí, con los fichajes del
     * anterior ya escritos.
     */
    if (await tieneMarcasCerca(turno)) {
      saltados.yaTieneMarcas += 1;
      continue;
    }

    const refrigerio = refrigerioCentrado(
      turno.starts_at,
      turno.ends_at,
      turno.planned_unpaid_break_minutes,
    );
    const marcas: { tipo: TimeEventInput['eventType']; instante: string }[] = [
      { tipo: 'clock_in', instante: turno.starts_at },
      ...(refrigerio === null
        ? []
        : [
            { tipo: 'break_start' as const, instante: refrigerio.desde },
            { tipo: 'break_end' as const, instante: refrigerio.hasta },
          ]),
      { tipo: 'clock_out', instante: turno.ends_at },
    ];

    const primera = await reservarSecuencias(marcas.length);
    const lote = db.batch();
    marcas.forEach((marca, i) => {
      const clave = `horario_${turno.id}_${marca.tipo}`;
      const id = `${organizationId}_${clave}`;
      lote.create(
        db.collection(COLLECTIONS.timeEvents).doc(id),
        filaDelEvento(
          {
            organizationId,
            employeeId: turno.employee_id,
            locationId,
            shiftId: turno.id,
            eventType: marca.tipo,
            breakType: marca.tipo.startsWith('break') ? 'unpaid' : null,
            breakReason: marca.tipo === 'break_start' ? 'meal' : null,
            occurredAt: marca.instante,
            idempotencyKey: clave,
            source: 'import',
            createdBy: uid,
            timezone: zona,
          },
          id,
          primera + i,
          { origen: 'horario' },
        ),
      );
    });
    try {
      // Los cuatro o ninguno: una entrada sin su salida sería una jornada abierta de semanas.
      await lote.commit();
    } catch (error) {
      if ((error as { code?: unknown }).code === 6) {
        saltados.yaTieneMarcas += 1; // ALREADY_EXISTS: otra pulsación llegó antes.
        continue;
      }
      throw error;
    }

    await rebuildWorkSession(organizationId, turno.employee_id, locationId, {
      desde: turno.starts_at,
      hasta: turno.ends_at,
    });
    const sesionId = `${turno.employee_id}_${turno.starts_at}`;
    await db.collection(COLLECTIONS.timeAdjustments).add({
      organization_id: organizationId,
      work_session_id: sesionId,
      target_type: 'work_session',
      target_id: sesionId,
      before_value: null,
      after_value: { starts_at: turno.starts_at, ends_at: turno.ends_at, origen: 'horario' },
      reason: MOTIVO_DE_LA_CORRECCION,
      created_by: uid,
      created_at: nowISO(),
      channel: 'manager_app',
    });
    registrados += 1;
    minutos += minutosNetos(turno);
  }

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'schedule_registered_as_worked',
    entityType: 'location',
    entityId: locationId,
    after: { dias: ordenados, registrados, minutos, saltados },
  });

  return { relojDesde, registrados, minutos, saltados };
});
