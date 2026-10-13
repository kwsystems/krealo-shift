import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { filaDelEvento, rebuildJornadaDe, reservarSecuencias } from './shared/attendance';
import { audit, membershipOf, requireManagesLocation, requireUid } from './shared/caller';
import { zonaSegura } from './shared/zonas';
import { refrigerioCentrado } from './horario-cumplido';

/**
 * LOS CASOS DE HORAS QUE HAY QUE RESOLVER, a un toque (Andree, 1-oct).
 *
 * Una vendedora se enfermó y se fue a media mañana: «lo que debería salir acá es que yo
 * vea que ella me debe horas… y a ella debería aparecerle en su apartado». Otra no marcó
 * su refrigerio y Horas le contaba la hora de comer como trabajada. «Debería haber algo
 * donde se vean todos estos casos y yo poder arreglarlos rápidamente.»
 *
 * Horas los detecta (`src/features/timesheets/casos.ts`) y aquí se resuelven:
 *
 *   - TRABAJÓ MENOS QUE SU TURNO —salió antes o llegó tarde—: «le debe N h», que queda en
 *     `owed_hours` y la persona ve en su celular, o «está justificado».
 *   - NO MARCÓ EL REFRIGERIO: se descuenta el del turno, con dos fichajes de pausa a nombre
 *     de quien gestiona; o «trabajó sin refrigerio», y no se toca nada.
 *
 * Lo resuelto se apunta en la jornada (`casos_resueltos`), por caso. Reconstruir la jornada
 * no lo borra: `rebuildWorkSession` escribe con `merge`.
 *
 * TODO VA POR EL SERVIDOR: las reglas no dejan escribir jornadas, fichajes ni horas debidas
 * desde la app, porque son horas que se pagan o se cobran.
 */

// `salida_automatica` (5-oct): la jornada que se cerró sola; «la salida está bien».
// `salida_dudosa` (8-oct): una jornada de verdad larga —inventario, cierre de noche— se
// quedaba en Por resolver para siempre: solo se iba poniendo una salida falsa.
const CASOS = ['faltan_horas', 'sin_refrigerio', 'salida_automatica', 'salida_dudosa'] as const;
type Caso = (typeof CASOS)[number];

const DECISIONES: Record<Caso, readonly string[]> = {
  faltan_horas: ['owes', 'justified'],
  sin_refrigerio: ['worked_through'],
  salida_automatica: ['confirmed'],
  salida_dudosa: ['confirmed'],
};

/** Más de una jornada entera no puede deberse por un solo día. */
const MINUTOS_MAXIMOS_DEBIDOS = 16 * 60;

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new HttpsError('invalid-argument', `Falta «${campo}».`);
  }
  return valor.trim();
}

function diaEn(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

async function jornadaGestionable(uid: string, sessionId: string) {
  const ref = db.collection(COLLECTIONS.workSessions).doc(sessionId);
  const sesion = (await ref.get()).data();
  if (sesion === undefined) throw new HttpsError('not-found', 'Esa jornada no existe.');
  const organizationId = String(sesion.organization_id);
  const locationId = String(sesion.location_id);
  requireManagesLocation(await membershipOf(uid, organizationId), locationId);
  return { ref, sesion, organizationId, locationId };
}

/**
 * Resolver un caso de una jornada: «le debe N h», «está justificado» o «trabajó sin
 * refrigerio».
 */
export const resolveSessionCase = onCall(async (request) => {
  const uid = requireUid(request);
  const sessionId = texto(request.data?.p_work_session_id, 'p_work_session_id');
  const caso = texto(request.data?.p_case, 'p_case') as Caso;
  const decision = texto(request.data?.p_decision, 'p_decision');
  if (!CASOS.includes(caso)) throw new HttpsError('invalid-argument', 'Ese caso no existe.');
  if (!DECISIONES[caso].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Esa decisión no vale para ese caso.');
  }
  const nota =
    typeof request.data?.p_note === 'string' && request.data.p_note.trim() !== ''
      ? String(request.data.p_note).trim().slice(0, 300)
      : null;

  const { ref, sesion, organizationId, locationId } = await jornadaGestionable(uid, sessionId);
  if (sesion.ends_at === null || sesion.ends_at === undefined) {
    throw new HttpsError(
      'failed-precondition',
      'La jornada sigue abierta: primero tiene que tener su salida.',
      { motivo: 'ABIERTA' },
    );
  }

  const ahora = nowISO();
  const lote = db.batch();
  let minutos: number | null = null;

  if (decision === 'owes') {
    minutos = Number(request.data?.p_minutes);
    if (!Number.isInteger(minutos) || minutos < 1 || minutos > MINUTOS_MAXIMOS_DEBIDOS) {
      throw new HttpsError(
        'invalid-argument',
        'Las horas que debe tienen que estar entre 1 min y 16 h.',
        {
          motivo: 'MINUTOS',
        },
      );
    }
    const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
    const zona = zonaSegura(sede?.timezone, 'resolveSessionCase');
    // Una por jornada: volver a registrarla la corrige, no suma otra.
    lote.set(db.collection(COLLECTIONS.owedHours).doc(sessionId), {
      id: sessionId,
      organization_id: organizationId,
      location_id: locationId,
      employee_id: sesion.employee_id,
      work_session_id: sessionId,
      work_date: diaEn(String(sesion.starts_at), zona),
      minutes: minutos,
      note: nota,
      status: 'pending',
      created_by: uid,
      created_at: ahora,
      updated_at: ahora,
    });
  }

  lote.update(ref, {
    casos_resueltos: FieldValue.arrayUnion(caso),
    [`casos_decision.${caso}`]: { decision, por: uid, at: ahora, nota },
    updated_at: ahora,
  });
  await lote.commit();

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'session_case_resolved',
    entityType: 'work_session',
    entityId: sessionId,
    after: { caso, decision, minutos },
  });
  return { caso, decision, minutos };
});

/**
 * «Descontar el refrigerio del turno»: quien no marcó su refrigerio tiene la jornada entera
 * como trabajada. Se añaden la salida y la vuelta de la pausa —la del turno, en el centro
 * de la jornada, como al registrar el horario como cumplido— a nombre de quien gestiona, y
 * la jornada se vuelve a calcular. Los fichajes de la persona no se tocan.
 */
export const applyPlannedBreak = onCall(async (request) => {
  const uid = requireUid(request);
  const sessionId = texto(request.data?.p_work_session_id, 'p_work_session_id');
  const { sesion, organizationId, locationId } = await jornadaGestionable(uid, sessionId);

  const desde = String(sesion.starts_at);
  const hasta =
    sesion.ends_at === null || sesion.ends_at === undefined ? null : String(sesion.ends_at);
  if (hasta === null) {
    throw new HttpsError('failed-precondition', 'La jornada sigue abierta.', { motivo: 'ABIERTA' });
  }
  if (Number(sesion.paid_break_minutes ?? 0) + Number(sesion.unpaid_break_minutes ?? 0) > 0) {
    throw new HttpsError('failed-precondition', 'Esa jornada ya tiene una pausa marcada.', {
      motivo: 'YA_TIENE_PAUSA',
    });
  }
  const turno =
    typeof sesion.shift_id === 'string'
      ? (await db.collection(COLLECTIONS.shifts).doc(sesion.shift_id).get()).data()
      : undefined;
  const minutos = Number(turno?.planned_unpaid_break_minutes ?? 0);
  if (turno === undefined || minutos <= 0) {
    throw new HttpsError('failed-precondition', 'Su turno no tiene refrigerio que descontar.', {
      motivo: 'SIN_REFRIGERIO',
    });
  }
  /*
   * TAMBIÉN SOBRE UNA HORA CORREGIDA EN HORAS (8-oct). Aquí se rechazaba —«añade la pausa con
   * Agregar fichaje manual»— porque volver a calcular la jornada borraba la corrección. Eso
   * dejó de pasar el 4-oct (`correccionesDeLaJornada`: lo corregido se conserva al
   * reconstruir), y el rechazo se quedó: Andree corrigió la jornada de una vendedora, pulsó
   * «Descontar 1 h de refrigerio» y el caso no se iba. La pausa se pone dentro de lo que
   * marcó la persona, para que sus fichajes la encierren y la reconstrucción la cuente.
   */
  const fichaje = async (id: unknown) =>
    typeof id === 'string'
      ? ((await db.collection(COLLECTIONS.timeEvents).doc(id).get()).data()?.occurred_at as
          string | undefined)
      : undefined;
  const entroSegunFichaje = (await fichaje(sesion.clock_in_event_id)) ?? desde;
  const salioSegunFichaje = (await fichaje(sesion.clock_out_event_id)) ?? hasta;
  const pausa = refrigerioCentrado(
    Date.parse(desde) > Date.parse(entroSegunFichaje) ? desde : entroSegunFichaje,
    Date.parse(hasta) < Date.parse(salioSegunFichaje) ? hasta : salioSegunFichaje,
    minutos,
  );
  if (pausa === null) {
    throw new HttpsError('failed-precondition', 'La jornada es más corta que su refrigerio.', {
      motivo: 'CORTA',
    });
  }

  const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
  const zona = zonaSegura(sede?.timezone, 'applyPlannedBreak');
  const marcas = [
    { tipo: 'break_start' as const, instante: pausa.desde },
    { tipo: 'break_end' as const, instante: pausa.hasta },
  ];
  const primera = await reservarSecuencias(marcas.length);
  const lote = db.batch();
  const ahora = nowISO();
  const motivo = 'No marcó su refrigerio: se descuenta el de su turno.';
  marcas.forEach((marca, i) => {
    const clave = `refrigerio_${sessionId}_${marca.tipo}`;
    const id = `${organizationId}_${clave}`;
    lote.create(
      db.collection(COLLECTIONS.timeEvents).doc(id),
      filaDelEvento(
        {
          organizationId,
          employeeId: String(sesion.employee_id),
          locationId,
          shiftId: String(sesion.shift_id),
          eventType: marca.tipo,
          breakType: 'unpaid',
          breakReason: marca.tipo === 'break_start' ? 'meal' : null,
          occurredAt: marca.instante,
          idempotencyKey: clave,
          source: 'manager',
          createdBy: uid,
          timezone: zona,
        },
        id,
        primera + i,
        { origen: 'refrigerio_del_turno', work_session_id: sessionId },
      ),
    );
    lote.set(db.collection(COLLECTIONS.timeAdjustments).doc(`ajuste_${id}`), {
      organization_id: organizationId,
      location_id: locationId,
      employee_id: sesion.employee_id,
      work_session_id: null,
      target_type: 'time_event',
      target_id: id,
      before_value: null,
      after_value: { event_type: marca.tipo, occurred_at: marca.instante },
      reason: motivo,
      created_by: uid,
      created_at: ahora,
      channel: 'manager_app',
    });
  });
  try {
    // Las dos o ninguna: una pausa sin vuelta dejaría a la persona «en descanso» para siempre.
    await lote.commit();
  } catch (error) {
    // ALREADY_EXISTS: la pausa del turno ya se puso una vez.
    if ((error as { code?: unknown }).code !== 6) throw error;
    /*
     * Y SI YA NO CUENTA, SE MUEVE (8-oct): puesta antes de que se corrigiera la salida, puede
     * caer fuera de la jornada —la vuelta después de la salida— y no descontar nada. Aquí se
     * respondía «hecho» sin hacer nada y el caso no se iba. Esta jornada no tiene pausa (se
     * comprobó arriba), así que esas dos marcas, que son nuestras, van a su sitio.
     */
    const mover = db.batch();
    marcas.forEach((marca) => {
      const id = `${organizationId}_refrigerio_${sessionId}_${marca.tipo}`;
      mover.update(db.collection(COLLECTIONS.timeEvents).doc(id), {
        occurred_at: marca.instante,
      });
    });
    await mover.commit();
  }

  // Desde la entrada FICHADA: con una entrada corregida más temprana, la reconstrucción
  // tomaba la entrada de verdad por «la siguiente jornada» y no rehacía esta.
  await rebuildJornadaDe(organizationId, String(sesion.employee_id), locationId, entroSegunFichaje);
  /*
   * Y QUEDA DICHO EN LA JORNADA (13-oct), como las demás decisiones: así la hoja de la jornada
   * enseña «se descontó su refrigerio» con su «Cambiar» (`reopenSessionDecision`).
   */
  await db
    .collection(COLLECTIONS.workSessions)
    .doc(sessionId)
    .update({
      [`casos_decision.${REFRIGERIO_DEL_TURNO}`]: {
        decision: 'applied',
        por: uid,
        at: nowISO(),
        nota: null,
        minutos,
      },
    })
    .catch(() => undefined);
  await audit({
    organizationId,
    actorUserId: uid,
    action: 'planned_break_applied',
    entityType: 'work_session',
    entityId: sessionId,
    after: { desde: pausa.desde, hasta: pausa.hasta, minutos },
  });
  return { desde: pausa.desde, hasta: pausa.hasta, minutos };
});

/** La decisión de «Descontar el refrigerio del turno», que no es un caso sino dos fichajes. */
const REFRIGERIO_DEL_TURNO = 'refrigerio_del_turno';
const TIPOS_DE_PAUSA = ['break_start', 'break_end'] as const;

/**
 * CAMBIAR UNA DECISIÓN YA TOMADA (13-oct). Andree pulsó «No es extra» en la jornada de una
 * vendedora que había trabajado de corrido: «me equivoqué… necesito que haya opción para
 * poder arreglar estas cosas». No la había: ni el refrigerio descontado ni los casos
 * resueltos tenían vuelta atrás.
 *
 * Esto deja el día COMO ESTABA ANTES de decidir, y el caso vuelve a «Por resolver» para
 * decidirlo bien:
 *
 *   - `refrigerio_del_turno`: se borran los dos fichajes de pausa que puso quien gestiona
 *     (solo esos: los de la persona no se tocan), sus correcciones, y la extra de ese día si
 *     quedó en 0 —el «no es extra» que la acompañó—. La jornada se vuelve a calcular.
 *   - un caso (`faltan_horas`, `sin_refrigerio`, `salida_automatica`, `salida_dudosa`): sale
 *     de los resueltos. Si era «le debe N h» y sigue pendiente, esa deuda se borra; si ya se
 *     compensó o perdonó, no: primero se devuelve a pendiente en «Horas que debe».
 *
 * Lo que pasó queda en la auditoría.
 */
export const reopenSessionDecision = onCall(async (request) => {
  const uid = requireUid(request);
  const sessionId = texto(request.data?.p_work_session_id, 'p_work_session_id');
  const que = texto(request.data?.p_decision, 'p_decision');
  if (que !== REFRIGERIO_DEL_TURNO && !(CASOS as readonly string[]).includes(que)) {
    throw new HttpsError('invalid-argument', 'Esa decisión no existe.');
  }
  const { ref, sesion, organizationId, locationId } = await jornadaGestionable(uid, sessionId);
  const decisiones = (sesion.casos_decision ?? {}) as Record<string, unknown>;
  const resueltos = Array.isArray(sesion.casos_resueltos)
    ? (sesion.casos_resueltos as unknown[])
    : [];
  const ahora = nowISO();
  const lote = db.batch();
  let extraBorrada = false;

  if (que === REFRIGERIO_DEL_TURNO) {
    const pausas = await Promise.all(
      TIPOS_DE_PAUSA.map((tipo) =>
        db
          .collection(COLLECTIONS.timeEvents)
          .doc(`${organizationId}_refrigerio_${sessionId}_${tipo}`)
          .get(),
      ),
    );
    const puestas = pausas.filter((doc) => doc.exists);
    if (puestas.length === 0 && decisiones[REFRIGERIO_DEL_TURNO] === undefined) {
      throw new HttpsError('failed-precondition', 'En esa jornada no se descontó el refrigerio.', {
        motivo: 'NO_DECIDIDO',
      });
    }
    for (const doc of puestas) {
      lote.delete(doc.ref);
      lote.delete(db.collection(COLLECTIONS.timeAdjustments).doc(`ajuste_${doc.id}`));
    }
    const sede = (await db.collection(COLLECTIONS.locations).doc(locationId).get()).data();
    const zona = zonaSegura(sede?.timezone, 'reopenSessionDecision');
    const extra = db
      .collection(COLLECTIONS.overtimeApprovals)
      .doc(`${locationId}_${String(sesion.employee_id)}_${diaEn(String(sesion.starts_at), zona)}`);
    const extraDelDia = (await extra.get()).data();
    if (extraDelDia !== undefined && Number(extraDelDia.minutes) === 0) {
      lote.delete(extra);
      extraBorrada = true;
    }
  } else {
    if (!resueltos.includes(que) && decisiones[que] === undefined) {
      throw new HttpsError('failed-precondition', 'Ese caso no estaba decidido.', {
        motivo: 'NO_DECIDIDO',
      });
    }
    if (que === 'faltan_horas') {
      const deuda = db.collection(COLLECTIONS.owedHours).doc(sessionId);
      const fila = (await deuda.get()).data();
      if (fila !== undefined) {
        if (fila.status !== 'pending') {
          throw new HttpsError(
            'failed-precondition',
            'Esas horas ya se dieron por compensadas o perdonadas: primero devuélvelas a pendientes en «Horas que debe».',
            { motivo: 'YA_SALDADA' },
          );
        }
        lote.delete(deuda);
      }
    }
  }

  lote.update(ref, {
    casos_resueltos: FieldValue.arrayRemove(que),
    [`casos_decision.${que}`]: FieldValue.delete(),
    updated_at: ahora,
  });
  await lote.commit();

  if (que === REFRIGERIO_DEL_TURNO) {
    const entrada =
      typeof sesion.clock_in_event_id === 'string'
        ? ((await db.collection(COLLECTIONS.timeEvents).doc(sesion.clock_in_event_id).get()).data()
            ?.occurred_at as string | undefined)
        : undefined;
    await rebuildJornadaDe(
      organizationId,
      String(sesion.employee_id),
      locationId,
      entrada ?? String(sesion.starts_at),
    );
  }

  await audit({
    organizationId,
    actorUserId: uid,
    action: 'session_decision_reopened',
    entityType: 'work_session',
    entityId: sessionId,
    before: {
      decision: que,
      detalle: decisiones[que] ?? null,
      extra_en_cero_borrada: extraBorrada,
    },
  });
  return { decision: que, extraBorrada };
});

/** Las horas que debía, compensadas o perdonadas; o de vuelta a pendientes. */
export const settleOwedHours = onCall(async (request) => {
  const uid = requireUid(request);
  const id = texto(request.data?.p_owed_id, 'p_owed_id');
  const estado = texto(request.data?.p_status, 'p_status');
  if (!['pending', 'compensated', 'forgiven'].includes(estado)) {
    throw new HttpsError('invalid-argument', 'Ese estado no existe.');
  }
  const ref = db.collection(COLLECTIONS.owedHours).doc(id);
  const fila = (await ref.get()).data();
  if (fila === undefined) throw new HttpsError('not-found', 'Esas horas no existen.');
  requireManagesLocation(
    await membershipOf(uid, String(fila.organization_id)),
    String(fila.location_id),
  );
  await ref.update({
    status: estado,
    settled_by: estado === 'pending' ? null : uid,
    settled_at: estado === 'pending' ? null : nowISO(),
    updated_at: nowISO(),
  });
  await audit({
    organizationId: String(fila.organization_id),
    actorUserId: uid,
    action: 'owed_hours_settled',
    entityType: 'owed_hours',
    entityId: id,
    after: { status: estado },
  });
  return { status: estado };
});
