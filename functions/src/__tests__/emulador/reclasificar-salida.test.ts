import bcrypt from 'bcryptjs';

import { managerReclassifyDeparture } from '../../manager';
import { submitTimeEvent, verifyPin } from '../../kiosk-api';
import { COLLECTIONS, db } from '../../shared/admin';
import { rebuildWorkSession, recordTimeEvent } from '../../shared/attendance';

/**
 * «Se fue al almacen, no se fue a casa»: reclasificar una salida como pausa.
 *
 * LO QUE DE VERDAD HAY QUE COMPROBAR NO ES QUE EL CAMPO SE ESCRIBA, es que las HORAS
 * cambien. Un `reclassified_as` guardado que no mueva los minutos no sirve para nada:
 * el gerente corrige, ve la etiqueta, y a la persona le siguen faltando dos horas en su
 * planilla. Asi que cada prueba mira los minutos de la sesion.
 *
 * Y la otra mitad: que los fichajes crudos NO se toquen. Es la regla de oro del
 * proyecto y la unica razon por la que este registro vale ante una inspeccion.
 */

const ORG = 'org-reclas';
const SEDE = 'sede-reclas';
const APARATO = 'aparato-r';
const PUBLICO = 'publico-r';
const CREDENCIAL = 'credencial-del-aparato-de-reclasificar';
const PIN = '2468';
const PERSONA = 'persona-que-va-al-almacen';
const GERENTE = 'uid-del-gerente';
const PROYECTO = 'demo-krealo-shift';

const correr = (fn: unknown, data: unknown, uid?: string): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === undefined ? undefined : { uid, token: {} },
    rawRequest: {},
  });

const kioskAuth = { devicePublicId: PUBLICO, credential: CREDENCIAL };

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

const sesiones = async (): Promise<Record<string, unknown>[]> => {
  const snapshot = await db.collection(COLLECTIONS.workSessions).orderBy('starts_at', 'asc').get();
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
};

const eventoDe = async (tipo: string): Promise<{ id: string; datos: Record<string, unknown> }> => {
  const snapshot = await db
    .collection(COLLECTIONS.timeEvents)
    .where('event_type', '==', tipo)
    .get();
  const doc = snapshot.docs[0];
  if (doc === undefined) throw new Error(`no hay evento «${tipo}»`);
  return { id: doc.id, datos: doc.data() };
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
    .set({ id: PERSONA, organization_id: ORG, full_name: 'Quien Va Al Almacen', status: 'active' });
  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(PERSONA)
    .set({ employee_id: PERSONA, pin_hash: bcrypt.hashSync(PIN, 4) });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });
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

/**
 * La jornada del caso: entra a las 13:00, «sale» a las 17:00 para ir al almacen y
 * vuelve a las 19:00, y se va de verdad a las 21:00.
 *
 * Se escriben con `recordTimeEvent` y horas explicitas porque el reloj sella con la hora
 * del servidor: cuatro fichajes en el mismo segundo no serian una jornada.
 */
const H = (hora: number) => `2026-09-22T${String(hora).padStart(2, '0')}:00:00.000Z`;

async function jornadaConAusencia(): Promise<void> {
  for (const [tipo, hora] of [
    ['clock_in', 13],
    ['clock_out', 17],
    ['clock_in', 19],
    ['clock_out', 21],
  ] as const) {
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: tipo,
      occurredAt: H(hora),
      idempotencyKey: `${tipo}-${hora}`,
      source: 'kiosk',
    });
  }
}

describe('managerReclassifyDeparture', () => {
  it('parte de DOS sesiones cortadas, que es el problema', async () => {
    await jornadaConAusencia();
    const antes = await sesiones();
    expect(antes).toHaveLength(2);
    expect(antes[0]?.net_minutes).toBe(240);
    expect(antes[1]?.net_minutes).toBe(120);
  });

  it('las funde en UNA y las dos horas de almacen cuentan como trabajadas', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    const resultado = (await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Fue al almacen de Surco' },
      GERENTE,
    )) as { minutes: number; breakType: string };

    expect(resultado.minutes).toBe(120);
    // `errand` cuenta como trabajado de fabrica: por eso se añadio.
    expect(resultado.breakType).toBe('paid');

    const despues = await sesiones();
    expect(despues).toHaveLength(1);
    const sesion = despues[0];
    expect(sesion?.starts_at).toBe(H(13));
    expect(sesion?.ends_at).toBe(H(21));
    expect(sesion?.paid_break_minutes).toBe(120);
    expect(sesion?.unpaid_break_minutes).toBe(0);
    // Ocho horas de punta a punta y ninguna se descuenta: la ausencia era trabajo.
    expect(sesion?.gross_minutes).toBe(480);
    expect(sesion?.net_minutes).toBe(480);
  });

  it('con un motivo que NO cuenta como trabajado, las dos horas se descuentan', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'permit', p_reason: 'Permiso personal' },
      GERENTE,
    );

    const sesion = (await sesiones())[0];
    expect(sesion?.unpaid_break_minutes).toBe(120);
    expect(sesion?.gross_minutes).toBe(480);
    expect(sesion?.net_minutes).toBe(360);
  });

  it('NO toca los fichajes: siguen diciendo lo que la persona marco', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Almacen' },
      GERENTE,
    );

    const crudo = (await db.collection(COLLECTIONS.timeEvents).doc(salida!.id).get()).data();
    expect(crudo?.event_type).toBe('clock_out');
    expect(crudo?.reclassified_as).toBe('break_start');
    expect(crudo?.reclassified_by).toBe(GERENTE);
    expect(crudo?.occurred_at).toBe(H(17));

    // Y los cuatro siguen existiendo: no se borro ninguno.
    expect((await db.collection(COLLECTIONS.timeEvents).get()).size).toBe(4);
  });

  it('deja la correccion auditada con su autor y su motivo', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Fue al almacen de Surco' },
      GERENTE,
    );

    const ajustes = await db.collection(COLLECTIONS.timeAdjustments).get();
    expect(ajustes.size).toBe(1);
    const ajuste = ajustes.docs[0]?.data();
    expect(ajuste?.created_by).toBe(GERENTE);
    expect(ajuste?.reason).toBe('Fue al almacen de Surco');
    expect((ajuste?.before_value as Record<string, unknown>).event_type).toBe('clock_out');
    expect((ajuste?.after_value as Record<string, unknown>).minutes).toBe(120);
  });

  it('quita la marca de salida anticipada: la persona no se fue antes', async () => {
    await jornadaConAusencia();
    const cortada = (await sesiones())[0];
    await db
      .collection(COLLECTIONS.workSessions)
      .doc(String(cortada?.id))
      .update({ flags: ['early_departure', 'late_arrival'] });

    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];
    await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Almacen' },
      GERENTE,
    );

    const sesion = (await sesiones())[0];
    // Se va la de salida anticipada y se queda la de tardanza, que sigue siendo cierta.
    expect(sesion?.flags).toEqual(['late_arrival']);
  });

  it('no deja reclasificar dos veces: sumaria la pausa dos veces', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];
    const datos = { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Almacen' };

    await correr(managerReclassifyDeparture, datos, GERENTE);
    expect(await codigoDelFallo(correr(managerReclassifyDeparture, datos, GERENTE))).toBe(
      'failed-precondition',
    );
  });

  it('una ENTRADA no se puede reclasificar', async () => {
    await jornadaConAusencia();
    const entrada = await eventoDe('clock_in');
    expect(
      await codigoDelFallo(
        correr(
          managerReclassifyDeparture,
          { p_event_id: entrada.id, p_break_reason: 'errand', p_reason: 'x' },
          GERENTE,
        ),
      ),
    ).toBe('failed-precondition');
  });

  /** Sin vuelta seria una pausa sin final: alguien descansando para siempre. */
  it('una salida SIN entrada despues no se puede convertir', async () => {
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_in',
      occurredAt: H(13),
      idempotencyKey: 'sola-in',
      source: 'kiosk',
    });
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_out',
      occurredAt: H(17),
      idempotencyKey: 'sola-out',
      source: 'kiosk',
    });

    const salida = await eventoDe('clock_out');
    expect(
      await codigoDelFallo(
        correr(
          managerReclassifyDeparture,
          { p_event_id: salida.id, p_break_reason: 'errand', p_reason: 'x' },
          GERENTE,
        ),
      ),
    ).toBe('failed-precondition');
  });

  /**
   * EL HUECO DE UNA NOCHE NO ES UNA AUSENCIA, y esto se me escapo al escribir la
   * funcion: «la entrada siguiente» de quien sale a las 21:00 un lunes es la de las
   * 09:00 del martes. Sin limite, reclasificar la salida del lunes creaba una pausa de
   * doce horas y fundia dos jornadas en una de veinticuatro. Con `errand`, que cuenta
   * como trabajado, son doce horas regaladas de un clic.
   */
  it('un hueco mas largo que el descanso minimo entre turnos NO se puede convertir', async () => {
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_in',
      occurredAt: '2026-09-21T13:00:00.000Z',
      idempotencyKey: 'lunes-in',
      source: 'kiosk',
    });
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_out',
      occurredAt: '2026-09-21T21:00:00.000Z',
      idempotencyKey: 'lunes-out',
      source: 'kiosk',
    });
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: PERSONA,
      locationId: SEDE,
      eventType: 'clock_in',
      occurredAt: '2026-09-22T13:00:00.000Z',
      idempotencyKey: 'martes-in',
      source: 'kiosk',
    });

    const salida = (
      await db
        .collection(COLLECTIONS.timeEvents)
        .where('occurred_at', '==', '2026-09-21T21:00:00.000Z')
        .get()
    ).docs[0];

    expect(
      await codigoDelFallo(
        correr(
          managerReclassifyDeparture,
          { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'x' },
          GERENTE,
        ),
      ),
    ).toBe('failed-precondition');
  });

  /** Y con la sede configurada a un descanso corto, el mismo hueco SI vale. */
  it('el limite es el de la sede, no un numero fijo', async () => {
    await db
      .collection(COLLECTIONS.locations)
      .doc(SEDE)
      .set({ settings: { minimumRestMinutes: 60 } }, { merge: true });

    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    // Dos horas de ausencia contra un descanso minimo de una: ya no es una ausencia.
    expect(
      await codigoDelFallo(
        correr(
          managerReclassifyDeparture,
          { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'x' },
          GERENTE,
        ),
      ),
    ).toBe('failed-precondition');
  });

  /** Quien no manda en esa sede no corrige sus horas. */
  it('alguien de fuera de la sede no puede reclasificar', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    await db
      .collection(COLLECTIONS.memberships)
      .doc(`${ORG}_otro`)
      .set({
        user_id: 'otro',
        organization_id: ORG,
        role: 'manager',
        status: 'active',
        managed_location_ids: ['otra-sede'],
      });

    const codigo = await codigoDelFallo(
      correr(
        managerReclassifyDeparture,
        { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'x' },
        'otro',
      ),
    );
    expect(codigo).toBe('permission-denied');
  });

  /** Y sin sesion iniciada, ni eso. */
  it('sin sesion no se puede reclasificar', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];

    const codigo = await codigoDelFallo(
      correr(managerReclassifyDeparture, {
        p_event_id: salida?.id,
        p_break_reason: 'errand',
        p_reason: 'x',
      }),
    );
    expect(codigo).toBe('unauthenticated');
  });
});

/**
 * QUE UNA RECONSTRUCCION POSTERIOR NO DESHAGA LA CORRECCION.
 *
 * Esta es la prueba que faltaba, y se descubrio que faltaba haciendo el control: se
 * devolvio `attendanceStateAt` a leer `event_type` a pelo y NO cayo ninguna prueba. O
 * sea que las nueve de arriba no estaban comprobando para nada el tipo efectivo.
 *
 * La razon es que el estado sale igual por los dos caminos —`clock_in, clock_out,
 * clock_in, clock_out` y `clock_in, break_start, break_end, clock_out` acaban los dos en
 * OFF_SHIFT—. Donde SI difieren es en donde empieza la sesion: `rebuildWorkSession`
 * busca «la ultima entrada», y leyendo el tipo crudo esa es la de las 19:00, asi que
 * escribiria otra vez la sesion partida que la correccion acababa de fundir.
 *
 * Y eso pasa solo: cualquier fichaje posterior dentro de la ventana de 36 horas dispara
 * la reconstruccion. El gerente corrige, ve una sola sesion, y al dia siguiente vuelven
 * a ser dos sin que nadie haya tocado nada.
 */
describe('una reconstruccion posterior', () => {
  it('no vuelve a partir la sesion que se acaba de fundir', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];
    await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Almacen' },
      GERENTE,
    );
    expect(await sesiones()).toHaveLength(1);

    // Lo que dispara cualquier fichaje posterior de esa persona.
    await rebuildWorkSession(ORG, PERSONA, SEDE);

    const despues = await sesiones();
    expect(despues).toHaveLength(1);
    expect(despues[0]?.starts_at).toBe(H(13));
    expect(despues[0]?.ends_at).toBe(H(21));
    expect(despues[0]?.paid_break_minutes).toBe(120);
    expect(despues[0]?.net_minutes).toBe(480);
  });
});

/** Que el reloj sigue funcionando igual: la reclasificacion no le cambia nada. */
describe('el reloj despues de una reclasificacion', () => {
  it('quien tiene una salida reclasificada puede seguir fichando normal', async () => {
    await jornadaConAusencia();
    const salida = (
      await db.collection(COLLECTIONS.timeEvents).where('occurred_at', '==', H(17)).get()
    ).docs[0];
    await correr(
      managerReclassifyDeparture,
      { p_event_id: salida?.id, p_break_reason: 'errand', p_reason: 'Almacen' },
      GERENTE,
    );

    const respuesta = (await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: await tokenDeAccion(),
      eventType: 'clock_in',
      idempotencyKey: 'al-dia-siguiente',
    })) as Record<string, unknown>;

    expect(respuesta.status).toBe('accepted');
    expect(respuesta.attendanceState).toBe('WORKING');
  });
});
