import { viewBreakTimeByReason, viewDailyTimeSummary } from '../../views';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * La zona horaria de la sede decide a que DIA pertenece cada jornada.
 *
 * DE DONDE SALE. Andree, 2026-09-23: dos sedes en Peru y tres en Canada. Hasta ese dia
 * la zona solo se podia poner en la EMPRESA, asi que todas las sedes compartian una y
 * las de Canada habrian agrupado sus jornadas por el dia de Lima.
 *
 * LO QUE SE COMPRUEBA AQUI no es que el campo se guarde —eso lo cubre el validador— sino
 * que DOS SEDES CON ZONAS DISTINTAS PARTEN EL DIA EN SITIOS DISTINTOS. Es lo unico que
 * demuestra que el campo sirve para algo, y es tambien lo que acaba en el reporte que se
 * usa para pagar.
 */

const ORG = 'org-zonas';
const LIMA = 'sede-lima';
const TORONTO = 'sede-toronto';
const GERENTE = 'uid-gerente-zonas';
const PERSONA_LIMA = 'persona-lima';
const PERSONA_TORONTO = 'persona-toronto';
const PROYECTO = 'demo-krealo-shift';

const correr = (fn: unknown, data: unknown, uid?: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === undefined ? undefined : { uid, token: {} },
    rawRequest: {},
  });

/**
 * 04:30 UTC del 23 de julio: en Toronto (UTC-4 en verano) ya es el dia 23; en Lima
 * (UTC-5 todo el año) sigue siendo el 22. Es la hora exacta que separa los dos dias, y
 * en enero NO los separaria: por eso este fallo aparece medio año y desaparece el otro.
 */
const ENTRADA = '2026-07-23T04:30:00.000Z';
const SALIDA = '2026-07-23T08:30:00.000Z';

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db.collection(COLLECTIONS.locations).doc(LIMA).set({
    id: LIMA,
    organization_id: ORG,
    name: 'Tutu Lima',
    timezone: 'America/Lima',
    settings: {},
  });
  await db.collection(COLLECTIONS.locations).doc(TORONTO).set({
    id: TORONTO,
    organization_id: ORG,
    name: 'Toutou Toronto',
    timezone: 'America/Toronto',
    settings: {},
  });

  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${GERENTE}`)
    .set({
      user_id: GERENTE,
      organization_id: ORG,
      role: 'owner',
      status: 'active',
      managed_location_ids: [LIMA, TORONTO],
    });

  /*
   * LAS SESIONES SE ESCRIBEN DIRECTAMENTE, no pasando por `recordTimeEvent`.
   *
   * No es un atajo: `rebuildWorkSession` solo mira las ultimas 36 horas, asi que una
   * jornada de julio no produciria ninguna sesion y la prueba mediria una consulta
   * vacia. Y lo que hay que comprobar es como AGRUPA la vista, que lee `work_sessions`
   * y nada mas. Atar la prueba a «hoy menos 36 horas» la haria fallar sola con el
   * tiempo, que es peor que no tenerla.
   */
  for (const [persona, sede] of [
    [PERSONA_LIMA, LIMA],
    [PERSONA_TORONTO, TORONTO],
  ] as const) {
    await db
      .collection(COLLECTIONS.employees)
      .doc(persona)
      .set({ id: persona, organization_id: ORG, full_name: persona, status: 'active' });
    await db
      .collection(COLLECTIONS.employeeLocations)
      .doc(`${persona}_${sede}`)
      .set({ employee_id: persona, location_id: sede, organization_id: ORG });

    await db
      .collection(COLLECTIONS.workSessions)
      .doc(`${persona}_${ENTRADA}`)
      .set({
        id: `${persona}_${ENTRADA}`,
        organization_id: ORG,
        employee_id: persona,
        location_id: sede,
        shift_id: null,
        starts_at: ENTRADA,
        ends_at: SALIDA,
        gross_minutes: 240,
        paid_break_minutes: 0,
        unpaid_break_minutes: 0,
        net_minutes: 240,
        status: 'complete',
        flags: [],
        updated_at: SALIDA,
      });
  }
});

/**
 * Las vistas no reciben parametros con nombre: reciben la peticion del shim de
 * PostgREST, con sus filtros. Se arma igual que la manda el cliente.
 */
const peticion = (sede: string) => ({
  filters: [
    { field: 'location_id', op: 'eq', value: sede },
    { field: 'work_date', op: 'gte', value: '2026-07-20' },
    { field: 'work_date', op: 'lte', value: '2026-07-26' },
  ],
});

const diasDe = async (sede: string): Promise<string[]> => {
  const filas = (await correr(viewDailyTimeSummary, peticion(sede), GERENTE)) as {
    work_date: string;
  }[];
  return filas.map((f) => f.work_date);
};

describe('la zona horaria de la sede', () => {
  it('la MISMA hora cae en dias distintos segun la sede', async () => {
    expect(await diasDe(LIMA)).toEqual(['2026-07-22']);
    expect(await diasDe(TORONTO)).toEqual(['2026-07-23']);
  });

  /**
   * EL CASO DE HOY, que es el que hay que evitar: si la sede de Toronto no trajera zona
   * propia —como pasaba antes de poder editarla— caeria en el dia de Lima.
   */
  it('una sede SIN zona propia agrupa por la de Lima, que es el fallo que se arreglo', async () => {
    await db.collection(COLLECTIONS.locations).doc(TORONTO).update({ timezone: 'America/Lima' });
    expect(await diasDe(TORONTO)).toEqual(['2026-07-22']);
  });

  /**
   * Y LA RED DE ABAJO. Una zona mal escrita en la base LANZABA, y no estropeaba una fila:
   * tumbaba la consulta entera de la semana. Ahora se cae a UTC y lo deja registrado.
   */
  it('una zona invalida en la base NO tumba la consulta: se agrupa en UTC', async () => {
    await db.collection(COLLECTIONS.locations).doc(TORONTO).update({ timezone: 'America/Nowhere' });

    // En UTC las 04:30 del 23 son del dia 23.
    expect(await diasDe(TORONTO)).toEqual(['2026-07-23']);
  });

  it('una zona vacia tampoco la tumba', async () => {
    await db.collection(COLLECTIONS.locations).doc(TORONTO).update({ timezone: '' });
    expect(await diasDe(TORONTO)).toEqual(['2026-07-23']);
  });

  /** Y la otra vista que agrupa por dia, por el mismo camino. */
  it('el reporte de pausas usa la misma zona sin reventar', async () => {
    await db.collection(COLLECTIONS.locations).doc(TORONTO).update({ timezone: 'America/Nowhere' });

    const filas = (await correr(viewBreakTimeByReason, peticion(TORONTO), GERENTE)) as unknown[];
    expect(Array.isArray(filas)).toBe(true);
  });
});
