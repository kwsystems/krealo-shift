import { viewEmployeesWorkingNow } from '../../views';
import { managerAddTimeEvent } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { attendanceStateAt, recordTimeEvent } from '../../shared/attendance';

/**
 * LA TIENDA ABRIÓ TARDE Y SU HORARIO CORRE DESDE LA HORA DEL TURNO (4-oct).
 *
 * Andree, el día de elecciones: «la tienda abre a las 2 pm, pero quiero que la gente que
 * tenía que entrar a las 10 y a la 1 salga como si hubiera marcado; ya quiero que corra su
 * horario». No hay un botón para eso: se pone su entrada a mano, a la hora del turno, con
 * «Agregar fichaje manual» en Horas, antes de que lleguen.
 *
 * Lo que tiene que ser cierto para que eso sirva: que desde ese momento la persona esté
 * TRABAJANDO en «quién está dentro» —Inicio y Horario— con su jornada atada al turno, que el
 * reloj la crea dentro al llegar —así no le ofrece «Marcar entrada» y no se abre otra
 * jornada— y que su salida en el reloj cierre ESA jornada con las horas desde el turno.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-entrada';
const SEDE = 'sede-entrada';
const GERENTE = 'uid-gerente-entrada';
const PERSONA = 'emp-entrada';

const ahora = Date.now();
const hace = (horas: number) => new Date(ahora - horas * 3600_000).toISOString();
const dentroDe = (horas: number) => new Date(ahora + horas * 3600_000).toISOString();

const correr = (fn: unknown, data: Record<string, unknown>, uid = GERENTE): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

const jornadas = async () =>
  (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs.map((d) => d.data());

const dentroAhora = async () =>
  (await correr(viewEmployeesWorkingNow, {
    filters: [{ field: 'location_id', op: 'eq', value: SEDE }],
  })) as Record<string, unknown>[];

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db.collection(COLLECTIONS.locations).doc(SEDE).set({
    id: SEDE,
    organization_id: ORG,
    timezone: 'America/Lima',
  });
  await db.collection(COLLECTIONS.employees).doc(PERSONA).set({
    id: PERSONA,
    organization_id: ORG,
    full_name: 'Persona de prueba',
    status: 'active',
  });
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
  // Su turno empezó hace tres horas; la tienda todavía no abre.
  await db
    .collection(COLLECTIONS.shifts)
    .doc('t-hoy')
    .set({
      id: 't-hoy',
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: hace(3),
      ends_at: dentroDe(6),
      status: 'published',
      publication_version: 1,
      planned_unpaid_break_minutes: 60,
    });
});

describe('poner la entrada a la hora del turno, antes de que llegue', () => {
  it('queda trabajando desde la hora del turno, el reloj la ve dentro y su salida cierra esa jornada', async () => {
    await correr(managerAddTimeEvent, {
      p_employee_id: PERSONA,
      p_location_id: SEDE,
      p_event_type: 'clock_in',
      p_occurred_at: hace(3),
      p_reason: 'La tienda abrió a las 2 pm: horario especial',
    });

    // Inicio y Horario: trabajando, desde la hora del turno.
    const dentro = await dentroAhora();
    expect(dentro).toHaveLength(1);
    expect(dentro[0]).toMatchObject({
      employee_id: PERSONA,
      starts_at: hace(3),
      shift_id: 't-hoy',
      attendance_state: 'WORKING',
    });

    // El reloj: dentro, así que al llegar no le ofrece «Marcar entrada».
    expect(await attendanceStateAt(PERSONA, new Date().toISOString())).toBe('WORKING');

    // Su salida en el reloj cierra ESA jornada, con las horas desde el turno.
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_out',
      occurredAt: new Date(ahora).toISOString(),
      idempotencyKey: 'salida-en-el-reloj',
      source: 'kiosk',
    });
    const [jornada, ...otras] = await jornadas();
    expect(otras).toHaveLength(0);
    expect(jornada).toMatchObject({
      shift_id: 't-hoy',
      starts_at: hace(3),
      status: 'complete',
      gross_minutes: 180,
    });
    expect(await dentroAhora()).toHaveLength(0);
  });

  it('una entrada a una hora que todavía no llegó no se acepta', async () => {
    await expect(
      correr(managerAddTimeEvent, {
        p_employee_id: PERSONA,
        p_location_id: SEDE,
        p_event_type: 'clock_in',
        p_occurred_at: dentroDe(1),
        p_reason: 'Adelantada',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(await jornadas()).toHaveLength(0);
  });
});
