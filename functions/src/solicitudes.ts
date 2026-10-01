import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  TIME_EVENT_TYPES,
  type AttendanceState,
  type TimeEventType,
} from '../../src/domain/attendance-state-machine';
import { DEFAULT_PAID_REASONS } from '../../src/domain/break-reason';
import { diaLocal } from './horario-cumplido';
import { ajustarSesion } from './manager';
import { COLLECTIONS, db, nowISO } from './shared/admin';
import { filaDelEvento, rebuildWorkSession, reservarSecuencias } from './shared/attendance';
import { audit, membershipOf, requireManagesLocation, requireUid } from './shared/caller';
import { politicasDe } from './shared/politicas';
import { enOrden, recorrer } from './shared/secuencia';
import { zonaSegura } from './shared/zonas';
import { noEnElFuturo } from './shared/salida-a-mano';

/**
 * RESOLVER UNA SOLICITUD DE LA BANDEJA (30-sep).
 *
 * POR QUÉ EXISTE. Andree: «apruebo un request de que alguien se olvidó de marcar y no
 * sale nada, no se borra». Tenía razón las dos veces, y por dos fallos distintos:
 *
 *  1. LA APROBACIÓN NO SE GUARDABA. Las reglas dicen, con razón, que una solicitud se
 *     resuelve «por función, para que quede auditado» (`allow update: if false`), y esa
 *     función no existía: el panel escribía directo, Firestore lo rechazaba y la pantalla
 *     no enseñaba el error. La solicitud seguía pendiente y el botón parecía muerto.
 *  2. Y AUNQUE SE HUBIERA GUARDADO, NO HABRÍA HECHO NADA. Una solicitud de «olvidé marcar»
 *     no tiene sesión que ajustar —se escribe justo porque falta el fichaje—, así que
 *     aprobarla solo cambiaba su estado: la entrada que faltaba seguía faltando en Horas.
 *
 * QUÉ HACE AHORA. Aprobar un «olvidé marcar» REGISTRA LOS FICHAJES QUE FALTABAN, con la
 * fecha y la hora que confirma quien aprueba, y en la misma transacción marca la
 * solicitud: o pasan las dos cosas o ninguna, y no queda una aprobación que nadie aplicó
 * ni un fichaje sin la solicitud que lo explica. Luego recalcula esa jornada.
 *
 * LOS FICHAJES SON NUEVOS, nunca una edición: `source: 'manager'`, con autor, y la
 * solicitud en `metadata` y en `time_adjustments`. Es la misma regla de siempre —el evento
 * crudo es la prueba de lo que pasó— y la que hace que esto valga ante una inspección.
 *
 * LO QUE SE NIEGA, con un motivo que la pantalla traduce:
 *  - `NO_ENCAJA`: a esa hora la persona ya estaba en otro estado (una entrada estando
 *    dentro, un descanso estando fuera);
 *  - `CHOCA`: los fichajes nuevos dejarían fuera un descanso o una salida que sí marcó;
 *  - `FALTA_SALIDA`: una entrada de otro día sin salida dejaría la jornada abierta para
 *    siempre, o fundiría dos jornadas en una.
 */

const TIPOS_POR_SOLICITUD: Record<string, readonly (readonly TimeEventType[])[]> = {
  forgot_clock_in: [['clock_in'], ['clock_in', 'clock_out']],
  forgot_clock_out: [['clock_out']],
  // «Olvidé iniciar o terminar descanso»: el descanso entero, o solo el final de uno que
  // sí empezó a marcar.
  forgot_break: [['break_start', 'break_end'], ['break_end']],
};

/** Once horas de fábrica: el mismo `minimumRestMinutes` que usa reclasificar una salida. */
const DESCANSO_MINIMO_POR_DEFECTO = 660;

/** Lo que se tolera por delante del reloj del servidor: dos relojes nunca coinciden. */
const MARGEN_FUTURO_MS = 2 * 60 * 1000;

export type FichajeNuevo = { id: string; tipo: TimeEventType; occurred_at: string };

export type Plan =
  | {
      ok: true;
      /** Instante de la entrada de la jornada que queda: ahí empieza la sesión. */
      entrada: string;
      /** La entrada de la jornada SIGUIENTE, si la hay: hasta ahí se recalcula. */
      siguienteEntrada: string | null;
      /** Fichajes que dejan de contar porque los nuevos los sustituyen. */
      reemplazados: string[];
      /** De esos, las entradas: su sesión desaparece, fundida en la de `entrada`. */
      entradasReemplazadas: string[];
    }
  | { ok: false; motivo: 'NO_ENCAJA'; tipo: TimeEventType; estado: AttendanceState }
  | { ok: false; motivo: 'CHOCA' | 'FALTA_SALIDA' };

/**
 * Qué pasa con la jornada si se añaden `nuevos` a los fichajes de la persona. SIN
 * FIRESTORE DELANTE para poder probar cada caso: es donde se decide qué horas se pagan.
 *
 * Un fichaje existente puede DEJAR DE CONTAR, y es justo lo que se pide cuando uno nuevo
 * del mismo tipo, justo antes, ocupa su lugar: la persona lo marcó, pero tarde.
 *  - la entrada de las 11:00 de quien olvidó la de las 08:00. Solo si entre las dos hay
 *    menos que el descanso mínimo entre turnos; con más serían dos jornadas, y la de
 *    antes necesita su salida;
 *  - la salida de la mañana siguiente de quien olvidó la de anoche y tuvo que marcarla
 *    para poder volver a entrar;
 *  - el «terminar descanso» de las 17:00 de quien volvió a las 14:00 y no lo marcó.
 * Un fichaje que deja de contar SIN uno nuevo del mismo tipo delante es un choque —un
 * descanso que sí marcó y que los nuevos pisan—, y no se hace.
 */
export function planDeLaAprobacion(params: {
  existentes: readonly Record<string, unknown>[];
  nuevos: readonly FichajeNuevo[];
  descansoMinimoMinutos: number;
  /** Si una entrada nueva puede quedar sin salida: solo si es de hoy, alguien que sigue dentro. */
  puedeQuedarAbierta: boolean;
}): Plan {
  // Los nuevos van detrás de cualquier existente del mismo milisegundo, en su orden.
  const marcados = params.nuevos.map((nuevo, i) => ({
    id: nuevo.id,
    event_type: nuevo.tipo,
    occurred_at: nuevo.occurred_at,
    seq: Number.MAX_SAFE_INTEGER - params.nuevos.length + i,
    nuevo: true,
  }));

  const contabanAntes = new Set(
    recorrer(enOrden(params.existentes))
      .filter((paso) => paso.cuenta)
      .map((paso) => String(paso.evento.id)),
  );
  const despues = recorrer(enOrden<Record<string, unknown>>([...params.existentes, ...marcados]));

  for (const paso of despues) {
    if (paso.evento.nuevo === true && !paso.cuenta) {
      return { ok: false, motivo: 'NO_ENCAJA', tipo: paso.tipo, estado: paso.antes };
    }
  }

  const reemplazados: string[] = [];
  const entradasReemplazadas: string[] = [];
  for (const [i, paso] of despues.entries()) {
    const id = String(paso.evento.id);
    if (paso.evento.nuevo === true || paso.cuenta || !contabanAntes.has(id)) continue;

    const nuevoAnterior = despues
      .slice(0, i)
      .reverse()
      .find((previo) => previo.evento.nuevo === true && previo.tipo === paso.tipo);

    if (paso.tipo === 'clock_in') {
      const minutos =
        nuevoAnterior === undefined
          ? Infinity
          : (Date.parse(String(paso.evento.occurred_at)) -
              Date.parse(String(nuevoAnterior.evento.occurred_at))) /
            60000;
      if (minutos >= params.descansoMinimoMinutos) return { ok: false, motivo: 'FALTA_SALIDA' };
      entradasReemplazadas.push(id);
    } else if (nuevoAnterior === undefined) {
      return { ok: false, motivo: 'CHOCA' };
    }
    reemplazados.push(id);
  }

  // La jornada es la de la última entrada que cuenta antes del primer fichaje nuevo.
  const cuentan = despues.filter((paso) => paso.cuenta);
  const primerNuevo = cuentan.findIndex((paso) => paso.evento.nuevo === true);
  let desde = primerNuevo;
  while (desde >= 0 && cuentan[desde]?.tipo !== 'clock_in') desde -= 1;
  const entrada = cuentan[desde];
  // No debería pasar —un fichaje que cuenta sale siempre de una entrada—, pero si pasa
  // no se escribe nada.
  if (entrada === undefined) return { ok: false, motivo: 'CHOCA' };

  const resto = cuentan.slice(desde + 1);
  const siguiente = resto.findIndex((paso) => paso.tipo === 'clock_in');
  const deLaJornada = siguiente === -1 ? resto : resto.slice(0, siguiente);
  const cerrada = deLaJornada.some((paso) => paso.tipo === 'clock_out');

  if (!cerrada && entrada.evento.nuevo === true && !params.puedeQuedarAbierta) {
    return { ok: false, motivo: 'FALTA_SALIDA' };
  }

  return {
    ok: true,
    entrada: String(entrada.evento.occurred_at),
    siguienteEntrada: siguiente === -1 ? null : String(resto[siguiente]?.evento.occurred_at),
    reemplazados,
    entradasReemplazadas,
  };
}

/** Los fichajes que manda el panel, comprobados: tipos de la solicitud, en orden, sin futuro. */
function fichajesPedidos(kind: string, valor: unknown, requestId: string, org: string) {
  const permitidos = TIPOS_POR_SOLICITUD[kind];
  if (permitidos === undefined || !Array.isArray(valor)) {
    throw new HttpsError('invalid-argument', 'Faltan los fichajes que se registran.', {
      motivo: 'FICHAJES',
    });
  }

  const fichajes = valor.map((crudo, i) => {
    const fila = (crudo ?? {}) as Record<string, unknown>;
    const tipo = String(fila.type ?? '') as TimeEventType;
    const instante = new Date(String(fila.occurred_at ?? ''));
    if (!TIME_EVENT_TYPES.includes(tipo) || Number.isNaN(instante.getTime())) {
      throw new HttpsError('invalid-argument', 'Un fichaje no tiene tipo u hora válidos.', {
        motivo: 'FICHAJES',
      });
    }
    return {
      // Determinista: repetir la aprobación choca con el mismo documento y no duplica.
      id: `${org}_solicitud_${requestId}_${i}`,
      tipo,
      occurred_at: instante.toISOString(),
    };
  });

  const tipos = fichajes.map((fichaje) => fichaje.tipo).join(',');
  if (!permitidos.some((combinacion) => combinacion.join(',') === tipos)) {
    throw new HttpsError('invalid-argument', 'Esos fichajes no son los de esta solicitud.', {
      motivo: 'FICHAJES',
    });
  }
  for (let i = 1; i < fichajes.length; i += 1) {
    if (fichajes[i]!.occurred_at <= fichajes[i - 1]!.occurred_at) {
      throw new HttpsError('invalid-argument', 'El final va antes que el comienzo.', {
        motivo: 'ORDEN',
      });
    }
  }
  const limite = Date.now() + MARGEN_FUTURO_MS;
  if (fichajes.some((fichaje) => Date.parse(fichaje.occurred_at) > limite)) {
    throw new HttpsError('invalid-argument', 'No se registra un fichaje en el futuro.', {
      motivo: 'FUTURO',
    });
  }
  return fichajes;
}

const MENSAJES: Record<'NO_ENCAJA' | 'CHOCA' | 'FALTA_SALIDA', string> = {
  NO_ENCAJA: 'A esa hora la persona ya estaba en otro estado: ese fichaje no cabe.',
  CHOCA: 'Esos fichajes chocan con otros que la persona sí marcó ese día.',
  FALTA_SALIDA: 'Esa jornada no tiene salida: indica también a qué hora salió.',
};

export const reviewTimeEditRequest = onCall({ timeoutSeconds: 120 }, async (request) => {
  const uid = requireUid(request);
  const requestId = String(request.data?.p_request_id ?? '').trim();
  const decision = String(request.data?.p_decision ?? '');
  const comentarioCrudo = request.data?.p_comment;
  const comentario =
    typeof comentarioCrudo === 'string' && comentarioCrudo.trim() !== ''
      ? comentarioCrudo.trim()
      : null;

  if (requestId === '') throw new HttpsError('invalid-argument', 'Falta «p_request_id».');
  if (!['approved', 'rejected', 'comment'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'La decisión es aprobar, rechazar o comentar.');
  }

  const requestRef = db.collection(COLLECTIONS.timeEditRequests).doc(requestId);
  const solicitud = (await requestRef.get()).data();
  if (solicitud === undefined) throw new HttpsError('not-found', 'Esa solicitud no existe.');

  const organizationId = String(solicitud.organization_id);
  const locationId = String(solicitud.location_id);
  const employeeId = String(solicitud.employee_id);
  requireManagesLocation(await membershipOf(uid, organizationId), locationId);

  // Comentar no decide: sirve para pedir contexto, también en una ya resuelta.
  if (decision === 'comment') {
    await requestRef.update({ reviewer_comment: comentario, updated_at: nowISO() });
    return { status: String(solicitud.status), applied: false, eventIds: [] as string[] };
  }

  const yaResuelta = () =>
    new HttpsError('failed-precondition', 'Esa solicitud ya se resolvió.', {
      motivo: 'YA_RESUELTA',
    });
  if (solicitud.status !== 'pending') throw yaResuelta();

  const resolucion = {
    status: decision,
    reviewed_by: uid,
    reviewed_at: nowISO(),
    // Decidir sin escribir nada no borra lo que se preguntó antes con «Comentar».
    reviewer_comment: comentario ?? (solicitud.reviewer_comment as string | null) ?? null,
    updated_at: nowISO(),
  };
  const motivo = `Solicitud aprobada: ${String(solicitud.reason ?? '')}${
    comentario === null ? '' : ` — ${comentario}`
  }`;

  // ------------------------------------------------------------- rechazar
  if (decision === 'rejected') {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(requestRef)).data()?.status !== 'pending') throw yaResuelta();
      tx.update(requestRef, resolucion);
    });
    await audit({
      organizationId,
      actorUserId: uid,
      action: 'time_edit_request_rejected',
      entityType: 'time_edit_request',
      entityId: requestId,
    });
    return { status: 'rejected', applied: false, eventIds: [] as string[] };
  }

  const kind = String(solicitud.kind);

  // ------------------------------------------- aprobar sin fichajes nuevos
  if (TIPOS_POR_SOLICITUD[kind] === undefined) {
    /*
     * UNA CORRECCIÓN sobre una sesión concreta con horas propuestas se aplica como el
     * ajuste de siempre, antes de marcarla: si el ajuste falla, sigue pendiente. Sin
     * sesión —o un turno sin programar— la decisión queda y la pantalla dice que el
     * cambio se hace en Horas: no se inventa uno.
     */
    const propuesta = (solicitud.proposed_value ?? {}) as Record<string, unknown>;
    const inicio = (propuesta.startsAt ?? propuesta.proposedAt ?? null) as string | null;
    const fin = (propuesta.endsAt ?? null) as string | null;
    const sesionId =
      typeof solicitud.work_session_id === 'string' ? solicitud.work_session_id : null;
    const aplica = kind === 'correction' && sesionId !== null && (inicio !== null || fin !== null);
    if (aplica) {
      await ajustarSesion(uid, {
        workSessionId: sesionId,
        reason: motivo,
        newStartsAt: inicio,
        newEndsAt: fin,
        requestId,
      });
    }
    await db.runTransaction(async (tx) => {
      if ((await tx.get(requestRef)).data()?.status !== 'pending') throw yaResuelta();
      tx.update(requestRef, resolucion);
    });
    await audit({
      organizationId,
      actorUserId: uid,
      action: 'time_edit_request_approved',
      entityType: 'time_edit_request',
      entityId: requestId,
    });
    return { status: 'approved', applied: aplica, eventIds: [] as string[] };
  }

  // ------------------------------------ aprobar un «olvidé marcar»: registrarlo
  const nuevos = fichajesPedidos(kind, request.data?.p_events, requestId, organizationId);
  // Un fichaje que falta es de antes, nunca de una hora que no llegó (1-oct).
  for (const nuevo of nuevos) noEnElFuturo(nuevo.occurred_at, 'fichaje');

  const location = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data() ?? {};
  const zona = zonaSegura(location.timezone ?? 'America/Lima', 'reviewTimeEditRequest');
  const ajustes = (location.settings ?? {}) as Record<string, unknown>;
  const descansoMinimo = Number(ajustes.minimumRestMinutes ?? DESCANSO_MINIMO_POR_DEFECTO);

  /*
   * TODOS LOS FICHAJES DE LA PERSONA, sin ventana. Es lo mismo que ya lee
   * `attendanceStateAt` en cada marca del reloj, y es lo único que da el estado exacto:
   * con una ventana, una jornada abierta desde antes de ella haría que la salida que
   * falta pareciera no caber.
   */
  const existentes = (
    await db.collection(COLLECTIONS.timeEvents).where('employee_id', '==', employeeId).get()
  ).docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const primera = nuevos[0]!;
  const plan = planDeLaAprobacion({
    existentes,
    nuevos,
    descansoMinimoMinutos: Number.isFinite(descansoMinimo) ? descansoMinimo : 660,
    puedeQuedarAbierta:
      primera.tipo !== 'clock_in' ||
      diaLocal(primera.occurred_at, zona) === diaLocal(nowISO(), zona),
  });
  if (!plan.ok) {
    throw new HttpsError('failed-precondition', MENSAJES[plan.motivo], {
      motivo: plan.motivo,
      ...(plan.motivo === 'NO_ENCAJA' ? { tipo: plan.tipo, estado: plan.estado } : {}),
    });
  }

  /*
   * EL DESCANSO QUE NO SE MARCÓ ES DE COMER, y si cuenta como trabajado lo decide la sede,
   * no quien aprueba: la misma regla que en el reloj y al reclasificar una salida.
   */
  const pagados = politicasDe(location).paidBreakReasons;
  const comidaPagada =
    (pagados.meal ?? (DEFAULT_PAID_REASONS as Record<string, boolean>).meal ?? false) === true;

  const sesionId = `${employeeId}_${plan.entrada}`;
  /*
   * LA ENTRADA NUEVA HEREDA EL TURNO de la que sustituye: esa sí la marcó la persona en el
   * reloj, eligiendo su turno. Sin esto la jornada perdería con qué compararse y dejaría
   * de poder decir si llegó tarde.
   */
  const turnoHeredado =
    (
      existentes.find((evento) => evento.id === plan.entradasReemplazadas[0]) as
        Record<string, unknown> | undefined
    )?.shift_id ?? null;
  const primeraSecuencia = await reservarSecuencias(nuevos.length);

  await db.runTransaction(async (tx) => {
    if ((await tx.get(requestRef)).data()?.status !== 'pending') throw yaResuelta();

    nuevos.forEach((nuevo, i) => {
      tx.create(
        db.collection(COLLECTIONS.timeEvents).doc(nuevo.id),
        filaDelEvento(
          {
            organizationId,
            employeeId,
            locationId,
            eventType: nuevo.tipo,
            shiftId:
              nuevo.tipo === 'clock_in' && typeof turnoHeredado === 'string' ? turnoHeredado : null,
            breakType: nuevo.tipo === 'break_start' ? (comidaPagada ? 'paid' : 'unpaid') : null,
            breakReason: nuevo.tipo === 'break_start' ? 'meal' : null,
            occurredAt: nuevo.occurred_at,
            idempotencyKey: `solicitud_${requestId}_${i}`,
            source: 'manager',
            createdBy: uid,
            timezone: zona,
          },
          nuevo.id,
          primeraSecuencia + i,
          { origen: 'solicitud', request_id: requestId },
        ),
      );
      tx.create(db.collection(COLLECTIONS.timeAdjustments).doc(), {
        organization_id: organizationId,
        location_id: locationId,
        employee_id: employeeId,
        work_session_id: sesionId,
        target_type: 'time_event',
        target_id: nuevo.id,
        before_value: null,
        after_value: { event_type: nuevo.tipo, occurred_at: nuevo.occurred_at },
        reason: motivo,
        created_by: uid,
        created_at: nowISO(),
        channel: 'manager_app',
        request_id: requestId,
      });
    });

    tx.update(requestRef, {
      ...resolucion,
      // La solicitud queda atada a su jornada, que al crearse no existía.
      work_session_id: sesionId,
      applied_event_ids: nuevos.map((nuevo) => nuevo.id),
    });
  });

  // La sesión de una entrada sustituida desaparece: su jornada ahora empieza antes.
  for (const eventoId of plan.entradasReemplazadas) {
    const sesiones = await db
      .collection(COLLECTIONS.workSessions)
      .where('clock_in_event_id', '==', eventoId)
      .get();
    await Promise.all(sesiones.docs.map((doc) => doc.ref.delete()));
  }

  await rebuildWorkSession(organizationId, employeeId, locationId, {
    desde: plan.entrada,
    hasta:
      plan.siguienteEntrada === null
        ? '9999-12-31T23:59:59.999Z'
        : new Date(Date.parse(plan.siguienteEntrada) - 1).toISOString(),
  });

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'time_edit_request_approved',
    entityType: 'time_edit_request',
    entityId: requestId,
    after: { event_ids: nuevos.map((nuevo) => nuevo.id), replaced: plan.reemplazados },
  });

  return {
    status: 'approved',
    applied: true,
    eventIds: nuevos.map((nuevo) => nuevo.id),
    workSessionId: sesionId,
  };
});
