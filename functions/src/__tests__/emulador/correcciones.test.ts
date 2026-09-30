import { viewCorrectionsSummary } from '../../correcciones';
import { managerAddTimeEvent } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Las correcciones de hora de un periodo, para Reportes (30-sep).
 *
 * Lo que se prueba es lo que hace difícil contarlas: las filas de antes no llevan sede y
 * hay que deducirla de su jornada o de su fichaje; cada una cuenta en el día que corrige y
 * no en el que se hizo; y lo de otra sede no se cuela.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-correcciones';
const SEDE = 'sede-correcciones';
const OTRA = 'sede-correcciones-2';
const GERENTE = 'uid-gerente-correcciones';
const AJENO = 'uid-gerente-de-otra-sede';
const PERSONA = 'emp-correcciones';

// Lima, UTC-5. La semana del lunes 21 al domingo 27 de septiembre.
const L = (dia: number, hora: number) =>
  new Date(Date.UTC(2026, 8, dia, hora + 5, 0)).toISOString();

type Datos = Record<string, unknown>;
const correr = (fn: unknown, data: Datos, uid = GERENTE): Promise<Datos> =>
  (fn as { run: (r: unknown) => Promise<Datos> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

const resumen = async (desde = '2026-09-21', hasta = '2026-09-27', uid = GERENTE) =>
  (await correr(
    viewCorrectionsSummary,
    { p_location_id: SEDE, p_from: desde, p_to: hasta },
    uid,
  )) as {
    filas: {
      tipo: string;
      employee_id: string | null;
      work_date: string;
      author_name: string | null;
    }[];
  };

async function correccion(id: string, datos: Datos) {
  await db
    .collection(COLLECTIONS.timeAdjustments)
    .doc(id)
    .set({
      organization_id: ORG,
      reason: 'x',
      created_by: GERENTE,
      created_at: L(28, 9),
      channel: 'manager_app',
      ...datos,
    });
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  for (const sede of [SEDE, OTRA]) {
    await db
      .collection(COLLECTIONS.locations)
      .doc(sede)
      .set({ id: sede, organization_id: ORG, timezone: 'America/Lima', settings: {} });
  }
  for (const [uid, sede] of [
    [GERENTE, SEDE],
    [AJENO, OTRA],
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
  await db.collection(COLLECTIONS.profiles).doc(GERENTE).set({ full_name: 'Gerente De Prueba' });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
});

describe('las correcciones de un periodo', () => {
  it('cuenta cada tipo, con su persona y su autor', async () => {
    // Una nueva, hecha con la función de verdad: ya lleva sede y persona.
    await correr(managerAddTimeEvent, {
      p_employee_id: PERSONA,
      p_location_id: SEDE,
      p_event_type: 'clock_in',
      p_occurred_at: L(22, 8),
      p_reason: 'Olvidó marcar',
    });
    // Las de antes, sin sede: se deduce de su jornada o de su fichaje.
    await db
      .collection(COLLECTIONS.workSessions)
      .doc('ses-1')
      .set({ location_id: SEDE, employee_id: PERSONA, starts_at: L(23, 10) });
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc('ev-salida')
      .set({ location_id: SEDE, employee_id: PERSONA, occurred_at: L(24, 17) });
    await correccion('c-hora', {
      target_type: 'work_session',
      work_session_id: 'ses-1',
      target_id: 'ses-1',
      before_value: { starts_at: L(23, 11) },
      after_value: { starts_at: L(23, 10) },
    });
    await correccion('c-pausa', {
      target_type: 'time_event',
      work_session_id: null,
      target_id: 'ev-salida',
      before_value: { event_type: 'clock_out', occurred_at: L(24, 17) },
      after_value: { reclassified_as: 'break_start' },
    });
    await correccion('c-solicitud', {
      location_id: SEDE,
      employee_id: PERSONA,
      request_id: 'sol-1',
      target_type: 'time_event',
      target_id: 'ev-x',
      before_value: null,
      after_value: { event_type: 'clock_out', occurred_at: L(25, 19) },
    });
    await correccion('c-horario', {
      location_id: SEDE,
      employee_id: PERSONA,
      target_type: 'work_session',
      work_session_id: 'ses-horario',
      before_value: null,
      after_value: { starts_at: L(26, 10), ends_at: L(26, 19), origen: 'horario' },
    });

    const { filas } = await resumen();
    const porTipo = Object.fromEntries(
      [
        'fichaje_anadido',
        'hora_corregida',
        'salida_a_pausa',
        'solicitud_aprobada',
        'segun_horario',
      ].map((tipo) => [tipo, filas.filter((f) => f.tipo === tipo).length]),
    );
    expect(porTipo).toEqual({
      fichaje_anadido: 1,
      hora_corregida: 1,
      salida_a_pausa: 1,
      solicitud_aprobada: 1,
      segun_horario: 1,
    });
    expect(filas.every((f) => f.employee_id === PERSONA)).toBe(true);
    expect(filas.every((f) => f.author_name === 'Gerente De Prueba')).toBe(true);
    expect(filas.find((f) => f.tipo === 'hora_corregida')?.work_date).toBe('2026-09-23');
  });

  it('las nuevas guardan la sede y la persona en la fila', async () => {
    await correr(managerAddTimeEvent, {
      p_employee_id: PERSONA,
      p_location_id: SEDE,
      p_event_type: 'clock_in',
      p_occurred_at: L(22, 8),
      p_reason: 'Olvidó marcar',
    });
    const [fila] = (await db.collection(COLLECTIONS.timeAdjustments).get()).docs.map((d) =>
      d.data(),
    );
    expect(fila).toMatchObject({ location_id: SEDE, employee_id: PERSONA });
  });

  it('cuenta en el día que corrige, no en el que se hizo', async () => {
    // Hecha el lunes 28, corrige el viernes 25: es de la semana del 21.
    await correccion('c-tarde', {
      location_id: SEDE,
      target_type: 'time_event',
      after_value: { occurred_at: L(25, 18) },
      created_at: L(28, 10),
    });
    // Hecha dentro de la semana, pero corrige un día de la anterior: no es de esta.
    await correccion('c-anterior', {
      location_id: SEDE,
      target_type: 'time_event',
      after_value: { occurred_at: L(19, 18) },
      created_at: L(22, 10),
    });
    const { filas } = await resumen();
    expect(filas.map((f) => f.work_date)).toEqual(['2026-09-25']);
  });

  it('lo de otra sede no se cuela, tampoco lo que solo se sabe por su fichaje', async () => {
    await db
      .collection(COLLECTIONS.timeEvents)
      .doc('ev-otra')
      .set({ location_id: OTRA, employee_id: 'otra-persona', occurred_at: L(22, 8) });
    await correccion('c-otra', {
      target_type: 'time_event',
      target_id: 'ev-otra',
      after_value: { event_type: 'clock_in', occurred_at: L(22, 8) },
    });
    await correccion('c-otra-nueva', {
      location_id: OTRA,
      target_type: 'time_event',
      after_value: { occurred_at: L(22, 9) },
    });
    expect((await resumen()).filas).toEqual([]);
  });

  it('solo la ve quien gestiona esa sede, y con un periodo válido', async () => {
    const fallo = async (p: Promise<unknown>) => {
      try {
        await p;
        return '(no fallo)';
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(await fallo(resumen('2026-09-21', '2026-09-27', AJENO))).toBe('permission-denied');
    expect(
      await fallo(
        correr(viewCorrectionsSummary, { p_location_id: SEDE, p_from: 'ayer', p_to: '' }),
      ),
    ).toBe('invalid-argument');
  });
});
