import { viewClockStart } from '../../horario-cumplido';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * DESDE QUÉ DÍA CADA SEDE USA EL RELOJ (1-oct), para el celular de la persona: desde ese
 * día, un turno terminado sin ninguna marca es una falta. Lo que tiene que ser cierto: el
 * día es el del primer fichaje DEL RELOJ en la zona de la sede —lo registrado desde el
 * horario no cuenta—, lo puede pedir una vendedora de la empresa, y nadie de fuera.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-reloj-desde';
const SEDE = 'sede-reloj';
const SIN_RELOJ = 'sede-sin-reloj';
const VENDEDORA = 'uid-vendedora-reloj';
const DE_FUERA = 'uid-de-otra-empresa';

const correr = (data: Record<string, unknown>, uid: string): Promise<unknown> =>
  (viewClockStart as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: { uid, token: {} },
    rawRequest: {},
  });

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no falló)';
  } catch (error) {
    return String((error as { code?: string }).code);
  }
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${VENDEDORA}`).set({
    organization_id: ORG,
    user_id: VENDEDORA,
    role: 'employee',
    status: 'active',
    managed_location_ids: [],
    employee_id: 'emp-reloj',
  });
  for (const sede of [SEDE, SIN_RELOJ]) {
    await db
      .collection(COLLECTIONS.locations)
      .doc(sede)
      .set({ organization_id: ORG, name: sede, timezone: 'America/Lima' });
  }
  const eventos: [string, string, string][] = [
    // Registrado desde el horario, antes del reloj: no mueve la fecha.
    ['ev-import', '2026-09-20T15:00:00.000Z', 'import'],
    // El primero del reloj: 21:30 del 28 en Lima, que en UTC ya es el 29.
    ['ev-reloj-1', '2026-09-29T02:30:00.000Z', 'kiosk'],
    ['ev-reloj-2', '2026-09-30T15:00:00.000Z', 'kiosk'],
  ];
  for (const [id, cuando, source] of eventos) {
    await db.collection(COLLECTIONS.timeEvents).doc(id).set({
      organization_id: ORG,
      location_id: SEDE,
      employee_id: 'emp-reloj',
      event_type: 'clock_in',
      occurred_at: cuando,
      source,
    });
  }
});

describe('desde qué día usa el reloj cada sede', () => {
  it('es el día del primer fichaje del reloj en la zona de la sede, y null si nunca', async () => {
    const filas = await correr({ p_location_ids: [SEDE, SIN_RELOJ] }, VENDEDORA);
    expect(filas).toEqual([
      { location_id: SEDE, clock_since: '2026-09-28' },
      { location_id: SIN_RELOJ, clock_since: null },
    ]);
  });

  it('alguien de otra empresa no lo puede pedir', async () => {
    expect(await codigoDelFallo(correr({ p_location_ids: [SEDE] }, DE_FUERA))).toBe(
      'permission-denied',
    );
  });

  it('sin sedes, o con demasiadas, se rechaza', async () => {
    expect(await codigoDelFallo(correr({ p_location_ids: [] }, VENDEDORA))).toBe(
      'invalid-argument',
    );
    expect(
      await codigoDelFallo(
        correr({ p_location_ids: Array.from({ length: 11 }, (_, i) => `s${i}`) }, VENDEDORA),
      ),
    ).toBe('invalid-argument');
  });
});
