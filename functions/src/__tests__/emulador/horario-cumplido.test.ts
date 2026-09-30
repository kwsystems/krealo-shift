import { refrigerioCentrado, registerScheduleAsWorked } from '../../horario-cumplido';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Registrar como cumplido el horario de antes del reloj (30-sep).
 *
 * Esto escribe horas que se pagan sin que nadie haya fichado, así que cada prueba es una
 * forma de que escriba donde no debe: un día en que ya se usaba el reloj, un turno que ya
 * tenía marcas, un borrador, un turno que no terminó, la segunda pulsación, alguien que no
 * es administrador. Y la primera, que lo que escribe cuadre: las horas de un turno de 9 h
 * con una de refrigerio son 8, igual que si se hubiera fichado.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-cumplido';
const SEDE = 'sede-cumplido';
const DUENO = 'uid-dueno-cumplido';
const GERENTE = 'uid-gerente-cumplido';
const PERSONA = 'emp-cumplido';
const OTRA = 'emp-cumplido-2';

// Lima es UTC-5: las 10:00 de allí son las 15:00Z.
const LUNES = '2026-09-07';
const MARTES = '2026-09-08';

const llamar = (data: Record<string, unknown>, uid = DUENO): Promise<Record<string, unknown>> =>
  (
    registerScheduleAsWorked as unknown as {
      run: (r: unknown) => Promise<Record<string, unknown>>;
    }
  ).run({
    data: { p_location_id: SEDE, ...data },
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

async function turno(
  id: string,
  desde: string,
  hasta: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await db
    .collection(COLLECTIONS.shifts)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: desde,
      ends_at: hasta,
      timezone: 'America/Lima',
      status: 'published',
      planned_unpaid_break_minutes: 60,
      ...extra,
    });
}

async function fichajeDelReloj(instante: string, empleado = OTRA): Promise<void> {
  await db.collection(COLLECTIONS.timeEvents).doc(`reloj-${instante}`).set({
    organization_id: ORG,
    location_id: SEDE,
    employee_id: empleado,
    event_type: 'clock_in',
    source: 'kiosk',
    occurred_at: instante,
    seq: 1,
  });
}

const eventos = async (empleado = PERSONA) =>
  (await db.collection(COLLECTIONS.timeEvents).where('employee_id', '==', empleado).get()).docs
    .map((d) => d.data())
    .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));

const sesiones = async () =>
  (await db.collection(COLLECTIONS.workSessions).get()).docs.map((d) => d.data());

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db.collection(COLLECTIONS.locations).doc(SEDE).set({
    id: SEDE,
    organization_id: ORG,
    timezone: 'America/Lima',
    late_grace_minutes: 5,
  });
  for (const [uid, rol] of [
    [DUENO, 'owner'],
    [GERENTE, 'manager'],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({
        organization_id: ORG,
        user_id: uid,
        role: rol,
        status: 'active',
        managed_location_ids: [SEDE],
      });
  }
});

describe('registrar como cumplido', () => {
  it('escribe entrada, refrigerio y salida, y la jornada cuenta 8 h de un turno de 9', async () => {
    // 10:00 a 19:00 en Lima.
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');

    const r = await llamar({ p_dias: [LUNES] });
    expect(r).toMatchObject({ registrados: 1, minutos: 480 });

    const marcas = await eventos();
    expect(marcas.map((m) => [m.event_type, m.occurred_at])).toEqual([
      ['clock_in', `${LUNES}T15:00:00.000Z`],
      ['break_start', `${LUNES}T19:00:00.000Z`], // 14:00 en Lima: el centro de la jornada
      ['break_end', `${LUNES}T20:00:00.000Z`],
      ['clock_out', '2026-09-08T00:00:00.000Z'],
    ]);
    for (const marca of marcas) {
      expect(marca).toMatchObject({ source: 'import', created_by: DUENO, shift_id: 't-lunes' });
    }

    const [sesion] = await sesiones();
    expect(sesion).toMatchObject({
      employee_id: PERSONA,
      shift_id: 't-lunes',
      status: 'complete',
      gross_minutes: 540,
      unpaid_break_minutes: 60,
      net_minutes: 480,
      flags: [],
      source: 'import',
    });

    const correcciones = (await db.collection(COLLECTIONS.timeAdjustments).get()).docs.map((d) =>
      d.data(),
    );
    expect(correcciones).toEqual([
      expect.objectContaining({ work_session_id: sesion?.id, created_by: DUENO }),
    ]);
    const auditoria = (await db.collection(COLLECTIONS.auditLogs).get()).docs.map((d) => d.data());
    expect(auditoria).toEqual([
      expect.objectContaining({ action: 'schedule_registered_as_worked', actor_user_id: DUENO }),
    ]);
  });

  it('un turno corto sin refrigerio planificado: solo entrada y salida', async () => {
    await turno('t-corto', `${LUNES}T22:00:00.000Z`, '2026-09-08T02:00:00.000Z', {
      planned_unpaid_break_minutes: 0,
    });
    expect(await llamar({ p_dias: [LUNES] })).toMatchObject({ registrados: 1, minutos: 240 });
    expect((await eventos()).map((m) => m.event_type)).toEqual(['clock_in', 'clock_out']);
    expect((await sesiones())[0]).toMatchObject({ net_minutes: 240, unpaid_break_minutes: 0 });
  });

  it('un turno partido registra sus dos mitades', async () => {
    // 10:00–13:00 y 15:00–19:00 en Lima: la segunda empieza 2 h después de la primera.
    await turno('t-manana', `${LUNES}T15:00:00.000Z`, `${LUNES}T18:00:00.000Z`, {
      planned_unpaid_break_minutes: 0,
    });
    await turno('t-tarde', `${LUNES}T20:00:00.000Z`, '2026-09-08T00:00:00.000Z', {
      planned_unpaid_break_minutes: 0,
    });
    expect(await llamar({ p_dias: [LUNES] })).toMatchObject({ registrados: 2, minutos: 420 });
    expect((await sesiones()).map((s) => s.shift_id).sort()).toEqual(['t-manana', 't-tarde']);
  });

  it('simular dice cuánto haría por día y no escribe nada', async () => {
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');
    await turno('t-martes', `${MARTES}T15:00:00.000Z`, '2026-09-09T00:00:00.000Z');

    const r = await llamar({ p_dias: [LUNES, MARTES], p_simular: true });
    expect(r).toMatchObject({
      turnos: 2,
      minutos: 960,
      porDia: { [LUNES]: { turnos: 1, minutos: 480 }, [MARTES]: { turnos: 1, minutos: 480 } },
    });
    expect(await eventos()).toEqual([]);
    expect(await sesiones()).toEqual([]);
  });

  it('solo los días elegidos', async () => {
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');
    await turno('t-martes', `${MARTES}T15:00:00.000Z`, '2026-09-09T00:00:00.000Z');
    expect(await llamar({ p_dias: [MARTES] })).toMatchObject({ registrados: 1 });
    expect((await sesiones()).map((s) => s.shift_id)).toEqual(['t-martes']);
  });

  it('no toca ningún día desde que se usa el reloj en la sede', async () => {
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');
    await turno('t-martes', `${MARTES}T15:00:00.000Z`, '2026-09-09T00:00:00.000Z');
    // Otra persona fichó con el reloj el martes a las 9:00 de Lima.
    await fichajeDelReloj(`${MARTES}T14:00:00.000Z`);

    const r = await llamar({ p_dias: [LUNES, MARTES] });
    expect(r).toMatchObject({
      relojDesde: MARTES,
      registrados: 1,
      saltados: { conReloj: 1 },
    });
    expect((await sesiones()).map((s) => s.shift_id)).toEqual(['t-lunes']);
  });

  it('un turno que ya tiene marcas no se toca', async () => {
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');
    await fichajeDelReloj(`${LUNES}T15:20:00.000Z`, PERSONA);
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc(`reloj-${LUNES}T15:20:00.000Z`)
      .update({ source: 'manager' });

    const r = await llamar({ p_dias: [LUNES] });
    expect(r).toMatchObject({ registrados: 0, saltados: { yaTieneMarcas: 1 } });
    expect(await eventos()).toHaveLength(1);
  });

  it('ni borradores ni turnos que aún no terminan', async () => {
    await turno('t-borrador', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z', {
      status: 'draft',
    });
    const manana = new Date(Date.now() + 86400000);
    const dia = manana.toISOString().slice(0, 10);
    await turno('t-futuro', `${dia}T15:00:00.000Z`, `${dia}T23:00:00.000Z`);

    const r = await llamar({ p_dias: [LUNES, dia] });
    expect(r).toMatchObject({
      registrados: 0,
      saltados: { sinPublicar: 1, noTermino: 1 },
    });
    expect(await sesiones()).toEqual([]);
  });

  it('la segunda pulsación no duplica nada', async () => {
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');
    await llamar({ p_dias: [LUNES] });
    const otra = await llamar({ p_dias: [LUNES] });
    expect(otra).toMatchObject({ registrados: 0, saltados: { yaTieneMarcas: 1 } });
    expect(await eventos()).toHaveLength(4);
    expect(await sesiones()).toHaveLength(1);
  });

  it('solo dueño o administrador: un gerente no puede', async () => {
    await turno('t-lunes', `${LUNES}T15:00:00.000Z`, '2026-09-08T00:00:00.000Z');
    expect(await codigoDelFallo(llamar({ p_dias: [LUNES] }, GERENTE))).toBe('permission-denied');
    expect(await eventos()).toEqual([]);
  });

  it('pide entre uno y siete días válidos', async () => {
    expect(await codigoDelFallo(llamar({ p_dias: [] }))).toBe('invalid-argument');
    expect(await codigoDelFallo(llamar({ p_dias: ['7 sep'] }))).toBe('invalid-argument');
  });
});

describe('dónde va el refrigerio', () => {
  it('en el centro de la jornada, en cuartos de hora', () => {
    // 10:00–20:30 en Lima con una hora: 14:45–15:45.
    expect(refrigerioCentrado('2026-09-07T15:00:00.000Z', '2026-09-08T01:30:00.000Z', 60)).toEqual({
      desde: '2026-09-07T19:45:00.000Z',
      hasta: '2026-09-07T20:45:00.000Z',
    });
    expect(refrigerioCentrado('2026-09-07T15:00:00.000Z', '2026-09-07T19:00:00.000Z', 0)).toBe(
      null,
    );
  });
});
