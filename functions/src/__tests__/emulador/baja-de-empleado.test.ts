import { dischargeEmployee, inactivarBajasVencidas } from '../../baja-de-empleado';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Dar de baja con el último día (4-oct). Andree: «su último día fue el miércoles 30 de
 * setiembre, ya no está en octubre. No quiero que se borren sus datos».
 *
 * Lo que se comprueba es la frontera del último día: lo de antes se queda ENTERO —incluido
 * el turno de esa misma noche, que en UTC ya es el día siguiente— y lo de después deja de
 * existir para el horario, cancelado y no borrado.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-baja';
const SEDE = 'sede-baja';
const ADMIN = 'uid-admin-baja';
const VENDEDORA = 'uid-vendedora-baja';
const PERSONA = 'emp-baja';

// Lima, UTC-5.
const lima = (dia: string, hora: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + (hora + 5) * 3600_000).toISOString();

const correr = (uid: string, data: Record<string, unknown>): Promise<unknown> =>
  (dischargeEmployee as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function fallo(promesa: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await promesa;
    return { code: '(no fallo)', details: null };
  } catch (error) {
    const e = error as { code?: string; details?: unknown };
    return { code: e.code ?? String(error), details: e.details ?? null };
  }
}

async function turno(id: string, desde: string, hasta: string, status = 'published') {
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
      status,
      publication_version: status === 'published' ? 1 : 0,
    });
}

const empleadoRef = () => db.collection(COLLECTIONS.employees).doc(PERSONA);

const estado = async (id: string) =>
  (await db.collection(COLLECTIONS.shifts).doc(id).get()).data()?.status;

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db
    .collection(COLLECTIONS.organizations)
    .doc(ORG)
    .set({ id: ORG, name: 'Tienda', default_timezone: 'America/Lima' });
  for (const [uid, role] of [
    [ADMIN, 'admin'],
    [VENDEDORA, 'employee'],
  ] as const) {
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_${uid}`)
      .set({ organization_id: ORG, user_id: uid, role, status: 'active' });
  }
  await db.collection(COLLECTIONS.employees).doc(PERSONA).set({
    id: PERSONA,
    organization_id: ORG,
    full_name: 'Quien Se Fue',
    status: 'active',
  });

  await turno('t-29', lima('2026-09-29', 10), lima('2026-09-29', 18));
  // El último turno que SÍ hizo: 30-sep de 13:00 a 22:00, que en UTC acaba el 1-oct.
  await turno('t-30-noche', lima('2026-09-30', 13), lima('2026-09-30', 22));
  await turno('t-01', lima('2026-10-01', 10), lima('2026-10-01', 18));
  // Uno de la noche del 1-oct que en UTC ya es 2-oct: también se va.
  await turno('t-01-noche', lima('2026-10-01', 21), lima('2026-10-02', 3));
  await turno('t-02-borrador', lima('2026-10-02', 10), lima('2026-10-02', 18), 'draft');
  await turno('t-03-cancelado', lima('2026-10-03', 10), lima('2026-10-03', 18), 'cancelled');

  for (const dia of ['2026-09-28', '2026-10-04']) {
    await db.collection(COLLECTIONS.restDays).doc(`${SEDE}_${PERSONA}_${dia}`).set({
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      date_key: dia,
    });
  }

  await db
    .collection(COLLECTIONS.workSessions)
    .doc(`${PERSONA}_s30`)
    .set({
      id: `${PERSONA}_s30`,
      organization_id: ORG,
      employee_id: PERSONA,
      location_id: SEDE,
      starts_at: lima('2026-09-30', 12.9),
      ends_at: lima('2026-09-30', 22),
      status: 'complete',
      net_minutes: 480,
    });
});

describe('dar de baja con su último día', () => {
  it('sin escribir nada, dice cuántos turnos se quitan y cuándo marcó por última vez', async () => {
    const resumen = (await correr(ADMIN, {
      employeeId: PERSONA,
      lastDay: '2026-09-30',
      dryRun: true,
    })) as Record<string, unknown>;
    expect(resumen).toMatchObject({ turnos: 3, descansos: 1, ultimoDiaMarcado: '2026-09-30' });
    expect((await db.collection(COLLECTIONS.employees).doc(PERSONA).get()).data()?.status).toBe(
      'active',
    );
    expect(await estado('t-01')).toBe('published');
  });

  it('lo de antes se queda entero; lo de después se cancela, no se borra', async () => {
    await correr(ADMIN, { employeeId: PERSONA, lastDay: '2026-09-30' });

    const ficha = (await db.collection(COLLECTIONS.employees).doc(PERSONA).get()).data();
    expect(ficha).toMatchObject({ status: 'inactive', end_date: '2026-09-30' });

    expect(await estado('t-29')).toBe('published');
    expect(await estado('t-30-noche')).toBe('published');
    expect(await estado('t-01')).toBe('cancelled');
    expect(await estado('t-01-noche')).toBe('cancelled');
    expect(await estado('t-02-borrador')).toBe('cancelled');
    expect(await estado('t-03-cancelado')).toBe('cancelled');
    // Ningún turno se borró.
    expect(
      (await db.collection(COLLECTIONS.shifts).where('employee_id', '==', PERSONA).get()).size,
    ).toBe(6);

    const descansos = await db
      .collection(COLLECTIONS.restDays)
      .where('employee_id', '==', PERSONA)
      .get();
    expect(descansos.docs.map((d) => d.data().date_key)).toEqual(['2026-09-28']);

    // Su jornada sigue ahí.
    expect((await db.collection(COLLECTIONS.workSessions).doc(`${PERSONA}_s30`).get()).exists).toBe(
      true,
    );
    const auditoria = await db
      .collection(COLLECTIONS.auditLogs)
      .where('action', '==', 'employee_discharged')
      .get();
    expect(auditoria.size).toBe(1);
  });

  it('el último día no puede ser futuro', async () => {
    const resultado = await fallo(correr(ADMIN, { employeeId: PERSONA, lastDay: '2999-01-01' }));
    expect(resultado.code).toBe('invalid-argument');
    expect(resultado.details).toEqual({ code: 'future_last_day' });
  });

  it('una cuenta de empleado no puede dar de baja a nadie', async () => {
    const resultado = await fallo(
      correr(VENDEDORA, { employeeId: PERSONA, lastDay: '2026-09-30' }),
    );
    expect(resultado.code).toBe('permission-denied');
    expect(await estado('t-01')).toBe('published');
  });
});

/*
 * CON ÚLTIMO DÍA HOY SIGUE ACTIVA HASTA MAÑANA (26-oct): se la dejaba inactiva al momento y
 * el reloj le rechazaba el PIN ese mismo día, sin poder marcar su salida, y su turno de hoy
 * acababa como falta. La desactiva el cierre de cada hora cuando ese día pasa en su sede.
 */
describe('último día hoy', () => {
  const diaLima = (instante: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instante));
  const sumarDias = (dia: string, dias: number) =>
    new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 24 * 3600_000).toISOString().slice(0, 10);
  const ficha = async () => (await empleadoRef().get()).data();

  it('guarda el día y la deja activa; lo de mañana se quita y lo de hoy se queda', async () => {
    const hoy = diaLima(Date.now());
    await turno('t-hoy', lima(hoy, 10), lima(hoy, 18));
    await turno('t-manana', lima(sumarDias(hoy, 1), 10), lima(sumarDias(hoy, 1), 18));

    const previo = (await correr(ADMIN, {
      employeeId: PERSONA,
      lastDay: hoy,
      dryRun: true,
    })) as Record<string, unknown>;
    expect(previo).toMatchObject({ sigueHoy: true, hoy });

    const resumen = (await correr(ADMIN, { employeeId: PERSONA, lastDay: hoy })) as Record<
      string,
      unknown
    >;
    expect(resumen).toMatchObject({ sigueHoy: true });
    expect(await ficha()).toMatchObject({ status: 'active', end_date: hoy });
    expect(await estado('t-hoy')).toBe('published');
    expect(await estado('t-manana')).toBe('cancelled');

    // Esta misma hora todavía es su último día: sigue activa.
    expect((await inactivarBajasVencidas(Date.now())).inactivadas).toEqual([]);
    expect(await ficha()).toMatchObject({ status: 'active' });

    // Pasado el día, el cierre de cada hora la desactiva y lo deja auditado.
    expect((await inactivarBajasVencidas(Date.now() + 26 * 3600_000)).inactivadas).toEqual([
      PERSONA,
    ]);
    expect(await ficha()).toMatchObject({ status: 'inactive', end_date: hoy });
    const auditoria = await db
      .collection(COLLECTIONS.auditLogs)
      .where('action', '==', 'employee_discharge_effective')
      .get();
    expect(auditoria.size).toBe(1);
  });

  it('un día anterior se aplica al momento, como siempre', async () => {
    const resumen = (await correr(ADMIN, {
      employeeId: PERSONA,
      lastDay: '2026-09-30',
    })) as Record<string, unknown>;
    expect(resumen).toMatchObject({ sigueHoy: false });
    expect(await ficha()).toMatchObject({ status: 'inactive', end_date: '2026-09-30' });
  });

  it('con una jornada abierta espera a que se cierre: el turno de noche marca su salida', async () => {
    await empleadoRef().update({ end_date: '2026-09-30' });
    await db
      .collection(COLLECTIONS.workSessions)
      .doc(`${PERSONA}_abierta`)
      .set({
        id: `${PERSONA}_abierta`,
        organization_id: ORG,
        employee_id: PERSONA,
        location_id: SEDE,
        starts_at: lima('2026-09-30', 21),
        ends_at: null,
        status: 'open',
      });

    expect(await inactivarBajasVencidas(Date.now())).toEqual({
      inactivadas: [],
      esperando: [PERSONA],
    });
    expect(await ficha()).toMatchObject({ status: 'active' });

    await db
      .collection(COLLECTIONS.workSessions)
      .doc(`${PERSONA}_abierta`)
      .update({ status: 'complete', ends_at: lima('2026-10-01', 2) });
    expect((await inactivarBajasVencidas(Date.now())).inactivadas).toEqual([PERSONA]);
  });

  it('quien ya no tiene día de baja —se reactivó— no se toca', async () => {
    await empleadoRef().update({ end_date: null });
    expect((await inactivarBajasVencidas(Date.now() + 26 * 3600_000)).inactivadas).toEqual([]);
    expect(await ficha()).toMatchObject({ status: 'active' });
  });
});

/*
 * QUE GESTIONE ALGUNA DE SUS SEDES (26-oct): solo se miraba el rol, y el encargado de una
 * tienda podía dar de baja a alguien de otra.
 */
describe('quién puede dar de baja', () => {
  const ENCARGADO = 'uid-encargado-baja';
  const DE_OTRA = 'uid-encargado-otra-baja';

  beforeEach(async () => {
    await db
      .collection(COLLECTIONS.locations)
      .doc(SEDE)
      .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima' });
    for (const [uid, sede] of [
      [ENCARGADO, SEDE],
      [DE_OTRA, 'otra-sede-baja'],
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

  const asignar = () =>
    db
      .collection(COLLECTIONS.employeeLocations)
      .doc(`${PERSONA}_${SEDE}`)
      .set({ organization_id: ORG, employee_id: PERSONA, location_id: SEDE, is_primary: true });

  it('el encargado de otra sede no puede, ni para contar', async () => {
    await asignar();
    for (const dryRun of [true, false]) {
      const resultado = await fallo(
        correr(DE_OTRA, { employeeId: PERSONA, lastDay: '2026-09-30', dryRun }),
      );
      expect(resultado.code).toBe('permission-denied');
    }
    expect(await estado('t-01')).toBe('published');
  });

  it('el encargado de su sede sí', async () => {
    await asignar();
    await correr(ENCARGADO, { employeeId: PERSONA, lastDay: '2026-09-30' });
    expect(await estado('t-01')).toBe('cancelled');
  });

  it('sin sede asignada, solo owner y admin', async () => {
    const resultado = await fallo(
      correr(ENCARGADO, { employeeId: PERSONA, lastDay: '2026-09-30' }),
    );
    expect(resultado.code).toBe('permission-denied');
    await correr(ADMIN, { employeeId: PERSONA, lastDay: '2026-09-30' });
    expect(await estado('t-01')).toBe('cancelled');
  });
});

/*
 * NI ANTES DE SU ÚLTIMA MARCA (26-oct): solo se comprobaba que no fuera futuro, y un día
 * anterior cancelaba turnos que sí trabajó.
 */
describe('el último día no puede ser anterior a su última marca', () => {
  beforeEach(async () => {
    // La salida del turno de noche del 1-oct, pasada la medianoche: es del 2-oct.
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc(`${ORG}_salida-noche`)
      .set({
        id: `${ORG}_salida-noche`,
        organization_id: ORG,
        employee_id: PERSONA,
        location_id: SEDE,
        event_type: 'clock_out',
        occurred_at: lima('2026-10-02', 1),
        seq: 10,
      });
  });

  it('propone el día de su último fichaje', async () => {
    const resumen = (await correr(ADMIN, { employeeId: PERSONA, dryRun: true })) as Record<
      string,
      unknown
    >;
    expect(resumen).toMatchObject({ ultimoDiaMarcado: '2026-10-02' });
  });

  it('un día antes se rechaza con su motivo, también al contar, y no se toca nada', async () => {
    for (const dryRun of [true, false]) {
      const resultado = await fallo(
        correr(ADMIN, { employeeId: PERSONA, lastDay: '2026-09-30', dryRun }),
      );
      expect(resultado.code).toBe('invalid-argument');
      expect(resultado.details).toEqual({
        code: 'before_last_mark',
        motivo: 'ANTES_DE_SU_ULTIMA_MARCA',
        ultimoDiaMarcado: '2026-10-02',
      });
    }
    expect((await empleadoRef().get()).data()).toMatchObject({ status: 'active' });
    expect(await estado('t-01')).toBe('published');
  });

  it('ese mismo día sí', async () => {
    await correr(ADMIN, { employeeId: PERSONA, lastDay: '2026-10-02' });
    expect((await empleadoRef().get()).data()).toMatchObject({
      status: 'inactive',
      end_date: '2026-10-02',
    });
  });
});
