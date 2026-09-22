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

describe('el reloj sabe a qué hora termina la jornada', () => {
  /**
   * `verifyPin` devolvía `shiftEndsAt: null` fijo, así que el reloj conocía la hora de
   * fin justo después de fichar la entrada —`submitTimeEvent` sí la manda— y la olvidaba
   * en cuanto la persona volvía al teclado. El mismo campo, correcto en una función y
   * muerto en la otra.
   *
   * Sin esta hora el reloj no puede saber que alguien está saliendo antes de tiempo, que
   * es lo que hay que detectar para poder preguntarle por qué.
   */
  it('lo dice al teclear el PIN con una jornada abierta, no solo al fichar entrada', async () => {
    await ponerTurno(-1 * HORA, 7 * HORA);
    await fichar('clock_in', 'entrada-para-ver-el-fin', TURNO);

    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      openSession: { shiftEndsAt: string | null } | null;
    };

    const turno = (await db.collection(COLLECTIONS.shifts).doc(TURNO).get()).data();
    expect(contexto.openSession?.shiftEndsAt).toBe(turno?.ends_at);
  });

  /** Sin turno no hay hora de fin que inventar, y `null` es la respuesta correcta. */
  it('devuelve null cuando la jornada no tiene turno', async () => {
    await fichar('clock_in', 'entrada-sin-turno-fin', null);

    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      openSession: { shiftEndsAt: string | null } | null;
    };

    expect(contexto.openSession?.shiftEndsAt).toBeNull();
  });
});

describe('los campos del contexto que estaban fijos', () => {
  /**
   * `openBreak: null` fijo. `actions.tsx:578` solo pinta «En descanso desde {{hora}}»
   * cuando no es null, así que quien está en pausa volvía al teclado y el reloj no le
   * decía desde cuándo llevaba fuera — que es justo lo que necesita para saber si ya le
   * toca volver.
   */
  it('dice desde cuándo lleva la pausa abierta', async () => {
    await ponerTurno(-1 * HORA, 7 * HORA);
    await fichar('clock_in', 'entrada-pausa', TURNO);
    await fichar('break_start', 'inicio-pausa', TURNO);

    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      openSession: { openBreak: { startedAt: string; breakType: string } | null } | null;
    };

    expect(contexto.openSession?.openBreak).not.toBeNull();
    expect(typeof contexto.openSession?.openBreak?.startedAt).toBe('string');
  });

  /** Y al volver de la pausa deja de estar abierta: si no, el aviso no se apagaría nunca. */
  it('deja de decirlo cuando la pausa termina', async () => {
    await ponerTurno(-1 * HORA, 7 * HORA);
    await fichar('clock_in', 'entrada-pausa-2', TURNO);
    await fichar('break_start', 'inicio-pausa-2', TURNO);
    await fichar('break_end', 'fin-pausa-2', TURNO);

    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      openSession: { openBreak: unknown } | null;
    };

    expect(contexto.openSession?.openBreak).toBeNull();
  });

  /**
   * `jobRoleName: null` fijo, en los dos sitios. En una tienda con caja y piso, el puesto
   * es como distingues dos turnos del mismo día.
   */
  it('dice el puesto de la persona', async () => {
    await db
      .collection(COLLECTIONS.jobRoles)
      .doc('puesto-caja')
      .set({ id: 'puesto-caja', organization_id: ORG, name: 'Caja' });
    await db.collection(COLLECTIONS.employeeJobRoles).doc(`${PERSONA}_caja`).set({
      organization_id: ORG,
      employee_id: PERSONA,
      job_role_id: 'puesto-caja',
      is_primary: true,
    });

    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      employee: { jobRoleName: string | null };
    };

    expect(contexto.employee.jobRoleName).toBe('Caja');
  });

  /** Sin puesto asignado, `null` es la respuesta correcta: no hay nada que inventar. */
  it('devuelve null si la persona no tiene puesto', async () => {
    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      employee: { jobRoleName: string | null };
    };

    expect(contexto.employee.jobRoleName).toBeNull();
  });
});
