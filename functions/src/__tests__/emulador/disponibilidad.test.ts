import { deleteAvailability, markAvailabilitySeen, saveAvailability } from '../../disponibilidad';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * LA DISPONIBILIDAD (1-oct): «qué días tienen problemas para trabajar», como en Homebase.
 * Lo que tiene que ser cierto: la persona escribe la suya —y solo la suya— y llega como
 * nueva; quien gestiona su sede la ve, la da por vista y puede escribir en su nombre; y lo
 * que no tiene sentido no se guarda.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-disponibilidad';
const SEDE = 'sede-disponibilidad';
const OTRA = 'sede-otra';
const GERENTE = 'uid-gerente-disp';
const AJENO = 'uid-gerente-otra-sede';
const VENDEDORA = 'uid-vendedora-disp';
const OTRA_VENDEDORA = 'uid-otra-vendedora';
const PERSONA = 'emp-disp';
const OTRA_PERSONA = 'emp-otra-disp';

const correr = (fn: unknown, data: Record<string, unknown>, uid: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function motivoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no falló)';
  } catch (error) {
    const e = error as { code?: string; details?: { motivo?: string } };
    return e.details?.motivo === undefined ? String(e.code) : `${e.code}:${e.details.motivo}`;
  }
}

const filas = async () =>
  (await db.collection(COLLECTIONS.availability).get()).docs.map(
    (d) => d.data() as Record<string, unknown>,
  );

const guardar = (data: Record<string, unknown>, uid: string) =>
  correr(saveAvailability, { p_organization_id: ORG, ...data }, uid) as Promise<{ id: string }>;

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  const miembros: [string, string, string[], string | null][] = [
    [GERENTE, 'manager', [SEDE], null],
    [AJENO, 'manager', [OTRA], null],
    [VENDEDORA, 'employee', [], PERSONA],
    [OTRA_VENDEDORA, 'employee', [], OTRA_PERSONA],
  ];
  for (const [uid, role, sedes, empleado] of miembros) {
    await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).set({
      organization_id: ORG,
      user_id: uid,
      role,
      status: 'active',
      managed_location_ids: sedes,
      employee_id: empleado,
    });
  }
  for (const empleado of [PERSONA, OTRA_PERSONA]) {
    await db
      .collection(COLLECTIONS.employeeLocations)
      .doc(`${empleado}_${SEDE}`)
      .set({ organization_id: ORG, employee_id: empleado, location_id: SEDE });
  }
});

describe('la persona escribe la suya', () => {
  it('«los martes no puedo» llega como nueva, a su nombre', async () => {
    const { id } = await guardar(
      { p_kind: 'weekly', p_weekday: 2, p_type: 'unavailable', p_note: 'Estudio' },
      VENDEDORA,
    );
    const [fila] = await filas();
    expect(fila).toMatchObject({
      id,
      employee_id: PERSONA,
      kind: 'weekly',
      weekday: 2,
      date: null,
      type: 'unavailable',
      from_time: null,
      to_time: null,
      note: 'Estudio',
      status: 'new',
      source: 'employee',
    });
  });

  it('un día con franja, y la puede cambiar y quitar', async () => {
    const { id } = await guardar(
      {
        p_kind: 'date',
        p_date: '2026-10-15',
        p_type: 'unavailable',
        p_from: '08:00',
        p_to: '13:00',
      },
      VENDEDORA,
    );
    await guardar(
      { p_id: id, p_kind: 'date', p_date: '2026-10-15', p_type: 'note', p_note: 'Cita médica' },
      VENDEDORA,
    );
    expect((await filas())[0]).toMatchObject({ type: 'note', note: 'Cita médica', status: 'new' });
    await correr(deleteAvailability, { p_id: id }, VENDEDORA);
    expect(await filas()).toEqual([]);
  });

  it('no puede tocar la de otra persona ni darse la suya por vista', async () => {
    const { id } = await guardar(
      { p_kind: 'weekly', p_weekday: 5, p_type: 'note', p_note: 'x' },
      VENDEDORA,
    );
    expect(
      await motivoDelFallo(
        guardar(
          { p_id: id, p_kind: 'weekly', p_weekday: 5, p_type: 'note', p_note: 'cambiada' },
          OTRA_VENDEDORA,
        ),
      ),
    ).toBe('permission-denied');
    expect(await motivoDelFallo(correr(deleteAvailability, { p_id: id }, OTRA_VENDEDORA))).toBe(
      'permission-denied',
    );
    expect(
      await motivoDelFallo(
        guardar(
          {
            p_employee_id: OTRA_PERSONA,
            p_kind: 'weekly',
            p_weekday: 1,
            p_type: 'note',
            p_note: 'x',
          },
          VENDEDORA,
        ),
      ),
    ).toBe('permission-denied');
    expect(await motivoDelFallo(correr(markAvailabilitySeen, { p_ids: [id] }, VENDEDORA))).toBe(
      'permission-denied',
    );
  });

  it('lo que no tiene sentido no se guarda', async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ p_kind: 'weekly', p_weekday: 9, p_type: 'unavailable' }, 'invalid-argument'],
      [{ p_kind: 'date', p_date: 'mañana', p_type: 'unavailable' }, 'invalid-argument'],
      [
        { p_kind: 'weekly', p_weekday: 1, p_type: 'unavailable', p_from: '13:00', p_to: '08:00' },
        'invalid-argument:HORAS',
      ],
      [
        { p_kind: 'weekly', p_weekday: 1, p_type: 'unavailable', p_from: '08:00' },
        'invalid-argument',
      ],
      [{ p_kind: 'weekly', p_weekday: 1, p_type: 'preferred' }, 'invalid-argument:HORAS'],
      [{ p_kind: 'weekly', p_weekday: 1, p_type: 'note' }, 'invalid-argument:NOTA'],
      [
        { p_kind: 'weekly', p_weekday: 1, p_type: 'note', p_note: 'x'.repeat(281) },
        'invalid-argument',
      ],
    ];
    for (const [datos, esperado] of casos) {
      expect(await motivoDelFallo(guardar(datos, VENDEDORA))).toBe(esperado);
    }
    expect(await filas()).toEqual([]);
  });
});

describe('quien gestiona su sede', () => {
  it('la da por vista, y escribe en su nombre ya vista', async () => {
    const { id } = await guardar(
      { p_kind: 'weekly', p_weekday: 2, p_type: 'unavailable' },
      VENDEDORA,
    );
    await correr(markAvailabilitySeen, { p_ids: [id] }, GERENTE);
    expect((await filas())[0]).toMatchObject({ status: 'seen', seen_by: GERENTE });

    await guardar(
      {
        p_employee_id: OTRA_PERSONA,
        p_kind: 'weekly',
        p_weekday: 6,
        p_type: 'preferred',
        p_from: '14:00',
        p_to: '22:00',
      },
      GERENTE,
    );
    const suya = (await filas()).find((f) => f.employee_id === OTRA_PERSONA);
    expect(suya).toMatchObject({ status: 'seen', source: 'manager', from_time: '14:00' });
  });

  it('quien gestiona otra sede no puede', async () => {
    const { id } = await guardar(
      { p_kind: 'weekly', p_weekday: 2, p_type: 'unavailable' },
      VENDEDORA,
    );
    expect(await motivoDelFallo(correr(markAvailabilitySeen, { p_ids: [id] }, AJENO))).toBe(
      'permission-denied',
    );
    expect(
      await motivoDelFallo(
        guardar(
          { p_employee_id: PERSONA, p_kind: 'weekly', p_weekday: 3, p_type: 'note', p_note: 'x' },
          AJENO,
        ),
      ),
    ).toBe('permission-denied');
  });

  it('cambiar la fila desde el celular la vuelve a poner como nueva', async () => {
    const { id } = await guardar(
      { p_kind: 'weekly', p_weekday: 2, p_type: 'unavailable' },
      VENDEDORA,
    );
    await correr(markAvailabilitySeen, { p_ids: [id] }, GERENTE);
    await guardar({ p_id: id, p_kind: 'weekly', p_weekday: 3, p_type: 'unavailable' }, VENDEDORA);
    expect((await filas())[0]).toMatchObject({ weekday: 3, status: 'new' });
  });
});
