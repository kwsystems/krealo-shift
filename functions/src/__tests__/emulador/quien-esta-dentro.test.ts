import { viewEmployeesWorkingNow } from '../../views';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * «Quién está dentro» de punta a punta: si trabaja o está en su descanso.
 *
 * La consulta de eventos cambió de orden el 29-sep —descendente con límite a ascendente—
 * porque la descendente pedía un índice que producción no tenía y tumbaba Inicio. Esta
 * prueba fija que el cambio no alteró lo que la vista contesta: el ÚLTIMO evento de pausa
 * manda, también después de un descanso ya cerrado.
 *
 * Lo que NO puede fijar: que el índice exista. El emulador no exige índices; eso lo mira
 * `src/lib/firebase/__tests__/indices.test.ts`.
 */

const ORG = 'org-dentro';
const SEDE = 'sede-dentro';
const GERENTE = 'uid-gerente';
const PERSONA = 'persona-dentro';
const PROYECTO = 'demo-krealo-shift';
const ENTRADA = '2026-09-29T14:55:00.000Z';

const verComoGerente = (): Promise<unknown> =>
  (viewEmployeesWorkingNow as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data: { filters: [{ field: 'location_id', op: 'eq', value: SEDE }] },
    auth: { uid: GERENTE, token: {} },
    rawRequest: {},
  });

let contador = 0;
async function evento(tipo: string, instante: string, motivo: string | null = null) {
  contador += 1;
  await db
    .collection(COLLECTIONS.timeEvents)
    .doc(`ev-${contador}`)
    .set({
      id: `ev-${contador}`,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      event_type: tipo,
      occurred_at: instante,
      seq: contador,
      break_reason: motivo,
    });
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  contador = 0;

  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, name: 'Sede', timezone: 'America/Lima', settings: {} });
  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${GERENTE}`).set({
    organization_id: ORG,
    user_id: GERENTE,
    role: 'admin',
    status: 'active',
    managed_location_ids: [],
  });
  await db.collection(COLLECTIONS.employees).doc(PERSONA).set({
    id: PERSONA,
    organization_id: ORG,
    full_name: 'Persona Dentro',
    preferred_name: null,
  });
  await db
    .collection(COLLECTIONS.workSessions)
    .doc(`${PERSONA}_${ENTRADA}`)
    .set({
      id: `${PERSONA}_${ENTRADA}`,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      shift_id: 'turno-1',
      starts_at: ENTRADA,
      ends_at: null,
      status: 'open',
    });
  await evento('clock_in', ENTRADA);
});

type Fila = { attendance_state: string; break_started_at: string | null; shift_id: string | null };
const filas = async () => (await verComoGerente()) as Fila[];

describe('quién está dentro', () => {
  it('dice el motivo de la pausa abierta, para poder decir «Almorzando»', async () => {
    await evento('break_start', '2026-09-29T18:00:00.000Z', 'meal');
    const [enPausa] = (await verComoGerente()) as { break_reason: string | null }[];
    expect(enPausa?.break_reason).toBe('meal');

    // Al volver, el motivo se va con la pausa.
    await evento('break_end', '2026-09-29T19:00:00.000Z', 'meal');
    const [deVuelta] = (await verComoGerente()) as { break_reason: string | null }[];
    expect(deVuelta?.break_reason).toBeNull();
  });

  it('recién entrada, trabajando', async () => {
    const [fila] = await filas();
    expect(fila).toMatchObject({
      attendance_state: 'WORKING',
      break_started_at: null,
      shift_id: 'turno-1',
    });
  });

  it('en su refrigerio, en descanso y desde cuándo', async () => {
    await evento('break_start', '2026-09-29T18:00:00.000Z');
    const [fila] = await filas();
    expect(fila).toMatchObject({
      attendance_state: 'ON_BREAK',
      break_started_at: '2026-09-29T18:00:00.000Z',
    });
  });

  it('al volver del refrigerio, trabajando otra vez', async () => {
    await evento('break_start', '2026-09-29T18:00:00.000Z');
    await evento('break_end', '2026-09-29T19:00:00.000Z');
    const [fila] = await filas();
    expect(fila).toMatchObject({ attendance_state: 'WORKING', break_started_at: null });
  });

  it('manda la ÚLTIMA pausa: un segundo descanso tras uno ya cerrado', async () => {
    // Con el orden ascendente, tomar la primera pausa en vez de la última diría «trabajando».
    await evento('break_start', '2026-09-29T18:00:00.000Z');
    await evento('break_end', '2026-09-29T19:00:00.000Z');
    await evento('break_start', '2026-09-29T21:30:00.000Z');
    const [fila] = await filas();
    expect(fila).toMatchObject({
      attendance_state: 'ON_BREAK',
      break_started_at: '2026-09-29T21:30:00.000Z',
    });
  });
});
