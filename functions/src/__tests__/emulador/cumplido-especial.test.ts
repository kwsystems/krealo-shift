import { tipoDeCorreccion } from '../../correcciones';
import { creditShiftAsWorked, undoShiftCredit } from '../../cumplido-especial';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';

/**
 * Dar un turno por cumplido por un motivo especial (4-oct). Andree, el día de elecciones:
 * «la escogieron como miembro de mesa, quiero poner que sí cumplió su horario y que es
 * especial». Lo que se comprueba es lo que lo hace confiable en todas las pantallas: que
 * haya jornada DE VERDAD —con sus horas— que lleve el motivo, y que se pueda deshacer sin
 * dejar restos.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-especial';
const SEDE = 'sede-especial';
const GERENTE = 'uid-gerente-especial';
const VENDEDORA = 'uid-vendedora-especial';
const PERSONA = 'emp-especial';

// Lima, UTC-5. Ayer de 10:00 a 19:00, con 1 h de refrigerio: 8 h netas.
// El «ayer» de LIMA (8-oct): con el de UTC, entre las 00:00 y las 05:00 UTC «ayer a las 22:00
// de Lima» todavía no había llegado y la prueba fallaba según la hora a la que se corriera.
const ayer = new Date(Date.now() - (24 + 5) * 3600_000).toISOString().slice(0, 10);
const lima = (hora: number, minuto = 0) =>
  new Date(Date.parse(`${ayer}T00:00:00Z`) + (hora + 5) * 3600_000 + minuto * 60_000).toISOString();

const correr = (fn: unknown, uid: string, data: Record<string, unknown>): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
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

async function turno(id: string, desde: string, hasta: string) {
  await db.collection(COLLECTIONS.shifts).doc(id).set({
    id,
    organization_id: ORG,
    location_id: SEDE,
    employee_id: PERSONA,
    starts_at: desde,
    ends_at: hasta,
    status: 'published',
    publication_version: 1,
    planned_unpaid_break_minutes: 60,
  });
}

const fichajes = async () =>
  (await db.collection(COLLECTIONS.timeEvents).where('employee_id', '==', PERSONA).get()).docs;
const jornadas = async () =>
  (await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()).docs;

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, timezone: 'America/Lima', settings: {} });
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
  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${VENDEDORA}`).set({
    organization_id: ORG,
    user_id: VENDEDORA,
    role: 'employee',
    status: 'active',
    managed_location_ids: [],
  });
  await turno('t-elecciones', lima(10), lima(19));
});

describe('cumplido por motivo especial', () => {
  it('crea su jornada a la hora del turno, con sus horas y el motivo', async () => {
    await db.collection(COLLECTIONS.absenceResolutions).doc('t-elecciones').set({
      id: 't-elecciones',
      organization_id: ORG,
      location_id: SEDE,
      kind: 'justified',
      reason: 'other',
    });

    const respuesta = (await correr(creditShiftAsWorked, GERENTE, {
      p_shift_id: 't-elecciones',
      p_reason: 'election_duty',
      p_note: 'Mesa 12, colegio del barrio',
    })) as { minutos: number };
    expect(respuesta.minutos).toBe(480);

    const marcas = await fichajes();
    expect(marcas.map((d) => d.data().event_type).sort()).toEqual([
      'break_end',
      'break_start',
      'clock_in',
      'clock_out',
    ]);
    expect(marcas.every((d) => d.data().source === 'import')).toBe(true);

    const [sesion] = await jornadas();
    expect(sesion?.data()).toMatchObject({
      shift_id: 't-elecciones',
      starts_at: lima(10),
      ends_at: lima(19),
      net_minutes: 480,
      status: 'complete',
      source: 'import',
      credit_reason: 'election_duty',
      credit_note: 'Mesa 12, colegio del barrio',
      flags: [],
    });

    // Reportes la cuenta aparte, como «cumplido especial».
    const correcciones = await db
      .collection(COLLECTIONS.timeAdjustments)
      .where('employee_id', '==', PERSONA)
      .get();
    expect(correcciones.docs.map((d) => tipoDeCorreccion(d.data()))).toEqual(['cumplido_especial']);

    // Lo que se había dicho de su falta sobra: la falta ya no existe.
    expect(
      (await db.collection(COLLECTIONS.absenceResolutions).doc('t-elecciones').get()).exists,
    ).toBe(false);
  });

  it('el motivo sobrevive a que la jornada se vuelva a armar', async () => {
    await correr(creditShiftAsWorked, GERENTE, {
      p_shift_id: 't-elecciones',
      p_reason: 'election_duty',
    });
    // Cualquier fichaje posterior vuelve a armar las jornadas de la persona.
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_in',
      occurredAt: new Date().toISOString(),
      idempotencyKey: 'entrada-de-hoy',
    });
    const especial = (await jornadas()).find((d) => d.data().starts_at === lima(10));
    expect(especial?.data().credit_reason).toBe('election_duty');
  });

  it('dos veces no duplica: la segunda lo dice', async () => {
    await correr(creditShiftAsWorked, GERENTE, {
      p_shift_id: 't-elecciones',
      p_reason: 'training',
    });
    const segunda = await fallo(
      correr(creditShiftAsWorked, GERENTE, { p_shift_id: 't-elecciones', p_reason: 'training' }),
    );
    expect(segunda.details).toEqual({ motivo: 'YA_CUMPLIDO' });
    expect(await fichajes()).toHaveLength(4);
  });

  it('se deshace sin dejar restos, y se puede volver a hacer', async () => {
    await correr(creditShiftAsWorked, GERENTE, {
      p_shift_id: 't-elecciones',
      p_reason: 'election_duty',
    });
    await correr(undoShiftCredit, GERENTE, { p_shift_id: 't-elecciones' });
    expect(await fichajes()).toHaveLength(0);
    expect(await jornadas()).toHaveLength(0);
    // Ni su corrección: Reportes la seguía contando (auditoría, 4-oct).
    const correcciones = await db.collection(COLLECTIONS.timeAdjustments).get();
    expect(
      correcciones.docs.filter((doc) => doc.data().after_value?.origen === 'especial'),
    ).toHaveLength(0);

    const otraVez = await fallo(correr(undoShiftCredit, GERENTE, { p_shift_id: 't-elecciones' }));
    expect(otraVez.details).toEqual({ motivo: 'NO_CUMPLIDO' });

    await correr(creditShiftAsWorked, GERENTE, {
      p_shift_id: 't-elecciones',
      p_reason: 'offsite_work',
    });
    expect((await jornadas())[0]?.data().credit_reason).toBe('offsite_work');
  });

  it('un turno que no ha terminado no se puede dar por cumplido', async () => {
    const ahora = Date.now();
    await turno(
      't-en-curso',
      new Date(ahora - 3600_000).toISOString(),
      new Date(ahora + 3600_000).toISOString(),
    );
    const resultado = await fallo(
      correr(creditShiftAsWorked, GERENTE, { p_shift_id: 't-en-curso', p_reason: 'training' }),
    );
    expect(resultado.details).toEqual({ motivo: 'NO_TERMINO' });
  });

  it('si ya marcó ese día, no pisa nada: eso se corrige en Horas', async () => {
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_in',
      occurredAt: lima(15),
      idempotencyKey: 'llego-despues',
    });
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_out',
      occurredAt: lima(19),
      idempotencyKey: 'salio',
    });
    const resultado = await fallo(
      correr(creditShiftAsWorked, GERENTE, { p_shift_id: 't-elecciones', p_reason: 'training' }),
    );
    expect(resultado.details).toEqual({ motivo: 'CON_MARCAS' });
    expect(await fichajes()).toHaveLength(2);
  });

  /*
   * EL TURNO PARTIDO: trabajó por la mañana y no vino al cierre. Una salida a menos de una hora
   * del turno no puede impedir darlo por cumplido: es de otra jornada. Lo encontró el arnés.
   */
  it('trabajó la mañana y faltó al cierre: el cierre se puede dar por cumplido', async () => {
    await turno('t-cierre', lima(19, 30), lima(22, 0));
    for (const [tipo, hora, clave] of [
      ['clock_in', lima(9, 0), 'manana-entra'],
      ['clock_out', lima(19, 0), 'manana-sale'],
    ] as const) {
      await recordTimeEvent({
        organizationId: ORG,
        employeeId: PERSONA,
        locationId: SEDE,
        eventType: tipo,
        occurredAt: hora,
        idempotencyKey: clave,
      });
    }
    await db.collection(COLLECTIONS.shifts).doc('t-elecciones').delete();
    const respuesta = (await correr(creditShiftAsWorked, GERENTE, {
      p_shift_id: 't-cierre',
      p_reason: 'election_duty',
    })) as { minutos: number };
    // 2 h 30 del turno menos la hora de refrigerio que lleva todo turno de esta prueba.
    expect(respuesta.minutos).toBe(90);
    const cierre = (await jornadas()).find((d) => d.data().starts_at === lima(19, 30));
    expect(cierre?.data().credit_reason).toBe('election_duty');
  });

  it('«Otro» pide escribir qué pasó, y un motivo inventado no vale', async () => {
    expect(
      (
        await fallo(
          correr(creditShiftAsWorked, GERENTE, { p_shift_id: 't-elecciones', p_reason: 'other' }),
        )
      ).details,
    ).toEqual({ motivo: 'NOTA' });
    expect(
      (
        await fallo(
          correr(creditShiftAsWorked, GERENTE, { p_shift_id: 't-elecciones', p_reason: 'fiesta' }),
        )
      ).details,
    ).toEqual({ motivo: 'MOTIVO' });
  });

  it('una cuenta de empleado no puede darse turnos por cumplidos', async () => {
    const resultado = await fallo(
      correr(creditShiftAsWorked, VENDEDORA, {
        p_shift_id: 't-elecciones',
        p_reason: 'election_duty',
      }),
    );
    expect(resultado.code).toBe('permission-denied');
    expect(await fichajes()).toHaveLength(0);
  });
});
