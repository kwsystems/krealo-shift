import bcrypt from 'bcryptjs';

import { submitTimeEvent, syncOfflineEvents, verifyPin } from '../../kiosk-api';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * La cola sin conexion: lo que el iPad guardo mientras no habia red.
 *
 * ES LA FUNCION CON MAS FORMAS DE PERDER HORAS TRABAJADAS de todo el proyecto, porque
 * es la unica que procesa un LOTE y porque los eventos que le llegan ya no se pueden
 * volver a pedir: si los descarta, esa tarde desaparece. Tres cosas que ya salieron mal
 * aqui, y ninguna la ve el compilador:
 *
 *   1. EXIGIA UN TOKEN DE ACCION A CADA EVENTO. El token lo emite `verifyPin`, que es
 *      una llamada de red, y estos eventos existen precisamente porque NO habia red.
 *      Asi que el lote entero fallaba con «Vuelve a marcar tu PIN» y la cola no se
 *      vaciaba nunca: una tienda con el wifi caido una tarde la perdia entera.
 *   2. DEVOLVIA UNA FORMA QUE EL RELOJ RECHAZA. Sin `status` por evento y sin
 *      `accepted`/`pending` en la raiz, el esquema del cliente descartaba la respuesta
 *      completa y el iPad daba por fallido un lote que el servidor SI habia guardado.
 *   3. EL ORDEN. Se aplican por `deviceSequence` y no por el orden del JSON, porque la
 *      maquina de estados rechaza «salida, entrada» y acepta «entrada, salida»: leerlos
 *      en el orden equivocado concluye lo contrario de lo que paso.
 *
 * Y una cuarta que es de diseño y hay que fijar: un evento invalido NO puede cortar el
 * lote ni borrarse. Se marca `needs_review` para que lo mire un encargado, porque casi
 * siempre es un fichaje al que le falta su pareja —la salida de ayer que se quedo en un
 * iPad apagado— y no un intento de colar algo.
 */

const ORG = 'org-cola';
const SEDE = 'sede-cola';
const OTRA_SEDE = 'otra-sede-cola';
const APARATO = 'aparato-c';
const PUBLICO = 'publico-c';
const CREDENCIAL = 'credencial-del-aparato-de-la-cola';
const PIN = '8642';
const PERSONA = 'persona-de-la-cola';
const AJENA = 'persona-de-otra-sede';
const PROYECTO = 'demo-krealo-shift';

const AYER = new Date(Date.now() - 20 * 3600_000);
const hora = (minutos: number) => new Date(AYER.getTime() + minutos * 60_000).toISOString();

const correr = (fn: unknown, data: unknown): Promise<unknown> =>
  (fn as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: {},
  });

const kioskAuth = { devicePublicId: PUBLICO, credential: CREDENCIAL };

type Resultado = { idempotencyKey: string; status: string; eventId?: string; reason?: string };
type Respuesta = { results: Resultado[]; accepted: number; pending: number; syncedAt: string };

/** Un evento de la cola tal y como lo manda `src/lib/offline/sync.ts`. */
function evento(campos: {
  clave: string;
  tipo: string;
  seq: number;
  cuando: string;
  persona?: string;
  verificado?: boolean;
}) {
  return {
    idempotencyKey: campos.clave,
    employeeOpaqueId: campos.persona ?? PERSONA,
    eventType: campos.tipo,
    shiftId: null,
    occurredAtDevice: campos.cuando,
    deviceSequence: campos.seq,
    pinVersion: 1,
    offlineVerified: campos.verificado ?? true,
  };
}

const sincronizar = (events: unknown[]) =>
  correr(syncOfflineEvents, { kioskAuth, events }) as Promise<Respuesta>;

const eventosGuardados = async () =>
  (await db.collection(COLLECTIONS.timeEvents).get()).docs
    .map((d) => d.data())
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));

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
    .set({ credential_hash: bcrypt.hashSync(CREDENCIAL, 4), offline_key: 'clave-sin-conexion' });
  await db
    .collection(COLLECTIONS.employees)
    .doc(PERSONA)
    .set({ id: PERSONA, organization_id: ORG, full_name: 'Quien Ficho Sin Red', status: 'active' });
  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(PERSONA)
    .set({
      employee_id: PERSONA,
      pin_hash: bcrypt.hashSync(PIN, 4),
      pin_length: 4,
      pin_version: 1,
    });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${PERSONA}_${SEDE}`)
    .set({ employee_id: PERSONA, location_id: SEDE, organization_id: ORG });

  // Alguien de OTRA sede, para comprobar que su id no sirve en este reloj.
  await db
    .collection(COLLECTIONS.employees)
    .doc(AJENA)
    .set({ id: AJENA, organization_id: ORG, full_name: 'De Otra Tienda', status: 'active' });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${AJENA}_${OTRA_SEDE}`)
    .set({ employee_id: AJENA, location_id: OTRA_SEDE, organization_id: ORG });
});

describe('syncOfflineEvents', () => {
  it('acepta un lote sin token de acción y devuelve TODO lo que el reloj valida', async () => {
    const r = await sincronizar([
      evento({ clave: 'a-1', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
      evento({ clave: 'a-2', tipo: 'clock_out', seq: 2, cuando: hora(480) }),
    ]);

    // La forma completa: sin estas tres claves el iPad descarta la respuesta entera.
    expect(r.accepted).toBe(2);
    expect(r.pending).toBe(0);
    expect(typeof r.syncedAt).toBe('string');
    expect(r.results.map((x) => x.status)).toEqual(['accepted', 'accepted']);
    expect(r.results.map((x) => x.idempotencyKey)).toEqual(['a-1', 'a-2']);
    expect(r.results.every((x) => typeof x.eventId === 'string')).toBe(true);

    expect((await eventosGuardados()).length).toBe(2);
  });

  it('los aplica por deviceSequence, no por el orden en que llegan', async () => {
    /*
     * La salida va PRIMERA en el JSON. Por orden de llegada la maquina de estados
     * rechazaria «salida» estando fuera de turno y se perderia la jornada entera.
     */
    const r = await sincronizar([
      evento({ clave: 'b-out', tipo: 'clock_out', seq: 2, cuando: hora(480) }),
      evento({ clave: 'b-in', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
    ]);

    expect(r.results.map((x) => x.idempotencyKey)).toEqual(['b-in', 'b-out']);
    expect(r.results.map((x) => x.status)).toEqual(['accepted', 'accepted']);
    expect((await eventosGuardados()).map((e) => e.event_type)).toEqual(['clock_in', 'clock_out']);
  });

  it('la hora que vale es la del iPad, no la del servidor', async () => {
    /*
     * Al reves que en un fichaje EN LINEA, donde manda el reloj del servidor. Aqui el
     * servidor se entera horas despues: sellarlo con su hora pondria la entrada de las
     * ocho de la mañana a las dos de la tarde, y eso son horas que se pagan.
     */
    const cuando = hora(0);
    await sincronizar([evento({ clave: 'c-1', tipo: 'clock_in', seq: 1, cuando })]);

    const [guardado] = await eventosGuardados();
    expect(guardado!.occurred_at).toBe(cuando);
    expect(guardado!.occurred_at_device).toBe(cuando);
    expect(guardado!.is_offline).toBe(true);
  });

  it('un evento inválido NO corta el lote ni se borra: queda en needs_review', async () => {
    const r = await sincronizar([
      // Una pausa que termina sin haber empezado: transicion imposible.
      evento({ clave: 'd-mala', tipo: 'break_end', seq: 1, cuando: hora(0) }),
      evento({ clave: 'd-in', tipo: 'clock_in', seq: 2, cuando: hora(10) }),
      evento({ clave: 'd-out', tipo: 'clock_out', seq: 3, cuando: hora(490) }),
    ]);

    expect(r.results.map((x) => x.status)).toEqual(['needs_review', 'accepted', 'accepted']);
    // `needs_review` y no `rejected`: la hora no se tira, se manda a revisar.
    expect(r.results[0]!.reason).toBeDefined();
    expect(r.accepted).toBe(2);
    // Los dos buenos SI se guardaron, aunque el primero fallara.
    expect((await eventosGuardados()).length).toBe(2);
  });

  it('un id de empleado que no es de esta sede se rechaza y no escribe nada', async () => {
    /*
     * Es lo que garantizaba el token de accion y que ahora sostiene la pertenencia a la
     * sede: sin esto, conocer la credencial del aparato y un id bastaria para fichar por
     * cualquiera de la organizacion.
     */
    const r = await sincronizar([
      evento({ clave: 'e-1', tipo: 'clock_in', seq: 1, cuando: hora(0), persona: AJENA }),
      evento({ clave: 'e-2', tipo: 'clock_in', seq: 2, cuando: hora(0), persona: 'no-existe' }),
    ]);

    expect(r.results.map((x) => x.status)).toEqual(['rejected', 'rejected']);
    expect(r.accepted).toBe(0);
    expect((await eventosGuardados()).length).toBe(0);
  });

  it('sin `offlineVerified` no se guarda: el PIN se valida en el aparato o no se valida', async () => {
    const r = await sincronizar([
      evento({ clave: 'f-1', tipo: 'clock_in', seq: 1, cuando: hora(0), verificado: false }),
    ]);

    expect(r.results[0]!.status).toBe('rejected');
    expect((await eventosGuardados()).length).toBe(0);
  });

  it('un lote reenviado no duplica horas, ni siquiera contra un fichaje en línea', async () => {
    /*
     * El caso real: el iPad manda el lote, la red se corta antes de recibir la respuesta
     * y lo reenvia. Y ademas, la misma clave usada en linea tiene que casar con la de la
     * cola, porque la genera el aparato ANTES de saber si habra red.
     */
    const contexto = (await correr(verifyPin, { pin: PIN, kioskAuth })) as {
      actionToken: string;
    };
    await correr(submitTimeEvent, {
      kioskAuth,
      actionToken: contexto.actionToken,
      eventType: 'clock_in',
      idempotencyKey: 'g-compartida',
    });
    expect((await eventosGuardados()).length).toBe(1);

    const r = await sincronizar([
      evento({ clave: 'g-compartida', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
    ]);
    expect(r.results[0]!.status).toBe('duplicate');
    expect(r.accepted).toBe(1);
    expect((await eventosGuardados()).length).toBe(1);

    // Y el mismo lote otra vez tampoco.
    const otra = await sincronizar([
      evento({ clave: 'g-compartida', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
    ]);
    expect(otra.results[0]!.status).toBe('duplicate');
    expect((await eventosGuardados()).length).toBe(1);
  });

  it('un lote vacío no es un error: el iPad lo manda al reconectar', async () => {
    const r = await sincronizar([]);
    expect(r.results).toEqual([]);
    expect(r.accepted).toBe(0);
    expect(r.pending).toBe(0);
  });
});

/**
 * UN IPAD QUE PASÓ DÍAS SIN RED (30-sep).
 *
 * Los fichajes se guardaban, pero la jornada no se formaba: `recordTimeEvent` recalculaba
 * solo «las últimas 36 horas desde ahora», y un fichaje de hace tres días queda fuera. Un
 * fin de semana con el wifi caído dejaba esos días vacíos en Horas aunque la gente marcó.
 * Lo destaparon las pruebas de reclasificar una salida, que usaban una fecha fija y
 * empezaron a fallar dos días después de escribirse.
 */
describe('un lote de hace días', () => {
  /*
   * Hace 70 h y no tres días a una hora fija (26-oct): desde que se rechaza lo de más de 72 h,
   * «hace tres días a las 13:00 UTC» caía fuera según la hora a la que corriera la prueba.
   * Sigue lejos de las 36 h que es lo que esta prueba vigila.
   */
  const INICIO = Date.now() - 70 * 3600_000;
  const dia = (dias: number, horas: number) =>
    new Date(INICIO + (dias * 24 + horas) * 3600_000).toISOString();
  const jornadas = async () =>
    (await db.collection(COLLECTIONS.workSessions).where('employee_id', '==', PERSONA).get()).docs
      .map((d) => d.data())
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

  it('forma cada jornada con sus horas, aunque llegue días después', async () => {
    const r = await sincronizar([
      evento({ clave: 'v-1', tipo: 'clock_in', seq: 1, cuando: dia(0, 0) }),
      evento({ clave: 'v-2', tipo: 'break_start', seq: 2, cuando: dia(0, 4) }),
      evento({ clave: 'v-3', tipo: 'break_end', seq: 3, cuando: dia(0, 5) }),
      evento({ clave: 'v-4', tipo: 'clock_out', seq: 4, cuando: dia(0, 8) }),
      evento({ clave: 'v-5', tipo: 'clock_in', seq: 5, cuando: dia(1, 0) }),
      evento({ clave: 'v-6', tipo: 'clock_out', seq: 6, cuando: dia(1, 8) }),
    ]);
    expect(r.accepted).toBe(6);

    const [primera, segunda, ...otras] = await jornadas();
    expect(otras).toHaveLength(0);
    expect(primera).toMatchObject({
      starts_at: dia(0, 0),
      ends_at: dia(0, 8),
      status: 'complete',
      net_minutes: 420,
    });
    expect(segunda).toMatchObject({
      starts_at: dia(1, 0),
      ends_at: dia(1, 8),
      status: 'complete',
      net_minutes: 480,
    });
  });

  it('la salida que llega tarde cierra SU jornada, no la de hoy', async () => {
    // Entró hace tres días; el iPad perdió la red antes de que marcara la salida.
    await sincronizar([evento({ clave: 'w-1', tipo: 'clock_in', seq: 1, cuando: dia(0, 0) })]);
    await sincronizar([evento({ clave: 'w-2', tipo: 'clock_out', seq: 2, cuando: dia(0, 8) })]);

    const [unica, ...otras] = await jornadas();
    expect(otras).toHaveLength(0);
    expect(unica).toMatchObject({ ends_at: dia(0, 8), status: 'complete', net_minutes: 480 });
  });
});

describe('lo que manda el aparato se comprueba (auditoría, 4-oct)', () => {
  it('un fichaje con fecha del futuro queda por revisar, no se guarda', async () => {
    const futuro = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const r = await sincronizar([
      evento({ clave: 'f-1', tipo: 'clock_in', seq: 1, cuando: futuro }),
    ]);
    expect(r.results[0]).toMatchObject({ status: 'needs_review' });
    expect(await eventosGuardados()).toHaveLength(0);
  });

  it('una hora que no es fecha tampoco', async () => {
    const r = await sincronizar([
      evento({ clave: 'f-2', tipo: 'clock_in', seq: 1, cuando: 'ayer' }),
    ]);
    expect(r.results[0]).toMatchObject({ status: 'needs_review' });
  });

  it('alguien ya inactivo queda por revisar', async () => {
    await db.collection(COLLECTIONS.employees).doc(PERSONA).update({ status: 'inactive' });
    const r = await sincronizar([
      evento({ clave: 'f-3', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
    ]);
    expect(r.results[0]).toMatchObject({ status: 'needs_review' });
    expect(await eventosGuardados()).toHaveLength(0);
  });

  it('si la pausa es pagada lo decide la sede, no el aparato', async () => {
    const r = await sincronizar([
      evento({ clave: 'p-1', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
      {
        ...evento({ clave: 'p-2', tipo: 'break_start', seq: 2, cuando: hora(240) }),
        breakReason: 'meal',
        breakType: 'paid',
      },
    ]);
    expect(r.accepted).toBe(2);
    const pausa = (await eventosGuardados()).find((e) => e.event_type === 'break_start');
    expect(pausa).toMatchObject({ break_reason: 'meal', break_type: 'unpaid' });
  });

  it('«Otro» sin decir el motivo queda por revisar', async () => {
    const r = await sincronizar([
      evento({ clave: 'o-1', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
      {
        ...evento({ clave: 'o-2', tipo: 'break_start', seq: 2, cuando: hora(240) }),
        breakReason: 'other',
        breakNote: '   ',
      },
    ]);
    expect(r.results.find((x) => x.idempotencyKey === 'o-2')).toMatchObject({
      status: 'needs_review',
    });
  });
});

/*
 * EL LOTE SIN RED, CON TRES LÍMITES (26-oct): un reloj web no ficha sin red, lo de hace más
 * de 72 h lo registra quien gestiona, y lo que entra en una semana ya aprobada queda anotado
 * en ella como cualquier otro cambio.
 */
describe('lo que el lote ya no deja pasar', () => {
  it('un reloj web: cada evento rechazado con su motivo, y nada guardado', async () => {
    await db.collection(COLLECTIONS.kioskDevices).doc(APARATO).update({ platform: 'web' });
    const r = await sincronizar([
      evento({ clave: 'web-1', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
      evento({ clave: 'web-2', tipo: 'clock_out', seq: 2, cuando: hora(480) }),
    ]);
    expect(r.results).toEqual([
      expect.objectContaining({
        idempotencyKey: 'web-1',
        status: 'rejected',
        reason: expect.stringContaining('navegador'),
      }),
      expect.objectContaining({
        idempotencyKey: 'web-2',
        status: 'rejected',
        reason: expect.stringContaining('navegador'),
      }),
    ]);
    expect(r.accepted).toBe(0);
    expect(r.pending).toBe(0);
    expect(await eventosGuardados()).toHaveLength(0);
  });

  it('un reloj que dijo ser web queda marcado: decir después «soy un iPad» no lo desmarca', async () => {
    // Su primera llamada de verdad, desde el navegador.
    await correr(syncOfflineEvents, { kioskAuth, platform: 'web', events: [] });
    expect((await db.collection(COLLECTIONS.kioskDevices).doc(APARATO).get()).data()).toMatchObject(
      { platform: 'web' },
    );

    const r = (await correr(syncOfflineEvents, {
      kioskAuth,
      platform: 'ios',
      events: [evento({ clave: 'web-3', tipo: 'clock_in', seq: 1, cuando: hora(0) })],
    })) as Respuesta;
    expect(r.results[0]).toMatchObject({ status: 'rejected' });
    expect(await eventosGuardados()).toHaveLength(0);
  });

  it('la app (ios) y un reloj sin plataforma conocida siguen sincronizando', async () => {
    const r = (await correr(syncOfflineEvents, {
      kioskAuth,
      platform: 'ios',
      events: [evento({ clave: 'ios-1', tipo: 'clock_in', seq: 1, cuando: hora(0) })],
    })) as Respuesta;
    expect(r.results[0]).toMatchObject({ status: 'accepted' });
    expect(
      (await db.collection(COLLECTIONS.kioskDevices).doc(APARATO).get()).data()?.platform,
    ).toBeUndefined();
  });

  it('un fichaje de hace más de 72 h se rechaza; el resto del lote entra', async () => {
    const viejo = new Date(Date.now() - 73 * 3600_000).toISOString();
    const r = await sincronizar([
      evento({ clave: 'old-1', tipo: 'clock_in', seq: 1, cuando: viejo }),
      evento({ clave: 'new-1', tipo: 'clock_in', seq: 2, cuando: hora(0) }),
    ]);
    expect(r.results.find((x) => x.idempotencyKey === 'old-1')).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('72 horas'),
    });
    expect(r.results.find((x) => x.idempotencyKey === 'new-1')).toMatchObject({
      status: 'accepted',
    });
    expect((await eventosGuardados()).map((e) => e.occurred_at)).toEqual([hora(0)]);
  });

  it('lo marcado sin red en su último día entra aunque la baja ya se cumplió; lo de después no', async () => {
    const diaDe = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(iso));
    const ficha = db.collection(COLLECTIONS.employees).doc(PERSONA);
    await ficha.update({ status: 'inactive', end_date: diaDe(hora(0)) });
    const r = await sincronizar([
      evento({ clave: 'ult-1', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
    ]);
    expect(r.results[0]).toMatchObject({ status: 'accepted' });

    // Con el último día la víspera, ese mismo fichaje ya es de después: por revisar.
    const vispera = new Date(Date.parse(`${diaDe(hora(0))}T12:00:00Z`) - 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    await ficha.update({ end_date: vispera });
    const r2 = await sincronizar([
      evento({ clave: 'ult-2', tipo: 'clock_out', seq: 2, cuando: hora(60) }),
    ]);
    expect(r2.results[0]).toMatchObject({ status: 'needs_review' });
  });

  it('lo que entra en una semana aprobada queda anotado en ella; un duplicado no', async () => {
    await db.collection(COLLECTIONS.timesheetPeriods).doc('semana-aprobada').set({
      id: 'semana-aprobada',
      organization_id: ORG,
      location_id: SEDE,
      starts_on: '2000-01-01',
      ends_on: '2999-12-31',
      status: 'approved',
      changes_after_approval: 0,
      changed_after_approval_at: null,
      changed_after_approval_by: null,
    });

    const lote = [
      evento({ clave: 'ap-1', tipo: 'clock_in', seq: 1, cuando: hora(0) }),
      evento({ clave: 'ap-2', tipo: 'clock_out', seq: 2, cuando: hora(480) }),
    ];
    expect((await sincronizar(lote)).accepted).toBe(2);
    // Reenviado: la cola reintenta lo que no oyó confirmar.
    expect((await sincronizar(lote)).results.map((x) => x.status)).toEqual([
      'duplicate',
      'duplicate',
    ]);

    expect(
      (await db.collection(COLLECTIONS.timesheetPeriods).doc('semana-aprobada').get()).data(),
    ).toMatchObject({ changes_after_approval: 2, changed_after_approval_at: expect.any(String) });
    const auditoria = (await db.collection(COLLECTIONS.auditLogs).get()).docs
      .map((d) => d.data())
      .filter((d) => d.action === 'timesheet_period_changed_after_approval');
    expect(auditoria).toHaveLength(2);
    expect(auditoria[0]).toMatchObject({ actor_user_id: null, actor_device_id: APARATO });
  });
});
