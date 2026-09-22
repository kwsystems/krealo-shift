import bcrypt from 'bcryptjs';

import { submitTimeEvent, verifyPin } from '../../kiosk-api';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * Que las marcas lleguen A LA SESION, no solo que se calculen bien.
 *
 * `marcas.test.ts` fija la decisión —cuándo es tarde, cuándo es pronto— sin Firestore
 * delante. Esto es lo otro: que `rebuildWorkSession` lea el turno y la sede, llame a esa
 * decisión y ESCRIBA el resultado. Hasta el 2026-09-22 escribía `flags: []` fijo, así
 * que la lógica podía ser perfecta y la pantalla seguir vacía. Una prueba de la función
 * pura sola no habría visto nada.
 *
 * El turno se siembra RELATIVO A AHORA porque la hora del fichaje la pone el servidor y
 * no se puede fingir: un turno que empezó hace dos horas convierte el fichaje de entrada
 * de esta prueba en una entrada tardía, corra a la hora que corra.
 */

const ORG = 'org-marcas';
const SEDE = 'sede-marcas';
const APARATO = 'aparato-m';
const PUBLICO = 'publico-m';
const CREDENCIAL = 'credencial-del-aparato-de-marcas';
const PIN = '8765';
const PERSONA = 'persona-marcada';
const TURNO = 'turno-de-hoy';
const PROYECTO = 'demo-krealo-shift';

const HORA = 60 * 60 * 1000;
const desdeAhora = (ms: number) => new Date(Date.now() + ms).toISOString();

const correr = (fn: unknown, data: unknown): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({ data, auth: undefined, rawRequest: {} });

const kioskAuth = { devicePublicId: PUBLICO, credential: CREDENCIAL };

async function tokenDeAccion(): Promise<string> {
  const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as { actionToken: string };
  return contexto.actionToken;
}

async function fichar(eventType: string, clave: string, shiftId: string | null): Promise<void> {
  await correr(submitTimeEvent, {
    kioskAuth,
    actionToken: await tokenDeAccion(),
    eventType,
    idempotencyKey: clave,
    shiftId,
  });
}

async function marcasDeLaSesion(): Promise<string[]> {
  const sesiones = await db
    .collection(COLLECTIONS.workSessions)
    .where('employee_id', '==', PERSONA)
    .get();
  const sesion = sesiones.docs[0]?.data();
  return ((sesion?.flags as string[] | undefined) ?? []).map(String);
}

async function ponerTurno(inicioMs: number, finMs: number): Promise<void> {
  await db
    .collection(COLLECTIONS.shifts)
    .doc(TURNO)
    .set({
      id: TURNO,
      organization_id: ORG,
      location_id: SEDE,
      employee_id: PERSONA,
      starts_at: desdeAhora(inicioMs),
      ends_at: desdeAhora(finMs),
      status: 'published',
    });
}

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
      name: 'Sede',
      timezone: 'America/Lima',
      settings: { lateGraceMinutes: 5 },
    });
  await db.collection(COLLECTIONS.kioskDevices).doc(APARATO).set({
    id: APARATO,
    organization_id: ORG,
    location_id: SEDE,
    device_public_id: PUBLICO,
    status: 'active',
    pin_failed_attempts: 0,
    pin_locked_until: null,
    pin_last_failed_at: null,
  });
  await db
    .collection(COLLECTIONS.kioskDeviceSecrets)
    .doc(APARATO)
    .set({ credential_hash: bcrypt.hashSync(CREDENCIAL, 4) });
  await db
    .collection(COLLECTIONS.employees)
    .doc(PERSONA)
    .set({ id: PERSONA, organization_id: ORG, full_name: 'Quien Ficha', status: 'active' });
  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(PERSONA)
    .set({ employee_id: PERSONA, pin_hash: bcrypt.hashSync(PIN, 4) });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
});

describe('las marcas llegan a la sesión de trabajo', () => {
  /** El caso de Andree: turno hasta las 22:00 y se va a las 17:00. */
  it('quien llega tarde y se va pronto queda marcado con las dos cosas', async () => {
    await ponerTurno(-2 * HORA, 5 * HORA);

    await fichar('clock_in', 'entrada-tarde', TURNO);
    expect(await marcasDeLaSesion()).toEqual(['late_arrival']);

    await fichar('clock_out', 'salida-pronto', TURNO);
    const marcas = await marcasDeLaSesion();
    expect(marcas).toContain('late_arrival');
    expect(marcas).toContain('early_departure');
  });

  /**
   * EL CONTROL QUE HACE QUE LO DE ARRIBA SIGNIFIQUE ALGO. Si una sesión puntual también
   * saliera marcada, la marca no distinguiría nada y el gerente aprendería a ignorarla.
   */
  it('quien ficha a su hora no queda marcado', async () => {
    await ponerTurno(0, 8 * HORA);

    await fichar('clock_in', 'entrada-puntual', TURNO);
    expect(await marcasDeLaSesion()).toEqual([]);
  });

  it('quien ficha sin turno queda marcado como «sin turno programado»', async () => {
    await fichar('clock_in', 'entrada-sin-turno', null);
    expect(await marcasDeLaSesion()).toEqual(['unscheduled']);
  });

  /** Sigue dentro: no es una salida anticipada, es alguien trabajando. */
  it('una sesión abierta no se marca como salida anticipada', async () => {
    await ponerTurno(0, 8 * HORA);

    await fichar('clock_in', 'entrada-abierta', TURNO);
    expect(await marcasDeLaSesion()).not.toContain('early_departure');
  });
});
