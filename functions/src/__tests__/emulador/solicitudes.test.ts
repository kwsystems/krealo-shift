import { propuestaDelReloj } from '../../kiosk-api';
import { resolveSessionCase } from '../../casos';
import { managerAdjustTime } from '../../manager';
import { reviewTimeEditRequest } from '../../solicitudes';
import { COLLECTIONS, db } from '../../shared/admin';
import { rebuildWorkSession } from '../../shared/attendance';

/**
 * Resolver una solicitud de la Bandeja (30-sep).
 *
 * Aprobar no se guardaba —las reglas no dejan tocar una solicitud desde la app y la
 * función no existía— y, aunque se hubiera guardado, un «olvidé marcar» no registraba
 * nada. Cada prueba es uno de los casos que pasan en la tienda: quien no marcó al llegar y
 * marcó tarde, quien olvidó la salida y la marcó a la mañana siguiente, quien comió sin
 * marcar o volvió sin marcar. Y los que no se deben aprobar: los que no caben, los que
 * pisan fichajes reales, los que dejarían una jornada abierta para siempre.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-solicitudes';
const SEDE = 'sede-solicitudes';
const OTRA_SEDE = 'sede-solicitudes-2';
const GERENTE = 'uid-gerente-solicitudes';
const AJENO = 'uid-gerente-otra-sede';
const PERSONA = 'emp-solicitudes';

// Lima es UTC-5. Un lunes pasado: las 08:00 de allí son las 13:00Z.
const L = (hora: string) => {
  const [h, m] = hora.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 8, 21, h + 5, m)).toISOString();
};
// El martes siguiente.
const M = (hora: string) => {
  const [h, m] = hora.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 8, 22, h + 5, m)).toISOString();
};

type Datos = Record<string, unknown>;

const llamar = (data: Datos, uid = GERENTE): Promise<Datos> =>
  (reviewTimeEditRequest as unknown as { run: (r: unknown) => Promise<Datos> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function fallo(promesa: Promise<unknown>): Promise<{ code: string; motivo?: string }> {
  try {
    await promesa;
    return { code: '(no fallo)' };
  } catch (error) {
    const e = error as { code?: string; details?: { motivo?: string } };
    return { code: e.code ?? String(error), motivo: e.details?.motivo };
  }
}

let seq = 0;
async function fichaje(id: string, tipo: string, instante: string, extra: Datos = {}) {
  seq += 1;
  await db
    .collection(COLLECTIONS.timeEvents)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      employee_id: PERSONA,
      location_id: SEDE,
      event_type: tipo,
      break_type: tipo === 'break_start' ? 'unpaid' : null,
      source: 'kiosk',
      occurred_at: instante,
      seq,
      shift_id: null,
      ...extra,
    });
}

/** Deja las sesiones como las habría dejado el reloj al marcar. */
const proyectar = (desde: string, hasta: string) =>
  rebuildWorkSession(ORG, PERSONA, SEDE, { desde, hasta });

async function solicitud(id: string, kind: string, extra: Datos = {}) {
  await db
    .collection(COLLECTIONS.timeEditRequests)
    .doc(id)
    .set({
      organization_id: ORG,
      employee_id: PERSONA,
      location_id: SEDE,
      work_session_id: null,
      target_date: '2026-09-21',
      kind,
      proposed_value: {},
      reason: 'Se me olvidó marcar',
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      reviewer_comment: null,
      created_at: M('09:00'),
      updated_at: M('09:00'),
      ...extra,
    });
}

const aprobar = (requestId: string, events: { type: string; occurred_at: string }[]) =>
  llamar({ p_request_id: requestId, p_decision: 'approved', p_comment: null, p_events: events });

const leer = async (id: string) =>
  (await db.collection(COLLECTIONS.timeEditRequests).doc(id).get()).data() ?? {};

const sesiones = async () =>
  (await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()).docs
    .map((doc) => doc.data())
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

const eventosNuevos = async () =>
  (await db.collection(COLLECTIONS.timeEvents).where('source', '==', 'manager').get()).docs.map(
    (doc) => doc.data(),
  );

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  seq = 0;

  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima', settings: {} });
  for (const [uid, sede] of [
    [GERENTE, SEDE],
    [AJENO, OTRA_SEDE],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({
        organization_id: ORG,
        user_id: uid,
        role: 'manager',
        status: 'active',
        managed_location_ids: [sede],
      });
  }
});

describe('aprobar un «olvidé marcar la entrada»', () => {
  it('sin ninguna marca ese día: registra entrada y salida, y la jornada sale en Horas', async () => {
    await solicitud('s1', 'forgot_clock_in', { proposed_value: { proposedAt: L('08:00') } });

    const r = await aprobar('s1', [
      { type: 'clock_in', occurred_at: L('08:00') },
      { type: 'clock_out', occurred_at: L('17:00') },
    ]);

    expect(r).toMatchObject({ status: 'approved', applied: true });
    const [sesion, ...otras] = await sesiones();
    expect(otras).toHaveLength(0);
    expect(sesion).toMatchObject({
      starts_at: L('08:00'),
      ends_at: L('17:00'),
      net_minutes: 540,
      status: 'complete',
      source: 'manager',
    });

    const nuevos = await eventosNuevos();
    expect(nuevos.map((e) => e.event_type).sort()).toEqual(['clock_in', 'clock_out']);
    expect(nuevos[0]).toMatchObject({
      created_by: GERENTE,
      metadata: { origen: 'solicitud', request_id: 's1' },
    });

    const guardada = await leer('s1');
    expect(guardada).toMatchObject({
      status: 'approved',
      reviewed_by: GERENTE,
      work_session_id: sesion?.id,
    });
    expect(guardada.applied_event_ids).toHaveLength(2);

    // La corrección queda con autor y motivo, atada a la jornada.
    const ajustes = (await db.collection(COLLECTIONS.timeAdjustments).get()).docs.map((d) =>
      d.data(),
    );
    expect(ajustes).toHaveLength(2);
    expect(ajustes[0]).toMatchObject({ created_by: GERENTE, work_session_id: sesion?.id });
    expect(String(ajustes[0]?.reason)).toContain('Se me olvidó marcar');
  });

  it('marcó tarde, a las 11:00: la jornada pasa a empezar a las 08:00 y no queda duplicada', async () => {
    // El turno que eligió al marcar tarde existe y está publicado: es el que hereda.
    await db
      .collection(COLLECTIONS.shifts)
      .doc('turno-lunes')
      .set({
        organization_id: ORG,
        location_id: SEDE,
        employee_id: PERSONA,
        starts_at: L('08:00'),
        ends_at: L('17:00'),
        status: 'published',
      });
    await fichaje('k-in', 'clock_in', L('11:00'), { shift_id: 'turno-lunes' });
    await fichaje('k-out', 'clock_out', L('17:00'));
    await proyectar(L('00:00'), M('00:00'));
    expect(await sesiones()).toHaveLength(1);

    await solicitud('s2', 'forgot_clock_in');
    await aprobar('s2', [{ type: 'clock_in', occurred_at: L('08:00') }]);

    const todas = await sesiones();
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({
      starts_at: L('08:00'),
      ends_at: L('17:00'),
      net_minutes: 540,
      // Hereda el turno que la persona eligió al marcar tarde.
      shift_id: 'turno-lunes',
    });
  });

  it('otro día y sin salida: no se aprueba, porque la jornada quedaría abierta para siempre', async () => {
    await solicitud('s3', 'forgot_clock_in');

    const f = await fallo(aprobar('s3', [{ type: 'clock_in', occurred_at: L('08:00') }]));

    expect(f).toEqual({ code: 'failed-precondition', motivo: 'FALTA_SALIDA' });
    expect((await leer('s3')).status).toBe('pending');
    expect(await eventosNuevos()).toHaveLength(0);
  });

  it('una entrada cuando ya estaba dentro no cabe, y lo dice', async () => {
    await fichaje('k-in', 'clock_in', L('10:00'));
    await fichaje('k-out', 'clock_out', L('19:00'));
    await solicitud('s4', 'forgot_clock_in');

    const f = await fallo(aprobar('s4', [{ type: 'clock_in', occurred_at: L('12:00') }]));

    expect(f).toEqual({ code: 'failed-precondition', motivo: 'NO_ENCAJA' });
    expect((await leer('s4')).status).toBe('pending');
  });

  it('una salida que pisa un descanso que sí marcó es un choque', async () => {
    await fichaje('k-in', 'clock_in', L('10:00'));
    await fichaje('k-bs', 'break_start', L('13:00'));
    await fichaje('k-be', 'break_end', L('14:00'));
    await fichaje('k-out', 'clock_out', L('19:00'));
    await solicitud('s5', 'forgot_clock_in');

    const f = await fallo(
      aprobar('s5', [
        { type: 'clock_in', occurred_at: L('08:00') },
        { type: 'clock_out', occurred_at: L('12:00') },
      ]),
    );

    expect(f).toEqual({ code: 'failed-precondition', motivo: 'CHOCA' });
    expect(await eventosNuevos()).toHaveLength(0);
  });
});

describe('aprobar un «olvidé marcar la salida»', () => {
  it('la marcó a la mañana siguiente para poder entrar: la de anoche la sustituye', async () => {
    await fichaje('k-in', 'clock_in', L('10:00'));
    await fichaje('k-out-tarde', 'clock_out', M('09:58'));
    await proyectar(L('00:00'), M('09:59'));
    await fichaje('k-in-2', 'clock_in', M('10:00'));
    await proyectar(M('10:00'), M('23:00'));

    await solicitud('s6', 'forgot_clock_out');
    await aprobar('s6', [{ type: 'clock_out', occurred_at: L('19:00') }]);

    const [lunes, martes, ...otras] = await sesiones();
    expect(otras).toHaveLength(0);
    expect(lunes).toMatchObject({
      starts_at: L('10:00'),
      ends_at: L('19:00'),
      net_minutes: 540,
      status: 'complete',
    });
    // La jornada de hoy no se toca.
    expect(martes).toMatchObject({ starts_at: M('10:00'), status: 'open' });
  });
});

describe('aprobar un «olvidé iniciar o terminar descanso»', () => {
  it('comió sin marcar: el descanso entero se descuenta de la jornada', async () => {
    await fichaje('k-in', 'clock_in', L('10:00'));
    await fichaje('k-out', 'clock_out', L('19:00'));
    await proyectar(L('00:00'), M('00:00'));

    await solicitud('s7', 'forgot_break');
    await aprobar('s7', [
      { type: 'break_start', occurred_at: L('13:00') },
      { type: 'break_end', occurred_at: L('14:00') },
    ]);

    const [sesion] = await sesiones();
    // Comer no cuenta como trabajado salvo que la sede diga otra cosa.
    expect(sesion).toMatchObject({ unpaid_break_minutes: 60, net_minutes: 480 });
    const inicio = (await eventosNuevos()).find((e) => e.event_type === 'break_start');
    expect(inicio).toMatchObject({ break_reason: 'meal', break_type: 'unpaid' });
  });

  it('volvió a las 14:00 sin marcar y marcó «terminar» a las 17:00: vale la de las 14:00', async () => {
    await fichaje('k-in', 'clock_in', L('10:00'));
    await fichaje('k-bs', 'break_start', L('13:00'));
    await fichaje('k-be', 'break_end', L('17:00'));
    await fichaje('k-out', 'clock_out', L('19:00'));
    await proyectar(L('00:00'), M('00:00'));
    expect((await sesiones())[0]?.unpaid_break_minutes).toBe(240);

    await solicitud('s8', 'forgot_break');
    await aprobar('s8', [{ type: 'break_end', occurred_at: L('14:00') }]);

    expect((await sesiones())[0]).toMatchObject({ unpaid_break_minutes: 60, net_minutes: 480 });
  });

  it('un descanso cuando no había entrada no cabe', async () => {
    await solicitud('s9', 'forgot_break');
    const f = await fallo(
      aprobar('s9', [
        { type: 'break_start', occurred_at: L('13:00') },
        { type: 'break_end', occurred_at: L('14:00') },
      ]),
    );
    expect(f).toEqual({ code: 'failed-precondition', motivo: 'NO_ENCAJA' });
  });
});

describe('lo que protege la decisión', () => {
  it('rechazar la cierra sin tocar las horas', async () => {
    await solicitud('s10', 'forgot_clock_in');
    const r = await llamar({ p_request_id: 's10', p_decision: 'rejected', p_comment: 'No vino' });
    expect(r).toMatchObject({ status: 'rejected', applied: false });
    expect(await leer('s10')).toMatchObject({ status: 'rejected', reviewer_comment: 'No vino' });
    expect(await eventosNuevos()).toHaveLength(0);
  });

  it('la segunda aprobación no duplica: ya está resuelta', async () => {
    await solicitud('s11', 'forgot_clock_in');
    const fichajes = [
      { type: 'clock_in', occurred_at: L('08:00') },
      { type: 'clock_out', occurred_at: L('17:00') },
    ];
    await aprobar('s11', fichajes);
    const f = await fallo(aprobar('s11', fichajes));
    expect(f).toEqual({ code: 'failed-precondition', motivo: 'YA_RESUELTA' });
    expect(await eventosNuevos()).toHaveLength(2);
  });

  it('quien no gestiona esa sede no puede resolverla', async () => {
    await solicitud('s12', 'forgot_clock_in');
    const f = await fallo(
      llamar({ p_request_id: 's12', p_decision: 'rejected', p_comment: null }, AJENO),
    );
    expect(f.code).toBe('permission-denied');
    expect((await leer('s12')).status).toBe('pending');
  });

  it('comentar no decide', async () => {
    await solicitud('s13', 'forgot_clock_out');
    await llamar({ p_request_id: 's13', p_decision: 'comment', p_comment: '¿A qué hora saliste?' });
    expect(await leer('s13')).toMatchObject({
      status: 'pending',
      reviewer_comment: '¿A qué hora saliste?',
    });

    // Decidir después sin escribir nada no borra la pregunta.
    await llamar({ p_request_id: 's13', p_decision: 'rejected', p_comment: null });
    expect(await leer('s13')).toMatchObject({
      status: 'rejected',
      reviewer_comment: '¿A qué hora saliste?',
    });
  });

  it('los fichajes tienen que ser los de la solicitud, en orden y del pasado', async () => {
    await solicitud('s14', 'forgot_clock_out');
    expect(await fallo(aprobar('s14', [{ type: 'clock_in', occurred_at: L('08:00') }]))).toEqual({
      code: 'invalid-argument',
      motivo: 'FICHAJES',
    });

    await solicitud('s15', 'forgot_break');
    expect(
      await fallo(
        aprobar('s15', [
          { type: 'break_start', occurred_at: L('14:00') },
          { type: 'break_end', occurred_at: L('13:00') },
        ]),
      ),
    ).toEqual({ code: 'invalid-argument', motivo: 'ORDEN' });

    await solicitud('s16', 'forgot_clock_out');
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(await fallo(aprobar('s16', [{ type: 'clock_out', occurred_at: manana }]))).toEqual({
      code: 'invalid-argument',
      motivo: 'FUTURO',
    });
  });

  it('una corrección sin sesión se aprueba sin inventar un cambio', async () => {
    await solicitud('s17', 'correction', { proposed_value: { startsAt: L('09:00') } });
    const r = await llamar({ p_request_id: 's17', p_decision: 'approved', p_comment: null });
    expect(r).toMatchObject({ status: 'approved', applied: false });
    expect((await leer('s17')).status).toBe('approved');
  });
});

describe('la hora que teclea la persona en el reloj', () => {
  // Martes 22 a las 09:00 de Lima.
  const ahora = Date.parse(M('09:00'));

  it('«08:30» es de hoy, porque ya pasó', () => {
    expect(propuestaDelReloj('08:30', 'America/Lima', ahora)).toBe(M('08:30'));
  });

  it('«19:00» es de AYER: hoy todavía no llegó, y lo que se olvida ya pasó', () => {
    expect(propuestaDelReloj('19:00', 'America/Lima', ahora)).toBe(L('19:00'));
  });

  it('acepta «8.30» y un instante completo; rechaza lo que no es hora', () => {
    expect(propuestaDelReloj('8.30', 'America/Lima', ahora)).toBe(M('08:30'));
    expect(propuestaDelReloj(L('10:00'), 'America/Lima', ahora)).toBe(L('10:00'));
    expect(propuestaDelReloj('', 'America/Lima', ahora)).toBeNull();
    expect(() => propuestaDelReloj('25:00', 'America/Lima', ahora)).toThrow();
    expect(() => propuestaDelReloj('mañana', 'America/Lima', ahora)).toThrow();
  });
});

describe('con la jornada abierta de otro día (auditoría, 4-oct)', () => {
  // Entró el sábado 19 a las 10:00 de Lima; se acuerda el martes 22 a las 09:00.
  const entrada = '2026-09-19T15:00:00.000Z';
  const ahora = Date.parse(M('09:00'));

  it('«19:00» es el sábado de su jornada, no el lunes', () => {
    expect(propuestaDelReloj('19:00', 'America/Lima', ahora, entrada)).toBe(
      '2026-09-20T00:00:00.000Z',
    );
  });

  it('un reloj con la versión de antes manda «ayer a esa hora»: se pone en su jornada', () => {
    // El reloj viejo manda el lunes 21 a las 19:00: una jornada de 57 h.
    expect(propuestaDelReloj(L('19:00'), 'America/Lima', ahora, entrada)).toBe(
      '2026-09-20T00:00:00.000Z',
    );
  });

  it('un instante que ya cae en su jornada se respeta', () => {
    expect(propuestaDelReloj('2026-09-19T23:30:00.000Z', 'America/Lima', ahora, entrada)).toBe(
      '2026-09-19T23:30:00.000Z',
    );
  });
});

/*
 * LO DECIDIDO SOBRE LA JORNADA SOBREVIVE A UNA ENTRADA ANTERIOR (8-oct). Marcó 11:00–19:00,
 * se corrigió la salida a las 18:00 y se apuntó «le debe 3 h»; luego se aprueba que entró a
 * las 08:00. La jornada de las 11:00 desaparece y con ella se iban la corrección (volvía a
 * las 19:00), el caso resuelto y la deuda.
 */
describe('una entrada anterior funde la jornada', () => {
  it('la que queda hereda la salida corregida, los casos y el «le debe»', async () => {
    const correr = (fn: unknown, data: Datos) =>
      (fn as { run: (r: unknown) => Promise<unknown> }).run({
        data,
        auth: { uid: GERENTE, token: {} },
        rawRequest: {},
      });
    await fichaje('e-11', 'clock_in', L('11:00'));
    await fichaje('s-19', 'clock_out', L('19:00'));
    await proyectar(L('00:00'), L('23:59'));
    const [antes] = await sesiones();
    await correr(managerAdjustTime, {
      p_work_session_id: antes!.id,
      p_new_starts_at: null,
      p_new_ends_at: L('18:00'),
      p_reason: 'Se fue a las 18:00',
    });
    await correr(resolveSessionCase, {
      p_work_session_id: antes!.id,
      p_case: 'faltan_horas',
      p_decision: 'owes',
      p_minutes: 180,
    });

    await solicitud('sol-entrada', 'forgot_clock_in');
    await aprobar('sol-entrada', [{ type: 'clock_in', occurred_at: L('08:00') }]);

    const despues = await sesiones();
    expect(despues).toHaveLength(1);
    expect(despues[0]).toMatchObject({
      starts_at: L('08:00'),
      ends_at: L('18:00'),
      casos_resueltos: ['faltan_horas'],
    });
    const deudas = (
      await db.collection(COLLECTIONS.owedHours).where('employee_id', '==', PERSONA).get()
    ).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    expect(deudas).toEqual([
      expect.objectContaining({
        id: despues[0]!.id,
        work_session_id: despues[0]!.id,
        minutes: 180,
      }),
    ]);
  });
});
