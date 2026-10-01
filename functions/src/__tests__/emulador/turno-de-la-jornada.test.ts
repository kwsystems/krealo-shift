import {
  acknowledgeUnusualClock,
  managerAdjustTime,
  publishShiftsForWeek,
  recheckSessionsForPeriod,
  recheckSessionsForShift,
} from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { elegirTurno } from '../../shared/turnos';

/**
 * El turno de una jornada, y que se sincronice cuando el horario cambia (30-sep).
 *
 * Andree cambió el turno de una vendedora, lo publicó, le aprobó la marcación, y Horas
 * seguía diciendo «Sin turno programado»: la jornada guardaba el turno —y sus marcas— del
 * momento de fichar, y nada la volvía a mirar. Cada prueba es una forma de ese desfase.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-turno-jornada';
const SEDE = 'sede-turno-jornada';
const OTRA = 'otra-sede-turno-jornada';
const GERENTE = 'uid-gerente-turno-jornada';
const PERSONA = 'emp-turno-jornada';
const SEMANA = '2026-09-21';

// Lima, UTC-5: el martes 22-sep.
const H = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, 22, hora + 5, minuto)).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid: GERENTE, token: {} },
    rawRequest: {},
  });

async function turno(
  id: string,
  desde: string,
  hasta: string,
  extra: Record<string, unknown> = {},
) {
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
      status: 'published',
      publication_version: 1,
      ...extra,
    });
}

async function fichar(
  tipo: 'clock_in' | 'clock_out',
  cuando: string,
  shiftId: string | null = null,
) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    shiftId,
    source: 'kiosk',
  });
}

const jornada = async () => {
  const docs = (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs;
  expect(docs).toHaveLength(1);
  return { id: docs[0]!.id, ...docs[0]!.data() } as Record<string, unknown>;
};

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  for (const id of [SEDE, OTRA]) {
    await db
      .collection(COLLECTIONS.locations)
      .doc(id)
      .set({
        id,
        organization_id: ORG,
        timezone: 'America/Lima',
        settings: { lateGraceMinutes: 5 },
      });
  }
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${GERENTE}`)
    .set({
      organization_id: ORG,
      user_id: GERENTE,
      role: 'manager',
      status: 'active',
      managed_location_ids: [SEDE],
    });
});

describe('el turno de la jornada', () => {
  it('quien ficha sin elegir turno se queda con el publicado que le toca, y no «sin turno»', async () => {
    await turno('t-martes', H(10), H(19));
    await fichar('clock_in', H(9, 58));
    const sesion = await jornada();
    expect(sesion.shift_id).toBe('t-martes');
    expect(sesion.flags).toEqual([]);
  });

  it('fichó antes de que su turno existiera: al publicarlo, deja de decir «sin turno»', async () => {
    await fichar('clock_in', H(10));
    expect((await jornada()).flags).toEqual(['unscheduled']);

    await turno('t-nuevo', H(10), H(19), { status: 'draft', publication_version: 0 });
    await correr(publishShiftsForWeek, {
      p_location_id: SEDE,
      p_week_start: SEMANA,
      p_shift_ids: ['t-nuevo'],
    });

    const sesion = await jornada();
    expect(sesion.shift_id).toBe('t-nuevo');
    expect(sesion.flags).toEqual([]);
  });

  it('le cambian la hora del turno y se publica: la tardanza se mide contra la nueva', async () => {
    await turno('t-cambia', H(10), H(19));
    await fichar('clock_in', H(10), 't-cambia');
    expect((await jornada()).flags).toEqual([]);

    // Ahora entraba a las 9: se edita (vuelve a borrador) y se publica.
    await db
      .collection(COLLECTIONS.shifts)
      .doc('t-cambia')
      .update({ starts_at: H(9), status: 'draft' });
    await correr(publishShiftsForWeek, {
      p_location_id: SEDE,
      p_week_start: SEMANA,
      p_shift_ids: ['t-cambia'],
    });
    expect((await jornada()).flags).toEqual(['late_arrival']);
  });

  it('publicar no borra una hora corregida en Horas', async () => {
    await fichar('clock_in', H(10));
    await fichar('clock_out', H(19));
    const { id } = await jornada();
    await correr(managerAdjustTime, {
      p_work_session_id: id,
      p_new_starts_at: null,
      p_new_ends_at: H(20),
      p_reason: 'Se quedó cerrando',
    });

    await turno('t-tarde', H(10), H(20), { status: 'draft', publication_version: 0 });
    await correr(publishShiftsForWeek, {
      p_location_id: SEDE,
      p_week_start: SEMANA,
      p_shift_ids: ['t-tarde'],
    });

    const sesion = await jornada();
    expect(sesion).toMatchObject({ ends_at: H(20), gross_minutes: 600, shift_id: 't-tarde' });
    expect(sesion.flags).toEqual([]);
  });

  it('cancelar el turno publicado la deja sin turno, dicho', async () => {
    await turno('t-cancela', H(10), H(19));
    await fichar('clock_in', H(10), 't-cancela');
    await db.collection(COLLECTIONS.shifts).doc('t-cancela').update({ status: 'cancelled' });
    await correr(recheckSessionsForShift, { p_shift_id: 't-cancela' });
    const sesion = await jornada();
    expect(sesion.shift_id).toBeNull();
    expect(sesion.flags).toEqual(['unscheduled']);
  });

  it('una jornada ya guardada con «sin turno» se arregla al publicar cualquier turno de la semana', async () => {
    // Lo que había en producción antes del arreglo: su turno publicado, y la jornada
    // guardada sin él.
    await turno('t-suyo', H(10), H(19));
    await db
      .collection(COLLECTIONS.workSessions)
      .doc(`${PERSONA}_${H(10)}`)
      .set({
        organization_id: ORG,
        employee_id: PERSONA,
        location_id: SEDE,
        shift_id: null,
        starts_at: H(10),
        ends_at: null,
        status: 'open',
        flags: ['unscheduled'],
      });

    // Se publica el turno de OTRA persona de esa semana.
    await turno('t-de-otra', H(12), H(20), {
      employee_id: 'otra-persona',
      status: 'draft',
      publication_version: 0,
    });
    await correr(publishShiftsForWeek, {
      p_location_id: SEDE,
      p_week_start: SEMANA,
      p_shift_ids: ['t-de-otra'],
    });

    const sesion = await jornada();
    expect(sesion.shift_id).toBe('t-suyo');
    expect(sesion.flags).toEqual([]);
  });

  it('al MIRAR el periodo, una jornada vieja con «sin turno» se pone al día sin publicar nada', async () => {
    // El caso de la segunda captura: la jornada se guardó antes del arreglo y nadie ha
    // publicado nada desde entonces.
    await turno('t-publicado', H(10), H(19));
    await db
      .collection(COLLECTIONS.workSessions)
      .doc(`${PERSONA}_${H(10)}`)
      .set({
        organization_id: ORG,
        employee_id: PERSONA,
        location_id: SEDE,
        shift_id: null,
        starts_at: H(10),
        ends_at: null,
        status: 'open',
        flags: ['unscheduled'],
      });

    const r = (await correr(recheckSessionsForPeriod, {
      p_location_id: SEDE,
      p_from: '2026-09-21',
      p_to: '2026-09-27',
    })) as { cambiadas: number };

    expect(r.cambiadas).toBe(1);
    const sesion = await jornada();
    expect(sesion).toMatchObject({ shift_id: 't-publicado', flags: [], starts_at: H(10) });

    // Y mirarla otra vez no cambia nada: ya está al día.
    const otra = (await correr(recheckSessionsForPeriod, {
      p_location_id: SEDE,
      p_from: '2026-09-21',
      p_to: '2026-09-27',
    })) as { cambiadas: number };
    expect(otra.cambiadas).toBe(0);
  });

  it('ni un borrador ni el turno de otra sede cuentan como su turno', async () => {
    await turno('t-borrador', H(10), H(19), { status: 'draft' });
    await turno('t-otra', H(10), H(19), { location_id: OTRA });
    await fichar('clock_in', H(10));
    expect((await jornada()).flags).toEqual(['unscheduled']);
  });
});

/*
 * LAS MARCAS RARAS SE MANTIENEN AL DÍA (1-oct): Horario avisa de quien entró una hora o
 * más antes, y las dos salidas del aviso son cambiar el horario o decir «visto».
 */
describe('las marcas raras', () => {
  it('entrar hora y media antes queda marcado; si se cambia su turno y se publica, deja de serlo', async () => {
    await turno('t-raro', H(10), H(19));
    await fichar('clock_in', H(8, 30), 't-raro');
    expect((await jornada()).flags).toEqual(['early_arrival']);

    // Era su horario de verdad: se adelanta el turno y se publica.
    await db
      .collection(COLLECTIONS.shifts)
      .doc('t-raro')
      .update({ starts_at: H(8, 30), status: 'draft' });
    await correr(publishShiftsForWeek, {
      p_location_id: SEDE,
      p_week_start: SEMANA,
      p_shift_ids: ['t-raro'],
    });
    expect((await jornada()).flags).toEqual([]);
  });

  it('«visto, está bien» se apunta por marca y fichar la salida no lo borra', async () => {
    await turno('t-visto', H(10), H(19));
    await fichar('clock_in', H(8, 30), 't-visto');
    const { id } = await jornada();

    const r = (await correr(acknowledgeUnusualClock, { p_work_session_id: id })) as {
      vistos: string[];
    };
    expect(r.vistos).toEqual(['early_arrival']);

    // Sale dos horas tarde: la salida reconstruye la jornada y añade otra marca rara.
    await fichar('clock_out', H(21), 't-visto');
    const sesion = await jornada();
    expect(sesion.flags).toEqual(expect.arrayContaining(['early_arrival', 'late_departure']));
    // Lo visto sigue visto; lo nuevo, no.
    expect(sesion.avisos_vistos).toEqual(['early_arrival']);
  });

  it('solo quien gestiona la sede puede darla por vista', async () => {
    await turno('t-ajeno', H(10), H(19));
    await fichar('clock_in', H(8, 30), 't-ajeno');
    const { id } = await jornada();
    await expect(
      (acknowledgeUnusualClock as unknown as { run: (r: unknown) => Promise<unknown> }).run({
        data: { p_work_session_id: id },
        auth: { uid: 'uid-de-otra-tienda', token: {} },
        rawRequest: {},
      }),
    ).rejects.toThrow();
  });
});

describe('elegir el turno', () => {
  const t = (id: string, desde: string, hasta: string) => ({
    id,
    starts_at: desde,
    ends_at: hasta,
  });

  it('el que más se solapa, con turno partido', () => {
    const turnos = [t('manana', H(10), H(14)), t('tarde', H(18), H(22))];
    expect(elegirTurno(turnos, H(17, 55), H(22))?.id).toBe('tarde');
    expect(elegirTurno(turnos, H(9, 50), H(14))?.id).toBe('manana');
  });

  it('sin solape, el que empieza cerca; lejos de todo, ninguno', () => {
    const turnos = [t('noche', H(18), H(22))];
    expect(elegirTurno(turnos, H(16), H(17), H(23))?.id).toBe('noche');
    expect(elegirTurno(turnos, H(8), H(12), H(23))).toBeNull();
  });
});
