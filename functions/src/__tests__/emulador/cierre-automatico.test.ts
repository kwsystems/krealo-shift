import { cerrarJornadasOlvidadas } from '../../cierre-automatico';
import { tipoDeCorreccion } from '../../correcciones';
import { managerAdjustTime } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';
import { attendanceStateAt, recordTimeEvent } from '../../shared/attendance';

/**
 * LA JORNADA QUE NADIE CERRÓ SE CIERRA SOLA A LA HORA DE FIN DEL TURNO (5-oct).
 *
 * Andree: «que se pare solo en el horario de salida, y luego el admin que haga lo que sea.
 * Que se pare antes de que termine el día». Lo que tiene que ser cierto: la de ayer se
 * cierra a la hora de su turno y la persona queda fuera para el reloj; la de hoy espera a
 * las 23:00; la de un turno de noche en marcha no se toca; sin turno, se cierra en su
 * última marca; y quien gestiona la corrige después como cualquier otra.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-cierre';
const SEDE = 'sede-cierre';
const GERENTE = 'uid-gerente-cierre';
const PERSONA = 'emp-cierre';

// Lima, UTC-5: el lunes 21-sep y el martes 22-sep de 2026.
const H = (dia: number, hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, dia, hora + 5, minuto)).toISOString();
const ms = (iso: string) => Date.parse(iso);

const correr = (fn: unknown, data: Record<string, unknown>, uid = GERENTE): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function turno(id: string, desde: string, hasta: string) {
  await db.collection(COLLECTIONS.shifts).doc(id).set({
    id,
    organization_id: ORG,
    location_id: SEDE,
    employee_id: PERSONA,
    starts_at: desde,
    ends_at: hasta,
    status: 'published',
  });
}

async function entrar(cuando: string) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: 'clock_in',
    occurredAt: cuando,
    idempotencyKey: `clock_in-${cuando}`,
    source: 'kiosk',
  });
}

const jornadas = async () =>
  (
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima' });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
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
});

describe('cerrar sola la jornada sin salida', () => {
  it('la de ayer se cierra a la hora de fin del turno, marcada, y la persona queda fuera', async () => {
    await turno('t-ayer', H(21, 10), H(21, 19));
    await entrar(H(21, 10, 2));

    const resumen = await cerrarJornadasOlvidadas(ms(H(22, 8)));

    const [cerrada, ...otras] = await jornadas();
    expect(otras).toEqual([]);
    expect(resumen.cerradas).toEqual([cerrada!.id]);
    expect(cerrada).toMatchObject({
      status: 'complete',
      ends_at: H(21, 19),
      gross_minutes: 538,
      auto_clock_out: true,
    });
    expect(await attendanceStateAt(PERSONA, H(22, 8))).toBe('OFF_SHIFT');

    const salida = (await db.collection(COLLECTIONS.timeEvents).get()).docs
      .map((d) => d.data())
      .find((e) => e.event_type === 'clock_out');
    expect(salida).toMatchObject({
      occurred_at: H(21, 19),
      created_by: 'sistema',
      metadata: { origen: 'salida_automatica' },
    });
    const ajustes = (await db.collection(COLLECTIONS.timeAdjustments).get()).docs.map((d) =>
      d.data(),
    );
    expect(ajustes).toEqual([
      expect.objectContaining({
        channel: 'automatico',
        work_session_id: cerrada!.id,
        // Reportes la cuenta como «salida automática», no como una hora corregida.
        after_value: expect.objectContaining({ origen: 'salida_automatica' }),
      }),
    ]);
    expect(ajustes.map((ajuste) => tipoDeCorreccion(ajuste))).toEqual(['salida_automatica']);
  });

  it('la de hoy espera a las 23:00 de la sede', async () => {
    await turno('t-hoy', H(21, 10), H(21, 19));
    await entrar(H(21, 10));

    expect((await cerrarJornadasOlvidadas(ms(H(21, 22))).then((r) => r.cerradas)).length).toBe(0);
    expect((await jornadas())[0]).toMatchObject({ status: 'open' });

    await cerrarJornadasOlvidadas(ms(H(21, 23, 30)));
    expect((await jornadas())[0]).toMatchObject({ status: 'complete', ends_at: H(21, 19) });
  });

  it('un turno de noche que sigue en marcha no se toca', async () => {
    await turno('t-noche', H(21, 18), H(22, 1));
    await entrar(H(21, 18));

    await cerrarJornadasOlvidadas(ms(H(21, 23, 30)));
    expect((await jornadas())[0]).toMatchObject({ status: 'open', ends_at: null });
  });

  it('sin turno, se cierra en su última marca: no paga horas que nadie sabe', async () => {
    await entrar(H(21, 10));

    await cerrarJornadasOlvidadas(ms(H(22, 8)));
    expect((await jornadas())[0]).toMatchObject({
      status: 'complete',
      ends_at: H(21, 10),
      gross_minutes: 0,
      auto_clock_out: true,
    });
  });

  it('quien gestiona la corrige después y deja de ser automática', async () => {
    await turno('t-ayer', H(21, 10), H(21, 19));
    await entrar(H(21, 10));
    await cerrarJornadasOlvidadas(ms(H(22, 8)));
    const [cerrada] = await jornadas();

    await correr(managerAdjustTime, {
      p_work_session_id: cerrada!.id,
      p_reason: 'Se fue a las 18:00.',
      p_new_ends_at: H(21, 18),
    });

    expect((await jornadas())[0]).toMatchObject({
      status: 'complete',
      ends_at: H(21, 18),
      auto_clock_out: false,
    });
  });
});
