import bcrypt from 'bcryptjs';

import { submitTimeEvent, verifyPin } from '../../kiosk-api';
import { politicasDe } from '../../shared/politicas';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * El motivo de la salida anticipada, de punta a punta.
 *
 * NO COMPRUEBA QUE EL CAMPO EXISTA, comprueba que LLEGA. El proyecto ya se comio cinco
 * campos que estaban declarados en los dos lados y no los llenaba nadie —`flags`,
 * `shiftEndsAt`, `openBreak`, `jobRoleName` y `paidBreakReasons`—, y todos compilaban.
 * Lo unico que distingue un campo vivo de uno muerto es una prueba que escriba por un
 * extremo y lea por el otro, asi que eso es lo que hace esta: manda el motivo como lo
 * manda el reloj y lo busca en el evento Y en la sesion, que es de donde lo lee la hoja
 * de horas del gerente.
 */

const ORG = 'org-salida';
const SEDE = 'sede-salida';
const APARATO = 'aparato-s';
const PUBLICO = 'publico-s';
const CREDENCIAL = 'credencial-del-aparato-de-salidas';
const PIN = '8765';
const PERSONA = 'persona-que-sale';
const PROYECTO = 'demo-krealo-shift';

const correr = (fn: unknown, data: unknown): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: {},
  });

const kioskAuth = { devicePublicId: PUBLICO, credential: CREDENCIAL };

async function tokenDeAccion(): Promise<string> {
  const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as { actionToken: string };
  return contexto.actionToken;
}

const eventoDe = async (tipo: string): Promise<Record<string, unknown>> => {
  const snapshot = await db
    .collection(COLLECTIONS.timeEvents)
    .where('event_type', '==', tipo)
    .get();
  const doc = snapshot.docs[0];
  if (doc === undefined) throw new Error(`no hay ningun evento «${tipo}»`);
  return doc.data();
};

const sesion = async (): Promise<Record<string, unknown>> => {
  const snapshot = await db.collection(COLLECTIONS.workSessions).get();
  const doc = snapshot.docs[0];
  if (doc === undefined) throw new Error('no hay sesion de trabajo');
  return doc.data();
};

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await db
    .collection(COLLECTIONS.locations)
    .doc(SEDE)
    .set({ id: SEDE, organization_id: ORG, name: 'Sede', timezone: 'America/Lima', settings: {} });
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
    .set({ id: PERSONA, organization_id: ORG, full_name: 'Quien Sale', status: 'active' });
  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(PERSONA)
    .set({ employee_id: PERSONA, pin_hash: bcrypt.hashSync(PIN, 4) });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
});

async function jornada(datosDeSalida: Record<string, unknown>): Promise<void> {
  await correr(submitTimeEvent, {
    kioskAuth,
    actionToken: await tokenDeAccion(),
    eventType: 'clock_in',
    idempotencyKey: 'entrada',
  });
  await correr(submitTimeEvent, {
    kioskAuth,
    actionToken: await tokenDeAccion(),
    eventType: 'clock_out',
    idempotencyKey: 'salida',
    ...datosDeSalida,
  });
}

describe('el motivo de la salida anticipada', () => {
  it('llega al evento y a la sesion, que es donde lo lee el gerente', async () => {
    await jornada({ departureReason: 'errand', departureNote: 'al almacen de Surco' });

    const salida = await eventoDe('clock_out');
    expect(salida.departure_reason).toBe('errand');
    expect(salida.departure_note).toBe('al almacen de Surco');

    const proyeccion = await sesion();
    expect(proyeccion.departure_reason).toBe('errand');
    expect(proyeccion.departure_note).toBe('al almacen de Surco');
  });

  /**
   * El caso normal es no preguntar: solo se pregunta pasado el umbral de la sede. Una
   * salida sin motivo tiene que quedar en `null` y no en `undefined` ni en `''`, porque
   * el esquema del panel lo lee como `string | null`.
   */
  it('una salida sin motivo deja null, no un hueco', async () => {
    await jornada({});

    expect((await eventoDe('clock_out')).departure_reason).toBeNull();
    expect((await sesion()).departure_reason).toBeNull();
  });

  /**
   * LA ENTRADA NO LLEVA MOTIVO DE SALIDA aunque el reloj lo mande por error. Si se
   * guardara, un reporte que agrupe por motivo contaria salidas que nunca ocurrieron.
   */
  it('una ENTRADA no se queda con el motivo aunque se lo manden', async () => {
    await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'entrada-con-motivo',
      departureReason: 'errand',
    });

    expect((await eventoDe('clock_in')).departure_reason).toBeNull();
  });
});

/**
 * El umbral y los motivos pagados de la sede, que viajan al reloj en el mismo sitio.
 *
 * `paidBreakReasons` es el quinto campo muerto del proyecto: el reloj lo declaraba, lo
 * leia al pausar y NADIE lo llenaba. Salio al tender este mismo cable.
 */
describe('politicasDe', () => {
  it('lleva el umbral que configuro la sede', () => {
    const politicas = politicasDe({ settings: { earlyDepartureReasonMinutes: 45 } });
    expect(politicas.earlyDepartureReasonMinutes).toBe(45);
  });

  it('sin configurar, el umbral es el de fabrica', () => {
    expect(politicasDe({}).earlyDepartureReasonMinutes).toBe(30);
  });

  it('lleva los motivos de pausa que la sede marco como trabajados', () => {
    const politicas = politicasDe({ settings: { paidBreakReasons: { meal: true } } });
    expect(politicas.paidBreakReasons).toEqual({ meal: true });
  });

  it('descarta claves inventadas y valores que no son booleanos', () => {
    const politicas = politicasDe({
      settings: { paidBreakReasons: { meal: true, inventado: true, rest: 'si' } },
    });
    expect(politicas.paidBreakReasons).toEqual({ meal: true });
  });

  it('sin configurar devuelve vacio, para que mande el valor de fabrica del cliente', () => {
    expect(politicasDe({}).paidBreakReasons).toEqual({});
  });
});
