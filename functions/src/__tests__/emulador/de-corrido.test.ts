import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { revisarJornadasDeLaSede } from '../../shared/turnos';

/**
 * LA JORNADA DE CORRIDO LLEGA A LA SESIÓN (7-oct). Turno de 10:00 a 19:00 con 1 h de
 * refrigerio: quien marca de 09:53 a 18:01 sin pausa trabajó sus 8 h y se fue antes por no
 * almorzar. Andree: «valen las 8 horas, haz que sea normal». La regla pura está probada en
 * `marcas.test.ts`; esto es lo otro: que el fichaje y el «poner al día» de las pantallas
 * escriban la marca sin `early_departure`, que es lo que leen Horas, Reportes, el bono,
 * Inicio, Equipo y el celular.
 */

const PROYECTO = 'demo-krealo-shift';
const ORG = 'org-corrido';
const SEDE = 'sede-corrido';
const PERSONA = 'emp-corrido';

// Lima, UTC-5: el martes 6-oct de 2026.
const H = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 9, 6, hora + 5, minuto)).toISOString();

async function marcar(tipo: 'clock_in' | 'clock_out', cuando: string) {
  await recordTimeEvent({
    organizationId: ORG,
    employeeId: PERSONA,
    locationId: SEDE,
    eventType: tipo,
    occurredAt: cuando,
    idempotencyKey: `${tipo}-${cuando}`,
    source: 'kiosk',
    shiftId: 't-corrido',
  });
}

async function ponerTurno(refrigerio: number | undefined) {
  await db
    .collection(COLLECTIONS.shifts)
    .doc('t-corrido')
    .set({
      id: 't-corrido',
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: H(10),
      ends_at: H(19),
      status: 'published',
      ...(refrigerio === undefined ? {} : { planned_unpaid_break_minutes: refrigerio }),
    });
}

const marcasDeLaJornada = async () =>
  ((
    await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()
  ).docs[0]?.data().flags as string[] | undefined) ?? [];

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
});

describe('jornada de corrido', () => {
  it('de 09:53 a 18:01 sin pausa, con 1 h de refrigerio en el turno: no «salió antes»', async () => {
    await ponerTurno(60);
    await marcar('clock_in', H(9, 53));
    await marcar('clock_out', H(18, 1));
    expect(await marcasDeLaJornada()).not.toContain('early_departure');
  });

  it('irse dos horas antes sin almorzar sí es salir antes', async () => {
    await ponerTurno(60);
    await marcar('clock_in', H(10));
    await marcar('clock_out', H(17));
    expect(await marcasDeLaJornada()).toContain('early_departure');
  });

  it('una jornada ya guardada como «salió antes» se corrige al poner al día la semana', async () => {
    // Antes de la regla: el turno sin refrigerio guardado, la marca queda puesta.
    await ponerTurno(undefined);
    await marcar('clock_in', H(9, 53));
    await marcar('clock_out', H(18, 1));
    expect(await marcasDeLaJornada()).toContain('early_departure');

    // Con el refrigerio en el turno, lo que hace abrir Horas, Horario, Reportes o Inicio.
    await ponerTurno(60);
    await revisarJornadasDeLaSede({ locationId: SEDE, desde: H(0), hasta: H(23, 59) });
    expect(await marcasDeLaJornada()).not.toContain('early_departure');
  });
});
