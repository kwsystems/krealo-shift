import bcrypt from 'bcryptjs';

import { verifyPin } from '../../kiosk-api';
import { COLLECTIONS, db } from '../../shared/admin';
import { recordTimeEvent } from '../../shared/attendance';
import { MAX_INTENTOS } from '../../shared/bloqueo';

/**
 * `verifyPin`, que es la puerta del reloj (§8, §14).
 *
 * ES LA FUNCION MAS EXPUESTA DEL PROYECTO: la llama un iPad atornillado a una pared,
 * sin ninguna sesion de Google detras, y lo unico que la protege es la credencial del
 * aparato y lo que comprueba por dentro. Un descuido aqui no lo tapa `firestore.rules`,
 * porque el Admin SDK se las salta.
 *
 * LA PRUEBA QUE MAS IMPORTA ES LA DEL EMPLEADO DESACTIVADO, y no es teorica: hasta el
 * 22-sep-2026 el PIN de alguien desactivado SEGUIA ABRIENDO EL RELOJ. `refreshKioskRoster`
 * si miraba el estado y el teclado no, asi que a quien desactivabas desaparecia de la
 * lista del iPad y seguia fichando igual — despedir a alguien no le quitaba las horas.
 * Se arreglo el mismo dia, pero nada impedia que volviera: esta prueba es lo que lo
 * impide.
 */

const ORG = 'org-reloj';
const SEDE = 'sede-reloj';
const APARATO = 'aparato-1';
const PUBLICO = 'publico-1';
const CREDENCIAL = 'credencial-secreta-del-aparato';
const PROYECTO = 'demo-krealo-shift';

const PIN_ACTIVO = '1234';
const PIN_DESACTIVADO = '5678';

const llamar = (data: unknown): Promise<unknown> =>
  (verifyPin as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: {},
  });

const conAparato = (pin: string, publicId = PUBLICO, credencial = CREDENCIAL): unknown => ({
  pin,
  kioskAuth: { devicePublicId: publicId, credential: credencial },
});

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

/**
 * El motivo LEGIBLE POR CODIGO que viaja en los detalles del error.
 *
 * Es lo que la pantalla del reloj necesita para decir «Ese PIN no es correcto» en vez de
 * «No pudimos completar la accion». Sin esto, el error llega y el reloj no sabe de que
 * era: durante un tiempo el servidor no lo mandaba y el cliente lo buscaba donde no
 * estaba, asi que TODOS los fallos se veian iguales.
 */
async function motivoDelFallo(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { details?: unknown }).details ?? '(sin detalles)';
  }
}

async function ponerEmpleado(id: string, pin: string, estado: string): Promise<void> {
  await db
    .collection(COLLECTIONS.employees)
    .doc(id)
    .set({ id, organization_id: ORG, full_name: id, status: estado });
  await db
    .collection(COLLECTIONS.pinCredentials)
    .doc(id)
    .set({ employee_id: id, pin_hash: bcrypt.hashSync(pin, 4) });
  await db
    .collection(COLLECTIONS.employeeLocations)
    .doc(`${id}_${SEDE}`)
    .set({ employee_id: id, location_id: SEDE, organization_id: ORG });
}

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

  await ponerEmpleado('persona-activa', PIN_ACTIVO, 'active');
  await ponerEmpleado('persona-despedida', PIN_DESACTIVADO, 'inactive');
});

describe('verifyPin', () => {
  it('con el PIN correcto deja pasar a quien está activo, con su token de acción', async () => {
    const contexto = (await llamar(conAparato(PIN_ACTIVO))) as {
      actionToken?: string;
      expiresAt?: string;
      employee?: { opaqueId?: string; displayName?: string };
      attendanceState?: string;
      allowedActions?: string[];
    };

    expect(contexto.employee?.opaqueId).toBe('persona-activa');
    expect(contexto.employee?.displayName).toBe('persona-activa');
    expect(contexto.attendanceState).toBe('OFF_SHIFT');
    expect(contexto.allowedActions).toContain('clock_in');

    /*
     * EL TOKEN ES LA MITAD QUE IMPORTA: sin el, quien acierta el PIN no puede fichar,
     * porque las funciones que escriben fichajes lo exigen. Un `verifyPin` que devuelve
     * a la persona y se deja el token se ve correcto desde la pantalla del PIN y falla
     * en el boton siguiente.
     */
    expect(typeof contexto.actionToken).toBe('string');
    expect((contexto.actionToken ?? '').length).toBeGreaterThan(20);
    expect(new Date(contexto.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  /*
   * QUIEN VIENE A SALIR, CON SU TURNO DE HOY (4-oct). El reloj solo sabía a qué hora
   * terminaba la jornada abierta, no cuál era su turno, así que a quien marcaba la salida
   * le pedía «Elige tu turno» entre el de hoy y el de mañana. Y cuánto dura el permiso,
   * para que el reloj pida el PIN de nuevo antes de mandar algo que va a fallar.
   */
  it('con la jornada abierta devuelve SU turno entero y cuánto dura el permiso', async () => {
    const ahora = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    for (const [id, desde, hasta] of [
      ['turno-de-hoy', ahora - 2 * 3600_000, ahora + 6 * 3600_000],
      ['turno-de-manana', ahora + 22 * 3600_000, ahora + 30 * 3600_000],
    ] as const) {
      await db
        .collection(COLLECTIONS.shifts)
        .doc(id)
        .set({
          id,
          organization_id: ORG,
          location_id: SEDE,
          employee_id: 'persona-activa',
          starts_at: iso(desde),
          ends_at: iso(hasta),
          status: 'published',
          publication_version: 1,
        });
    }
    await recordTimeEvent({
      organizationId: ORG,
      employeeId: 'persona-activa',
      locationId: SEDE,
      eventType: 'clock_in',
      shiftId: 'turno-de-hoy',
      occurredAt: iso(ahora - 3600_000),
      idempotencyKey: 'entrada-de-hoy',
    });

    const contexto = (await llamar(conAparato(PIN_ACTIVO))) as {
      expiresInSeconds?: number;
      eligibleShifts?: { id: string }[];
      openSession?: {
        shiftId: string | null;
        shiftStartsAt: string | null;
        shiftEndsAt: string | null;
      };
    };
    expect(contexto.expiresInSeconds).toBe(300);
    expect(contexto.eligibleShifts?.map((t) => t.id)).toEqual(['turno-de-hoy', 'turno-de-manana']);
    expect(contexto.openSession).toMatchObject({
      shiftId: 'turno-de-hoy',
      shiftStartsAt: iso(ahora - 2 * 3600_000),
      shiftEndsAt: iso(ahora + 6 * 3600_000),
    });
  });

  /**
   * EL FALLO DEL 22-SEP: el PIN de alguien desactivado abria el reloj. Y el error tiene
   * que ser el MISMO que el de un PIN equivocado —no «esta persona esta desactivada»—
   * porque distinguirlos convierte el teclado en un comprobador de quien sigue en
   * plantilla.
   */
  it('el PIN de alguien desactivado NO abre el reloj', async () => {
    expect(await codigoDelFallo(llamar(conAparato(PIN_DESACTIVADO)))).toBe('permission-denied');
  });

  it('el fallo dice POR CODIGO que fue el PIN, para que el reloj pueda explicarlo', async () => {
    expect(await motivoDelFallo(llamar(conAparato('9999')))).toMatchObject({
      code: 'invalid_pin',
    });
    // Y el de alguien desactivado dice lo MISMO: el codigo no puede delatar quien existe.
    expect(await motivoDelFallo(llamar(conAparato(PIN_DESACTIVADO)))).toMatchObject({
      code: 'invalid_pin',
    });
  });

  it('un PIN que no es de nadie da el mismo error que uno equivocado', async () => {
    const deNadie = await codigoDelFallo(llamar(conAparato('9999')));
    const deDesactivado = await codigoDelFallo(llamar(conAparato(PIN_DESACTIVADO)));
    expect(deNadie).toBe('permission-denied');
    expect(deNadie).toBe(deDesactivado);
  });

  it('un PIN con forma inválida se rechaza antes de mirar a nadie', async () => {
    expect(await codigoDelFallo(llamar(conAparato('12')))).toBe('invalid-argument');
    expect(await codigoDelFallo(llamar(conAparato('abcd')))).toBe('invalid-argument');
  });

  describe('la credencial del aparato', () => {
    it('sin credencial no se entra', async () => {
      expect(await codigoDelFallo(llamar({ pin: PIN_ACTIVO }))).toBe('unauthenticated');
    });

    it('con una credencial equivocada tampoco', async () => {
      expect(await codigoDelFallo(llamar(conAparato(PIN_ACTIVO, PUBLICO, 'otra-cosa')))).toBe(
        'unauthenticated',
      );
    });

    it('un aparato que no está registrado tampoco', async () => {
      expect(await codigoDelFallo(llamar(conAparato(PIN_ACTIVO, 'inventado')))).toBe(
        'unauthenticated',
      );
    });

    /** Revocar un reloj tiene que dejarlo fuera aunque conserve su credencial. */
    it('un reloj revocado no entra aunque su credencial siga siendo buena', async () => {
      await db.collection(COLLECTIONS.kioskDevices).doc(APARATO).update({ status: 'revoked' });
      expect(await codigoDelFallo(llamar(conAparato(PIN_ACTIVO)))).toBe('permission-denied');
    });
  });

  describe('el bloqueo por intentos', () => {
    it(`bloquea el reloj tras ${MAX_INTENTOS} fallos seguidos`, async () => {
      for (let i = 0; i < MAX_INTENTOS; i += 1) {
        expect(await codigoDelFallo(llamar(conAparato('9999')))).toBe('permission-denied');
      }

      // Y a partir de ahi ni el PIN bueno pasa: el bloqueo es del aparato.
      expect(await codigoDelFallo(llamar(conAparato(PIN_ACTIVO)))).toBe('resource-exhausted');
    });

    /**
     * UN ACIERTO LIMPIA LA CUENTA. Sin esto, unos cuantos despistes repartidos a lo
     * largo del dia acabarian bloqueando un reloj que funciona bien.
     */
    it('un acierto reinicia la cuenta de fallos', async () => {
      for (let i = 0; i < MAX_INTENTOS - 1; i += 1) {
        await codigoDelFallo(llamar(conAparato('9999')));
      }

      await llamar(conAparato(PIN_ACTIVO));

      const aparato = (await db.collection(COLLECTIONS.kioskDevices).doc(APARATO).get()).data();
      expect(aparato?.pin_failed_attempts).toBe(0);
      expect(aparato?.pin_locked_until).toBeNull();
    });
  });
});
