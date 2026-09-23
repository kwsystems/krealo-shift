import { publishShiftsForWeek } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Publicar el horario, y que la etiqueta «Cambiado» pueda salir algun dia.
 *
 * LO QUE ESTO PRUEBA NO ES QUE SE PUBLIQUE —eso ya funcionaba— sino que el turno SE
 * QUEDA CON SU VERSION. La pantalla decide la etiqueta asi:
 *
 *     shift.status === 'draft' && shift.publication_version > 0
 *
 * o sea «esto ya estuvo publicado y ahora vuelve a ser borrador». El cliente nunca
 * escribia esa version en el turno, asi que la condicion no se cumplia jamas: un turno
 * movido DESPUES de publicarlo se veia igual que uno nuevo. En la demostracion si salia,
 * porque la semilla la escribe a mano.
 *
 * Por eso la ultima prueba de aqui recorre el ciclo entero —publicar, editar, mirar la
 * condicion— en vez de comprobar solo que el campo se escriba.
 */

const ORG = 'org-publicar';
const SEDE = 'sede-publicar';
const OTRA = 'otra-sede-publicar';
const GERENTE = 'uid-gerente-publicar';
const SEMANA = '2026-09-21';
const PROYECTO = 'demo-krealo-shift';

const correr = (fn: unknown, data: unknown, uid?: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === undefined ? undefined : { uid, token: {} },
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

const turno = async (id: string, extra: Record<string, unknown> = {}) => {
  await db
    .collection(COLLECTIONS.shifts)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: 'quien-sea',
      starts_at: '2026-09-21T13:00:00.000Z',
      ends_at: '2026-09-21T21:00:00.000Z',
      status: 'draft',
      publication_version: 0,
      published_at: null,
      updated_at: '',
      ...extra,
    });
};

const leer = async (id: string): Promise<Record<string, unknown>> =>
  (await db.collection(COLLECTIONS.shifts).doc(id).get()).data() ?? {};

/*
 * ORDENADAS POR VERSION. Sin `orderBy`, Firestore no promete ningun orden y `[1]` no es
 * «la segunda publicacion» sino «la que salga segunda», que es otra cosa. La prueba
 * fallaba por eso, no por el codigo.
 */
const publicaciones = async (): Promise<Record<string, unknown>[]> =>
  (
    await db.collection(COLLECTIONS.shiftPublications).orderBy('publication_version', 'asc').get()
  ).docs.map((d) => d.data());

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  for (const id of [SEDE, OTRA]) {
    await db
      .collection(COLLECTIONS.locations)
      .doc(id)
      .set({ id, organization_id: ORG, name: id, timezone: 'America/Lima', settings: {} });
  }
  await db
    .collection(COLLECTIONS.memberships)
    .doc(`${ORG}_${GERENTE}`)
    .set({
      user_id: GERENTE,
      organization_id: ORG,
      role: 'manager',
      status: 'active',
      managed_location_ids: [SEDE],
    });
});

/*
 * `null` PARA «SIN SESION», no `undefined`. Pasar `undefined` activa el valor por defecto
 * del parametro, asi que la prueba de «sin sesion» llamaba como gerente y pasaba sin
 * probar nada. Es un fallo de la prueba y no del codigo, y del tipo que se ve solo cuando
 * falla: si el codigo hubiera estado mal, esta prueba lo habria dado por bueno.
 */
const publicar = (ids: string[], uid: string | null = GERENTE) =>
  correr(
    publishShiftsForWeek,
    { p_location_id: SEDE, p_week_start: SEMANA, p_shift_ids: ids },
    uid ?? undefined,
  );

describe('publishShiftsForWeek', () => {
  it('publica y SELLA la version en el turno, que es lo que faltaba', async () => {
    await turno('t1');
    const r = (await publicar(['t1'])) as { version: number; publicados: number };

    expect(r).toEqual({ version: 1, publicados: 1 });
    const t = await leer('t1');
    expect(t.status).toBe('published');
    expect(t.publication_version).toBe(1);
    expect(typeof t.published_at).toBe('string');
  });

  it('deja la fila de publicacion con los turnos que cambiaron', async () => {
    await turno('t1');
    await turno('t2');
    await publicar(['t1', 't2']);

    const pubs = await publicaciones();
    expect(pubs).toHaveLength(1);
    expect(pubs[0]?.publication_version).toBe(1);
    expect(pubs[0]?.published_by).toBe(GERENTE);
    expect(pubs[0]?.changed_shift_ids).toEqual(['t1', 't2']);
  });

  it('la segunda publicacion de la semana es la version 2', async () => {
    await turno('t1');
    await publicar(['t1']);
    await turno('t2');
    const r = (await publicar(['t2'])) as { version: number };

    expect(r.version).toBe(2);
    expect((await leer('t2')).publication_version).toBe(2);
    // Y el primero se queda con la suya: publicar de nuevo no resella lo ya publicado.
    expect((await leer('t1')).publication_version).toBe(1);
  });

  it('un turno ya publicado no se resella: subirle la version no significaria nada', async () => {
    await turno('t1');
    await publicar(['t1']);
    await turno('t2');
    await publicar(['t1', 't2']);

    expect((await leer('t1')).publication_version).toBe(1);
    expect((await publicaciones())[1]?.changed_shift_ids).toEqual(['t2']);
  });

  it('si ninguno estaba en borrador, falla en vez de crear una publicacion vacia', async () => {
    await turno('t1', { status: 'published', publication_version: 1 });
    expect(await codigoDelFallo(publicar(['t1']))).toBe('failed-precondition');
    expect(await publicaciones()).toHaveLength(0);
  });

  /**
   * NO SE CONFIA EN LA LISTA QUE MANDA EL CLIENTE. Sin esta comprobacion, quien gestiona
   * una tienda podria publicar —y sellar— turnos de otra pasando sus ids.
   */
  it('un turno de otra sede no se puede publicar desde esta', async () => {
    await turno('ajeno', { location_id: OTRA });
    expect(await codigoDelFallo(publicar(['ajeno']))).toBe('permission-denied');
    expect((await leer('ajeno')).status).toBe('draft');
  });

  it('quien no manda en esa sede no publica', async () => {
    await turno('t1');
    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_otro`)
      .set({
        user_id: 'otro',
        organization_id: ORG,
        role: 'manager',
        status: 'active',
        managed_location_ids: [OTRA],
      });
    expect(await codigoDelFallo(publicar(['t1'], 'otro'))).toBe('permission-denied');
  });

  it('sin sesion no se publica', async () => {
    await turno('t1');
    expect(await codigoDelFallo(publicar(['t1'], null))).toBe('unauthenticated');
  });

  it('una lista vacia se rechaza', async () => {
    expect(await codigoDelFallo(publicar([]))).toBe('invalid-argument');
  });
});

/**
 * EL CICLO COMPLETO, que es la razon de ser de toda la tarea: publicar, mover el turno, y
 * comprobar la condicion EXACTA que la pantalla usa para la etiqueta «Cambiado».
 */
describe('la etiqueta «Cambiado»', () => {
  it('ya puede salir: un turno movido tras publicarlo cumple la condicion', async () => {
    await turno('t1');
    await publicar(['t1']);

    // Editar deja el turno en borrador y CONSERVA su version (lo hace `updateShift`).
    await db
      .collection(COLLECTIONS.shifts)
      .doc('t1')
      .update({ status: 'draft', starts_at: '2026-09-21T15:00:00.000Z' });

    const t = await leer('t1');
    // `shift-card.tsx`: isChanged = status === 'draft' && publication_version > 0
    expect(t.status).toBe('draft');
    expect(Number(t.publication_version)).toBeGreaterThan(0);
  });

  it('y un borrador nuevo NO la cumple: la etiqueta distingue las dos cosas', async () => {
    await turno('nuevo');
    const t = await leer('nuevo');
    expect(t.status).toBe('draft');
    expect(Number(t.publication_version)).toBe(0);
  });
});
