import bcrypt from 'bcryptjs';

import { submitTimeEvent, verifyPin } from '../../kiosk-api';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * `submitTimeEvent`, que es el unico motivo por el que la aplicacion existe (§8, §11).
 *
 * DOS COSAS QUE YA SALIERON MAL AQUI, y las dos se pagan en dinero:
 *
 *   1. LA FORMA DE LA RESPUESTA. Devolvia `{eventId, duplicated, attendanceState,
 *      session}` y el esquema del reloj exige ademas `status`, `occurredAt`,
 *      `serverReceivedAt`, `flags` y `summary`. O sea que TODO fichaje quedaba escrito
 *      en la base y el iPad lo daba por fallido: la persona veia «No pudimos completar
 *      la accion» despues de haber fichado de verdad, y lo volvia a intentar. Arreglado
 *      en fd65ea0 y desplegado el 22-sep; esto es lo que impide que vuelva.
 *
 *   2. LA IDEMPOTENCIA. Es la otra mitad de lo mismo: si el iPad reintenta —y reintenta,
 *      porque creia que habia fallado— la misma clave tiene que devolver el evento
 *      original en vez de crear otro. Sin eso la persona aparece fichando dos entradas
 *      seguidas y sus horas del dia se duplican.
 *
 * Se ficha de verdad: PIN, token de accion y evento, como el reloj.
 */

const ORG = 'org-fichajes';
const SEDE = 'sede-fichajes';
const APARATO = 'aparato-f';
const PUBLICO = 'publico-f';
const CREDENCIAL = 'credencial-del-aparato-de-fichajes';
const PIN = '4321';
const PERSONA = 'persona-que-ficha';
const PROYECTO = 'demo-krealo-shift';

const correr = (fn: unknown, data: unknown): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: {},
  });

const kioskAuth = { devicePublicId: PUBLICO, credential: CREDENCIAL };

/** El token de accion dura 90 segundos y lo emite el PIN: se pide uno nuevo por prueba. */
async function tokenDeAccion(): Promise<string> {
  const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as { actionToken: string };
  return contexto.actionToken;
}

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

const eventos = async (): Promise<number> =>
  (await db.collection(COLLECTIONS.timeEvents).get()).size;

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

describe('submitTimeEvent', () => {
  it('registra una entrada y devuelve TODO lo que el reloj valida', async () => {
    const respuesta = (await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'clave-1',
    })) as Record<string, unknown>;

    /*
     * Se comprueban los campos UNO A UNO y no «que no lance», porque el fallo que esto
     * vigila era exactamente eso: la funcion no lanzaba, escribia el fichaje, y el iPad
     * rechazaba la respuesta por incompleta.
     */
    expect(respuesta.status).toBe('accepted');
    expect(typeof respuesta.eventId).toBe('string');
    expect(respuesta.attendanceState).toBe('WORKING');
    expect(typeof respuesta.occurredAt).toBe('string');
    expect(typeof respuesta.serverReceivedAt).toBe('string');
    expect(Array.isArray(respuesta.flags)).toBe(true);
    expect(respuesta.summary).toEqual({ shiftEndsAt: null, netMinutesToday: 0 });

    expect(await eventos()).toBe(1);
  });

  /** El doble toque, el reintento tras una red a medias, el lote que se sincroniza dos veces. */
  it('la misma clave dos veces NO duplica el fichaje', async () => {
    const primero = (await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'la-misma',
    })) as Record<string, unknown>;

    const segundo = (await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'la-misma',
    })) as Record<string, unknown>;

    expect(primero.status).toBe('accepted');
    expect(segundo.status).toBe('duplicate');
    expect(segundo.eventId).toBe(primero.eventId);
    expect(await eventos()).toBe(1);
  });

  /**
   * Y CLAVES DISTINTAS SI CREAN DOS, que es la otra mitad: una idempotencia que
   * colapsara todo en uno se veria igual de bien en la prueba de arriba y perderia
   * fichajes de verdad.
   */
  it('claves distintas registran fichajes distintos', async () => {
    await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'clave-a',
    });
    await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'break_start',
      idempotencyKey: 'clave-b',
    });

    expect(await eventos()).toBe(2);
  });

  /**
   * LA HORA LA PONE EL SERVIDOR. Un iPad con la hora cambiada a mano seria una hora de
   * entrada cambiada a mano, y eso es dinero. Lo que manda el aparato se guarda aparte,
   * para poder comparar.
   */
  it('la hora del fichaje es la del servidor, no la que mande el aparato', async () => {
    const mentira = '2020-01-01T00:00:00.000Z';
    const respuesta = (await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'clave-hora',
      occurredAt: mentira,
      occurredAtDevice: mentira,
    })) as Record<string, unknown>;

    expect(respuesta.occurredAt).not.toBe(mentira);
    expect(new Date(String(respuesta.occurredAt)).getFullYear()).toBeGreaterThan(2020);

    const guardado = (
      await db.collection(COLLECTIONS.timeEvents).doc(String(respuesta.eventId)).get()
    ).data();
    expect(guardado?.occurred_at).not.toBe(mentira);
    expect(guardado?.occurred_at_device).toBe(mentira);
  });

  it('una transición imposible se rechaza y no escribe nada', async () => {
    expect(
      await codigoDelFallo(
        correr(submitTimeEvent, {
          kioskAuth,
          actionToken: await tokenDeAccion(),
          eventType: 'break_end',
          idempotencyKey: 'clave-imposible',
        }),
      ),
    ).toBe('failed-precondition');
    expect(await eventos()).toBe(0);
  });

  it('sin clave de idempotencia no se ficha', async () => {
    expect(
      await codigoDelFallo(
        correr(submitTimeEvent, {
          kioskAuth,
          actionToken: await tokenDeAccion(),
          eventType: 'clock_in',
        }),
      ),
    ).toBe('invalid-argument');
    expect(await eventos()).toBe(0);
  });

  /** Sin el token del PIN, tener la credencial del aparato no basta para fichar por nadie. */
  it('sin token de acción no se ficha, aunque el aparato sea legítimo', async () => {
    expect(
      await codigoDelFallo(
        correr(submitTimeEvent, {
          kioskAuth,
          eventType: 'clock_in',
          idempotencyKey: 'clave-sin-token',
        }),
      ),
    ).not.toBe('(no fallo)');
    expect(await eventos()).toBe(0);
  });
});
