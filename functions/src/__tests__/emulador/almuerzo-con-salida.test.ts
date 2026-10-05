import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { revisarJornadasDeLaSede } from '../../shared/turnos';

/**
 * SALIR A ALMORZAR MARCANDO SALIDA Y VOLVER (5-oct). Con un turno de 10:00 a 19:00, quien
 * marca salida a las 13:00 y entrada a las 14:00 deja dos jornadas del mismo turno. Medida
 * cada una sola, la de la mañana «salió antes» y la de la tarde «llegó tarde», y eso quedaba
 * guardado. Lo que tiene que ser cierto: la tardanza solo en la primera, la salida antes solo
 * en la última, y que las de verdad se sigan marcando.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-almuerzo';
const SEDE = 'sede-almuerzo';
const PERSONA = 'emp-almuerzo';

// Lima, UTC-5: el lunes 21-sep de 2026.
const H = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, 21, hora + 5, minuto)).toISOString();

async function marcar(tipo: 'clock_in' | 'clock_out', cuando: string) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    source: 'kiosk',
    shiftId: 't-dia',
  });
}

const jornadas = async () =>
  (await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()).docs
    .map((d) => d.data())
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({
      id: SEDE,
      organization_id: ORG,
      timezone: 'America/Lima',
      settings: { lateGraceMinutes: 5 },
    });
  await db
    .collection(COLLECTIONS.shifts)
    .doc('t-dia')
    .set({
      id: 't-dia',
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: H(10),
      ends_at: H(19),
      status: 'published',
    });
});

describe('almorzar marcando salida', () => {
  it('a tiempo en la mañana y completa en la tarde: ninguna de las dos marcas', async () => {
    await marcar('clock_in', H(10));
    await marcar('clock_out', H(13));
    await marcar('clock_in', H(14));
    await marcar('clock_out', H(19));

    const [manana, tarde] = await jornadas();
    expect(manana).toMatchObject({ shift_id: 't-dia', ends_at: H(13) });
    expect(tarde).toMatchObject({ shift_id: 't-dia', starts_at: H(14) });
    expect(manana!.flags).not.toContain('early_departure');
    expect(manana!.flags).not.toContain('late_arrival');
    expect(tarde!.flags).not.toContain('late_arrival');
    expect(tarde!.flags).not.toContain('early_departure');
  });

  it('las de verdad se siguen marcando: llegó tarde por la mañana y se fue antes por la tarde', async () => {
    await marcar('clock_in', H(10, 30));
    await marcar('clock_out', H(13));
    await marcar('clock_in', H(14));
    await marcar('clock_out', H(18));

    const [manana, tarde] = await jornadas();
    expect(manana!.flags).toContain('late_arrival');
    expect(manana!.flags).not.toContain('early_departure');
    expect(tarde!.flags).not.toContain('late_arrival');
    expect(tarde!.flags).toContain('early_departure');
  });

  it('publicar la semana después no vuelve a poner las marcas', async () => {
    await marcar('clock_in', H(10));
    await marcar('clock_out', H(13));
    await marcar('clock_in', H(14));
    await marcar('clock_out', H(19));

    // Lo que hace publicar o «poner al día» Horas: vuelve a medir las jornadas de la sede.
    await revisarJornadasDeLaSede({ locationId: SEDE, desde: H(0), hasta: H(23, 59) });

    const [manana, tarde] = await jornadas();
    expect(manana!.flags).not.toContain('early_departure');
    expect(tarde!.flags).not.toContain('late_arrival');
  });

  it('una sola jornada en el turno se mide como siempre', async () => {
    await marcar('clock_in', H(10, 30));
    await marcar('clock_out', H(17));
    const [unica] = await jornadas();
    expect(unica!.flags).toEqual(expect.arrayContaining(['late_arrival', 'early_departure']));
  });
});
