import { managerAdjustTime } from '../../manager';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * `managerAdjustTime`: corregir a mano las horas de una jornada ya cerrada.
 *
 * POR QUE ESTA ES LA SIGUIENTE. Es la unica funcion del panel que cambia DIRECTAMENTE
 * minutos que se pagan. Todo lo demas —fichar, sincronizar, ajustar turnos— produce
 * horas a partir de eventos; esta las reescribe porque un encargado dice que estaban
 * mal. Eso la pone en el centro de cualquier auditoria laboral y la convierte en la
 * puerta obvia si alguien quisiera inflar una nomina.
 *
 * LAS CUATRO COSAS QUE TIENEN QUE SER CIERTAS, y ninguna la ve el compilador:
 *
 *   1. QUE SOLO PUEDA QUIEN ADMINISTRA ESA SEDE. El Admin SDK se salta
 *      `firestore.rules` por diseño, asi que `requireManagesLocation` es la UNICA
 *      barrera: si se cae, un encargado corrige las horas de otra tienda y nada lo para.
 *   2. QUE EL AJUSTE DEJE RASTRO. La correccion se guarda como una fila NUEVA en
 *      `time_adjustments` con el antes, el despues, el motivo y el autor — nunca
 *      reescribiendo el evento original, que es la unica prueba de lo que paso. Una
 *      correccion que borra el original borra la diferencia entre un error honesto y un
 *      fraude.
 *   3. QUE LOS MINUTOS SE TRUNQUEN Y NO SE REDONDEEN. Redondear regala o quita hasta un
 *      minuto por sesion, y eso es dinero. Ya discreparon las dos mitades del producto
 *      por esto.
 *   4. QUE DOS PERSONAS EDITANDO A LA VEZ NO SE PISEN. `p_expected_updated_at` es la
 *      comprobacion de version: sin ella, el segundo en guardar borra el cambio del
 *      primero sin que ninguno se entere.
 */

const ORG = 'org-ajustes';
const SEDE = 'sede-ajustes';
const OTRA_SEDE = 'sede-ajena';
const SESION = 'sesion-a-corregir';
const PROYECTO = 'demo-krealo-shift';

const DUENO = 'uid-dueno-ajustes';
const GERENTE = 'uid-gerente-de-la-sede';
const AJENO = 'uid-gerente-de-otra-sede';
const CUALQUIERA = 'uid-empleado-raso';

const ENTRADA = '2026-09-21T13:00:00.000Z';
const SALIDA = '2026-09-21T21:00:00.000Z';
const VERSION = '2026-09-21T21:05:00.000Z';

const llamar = (data: unknown, uid: string | null): Promise<unknown> =>
  (managerAdjustTime as unknown as { run: (r: unknown) => Promise<unknown> }).run({
    data,
    auth: uid === null ? undefined : { uid, token: {} },
    rawRequest: {},
  });

async function codigoDelFallo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no fallo)';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

const sesion = async () => (await db.collection(COLLECTIONS.workSessions).doc(SESION).get()).data();

const ajustes = async () =>
  (await db.collection(COLLECTIONS.timeAdjustments).get()).docs.map((d) => d.data());

async function ponerMiembro(uid: string, rol: string, sedes: string[] = []): Promise<void> {
  await db.collection(COLLECTIONS.memberships).doc(`${ORG}_${uid}`).set({
    organization_id: ORG,
    user_id: uid,
    role: rol,
    status: 'active',
    managed_location_ids: sedes,
  });
}

beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);

  await ponerMiembro(DUENO, 'owner');
  await ponerMiembro(GERENTE, 'manager', [SEDE]);
  await ponerMiembro(AJENO, 'manager', [OTRA_SEDE]);
  await ponerMiembro(CUALQUIERA, 'employee');

  // Ocho horas brutas, media hora de pausa no pagada: 480 brutos, 450 netos.
  await db.collection(COLLECTIONS.workSessions).doc(SESION).set({
    id: SESION,
    organization_id: ORG,
    location_id: SEDE,
    employee_id: 'quien-trabajo',
    starts_at: ENTRADA,
    ends_at: SALIDA,
    gross_minutes: 480,
    unpaid_break_minutes: 30,
    paid_break_minutes: 0,
    net_minutes: 450,
    status: 'complete',
    updated_at: VERSION,
  });
});

describe('managerAdjustTime', () => {
  it('el gerente de la sede corrige la salida y los minutos se recalculan', async () => {
    await llamar(
      {
        p_work_session_id: SESION,
        p_reason: 'Se fue a las 20:00 y el reloj no lo cogió.',
        p_new_ends_at: '2026-09-21T20:00:00.000Z',
      },
      GERENTE,
    );

    const s = await sesion();
    expect(s?.ends_at).toBe('2026-09-21T20:00:00.000Z');
    // Siete horas brutas menos la media hora no pagada.
    expect(s?.gross_minutes).toBe(420);
    expect(s?.net_minutes).toBe(390);
    // La entrada no se toca si no se manda.
    expect(s?.starts_at).toBe(ENTRADA);
  });

  it('los minutos se TRUNCAN, no se redondean: son dinero', async () => {
    /*
     * 59 segundos de mas no son un minuto de mas. Redondeando, cada sesion podria
     * regalar o quitar hasta un minuto; sobre una plantilla y un mes, eso se nota en la
     * nomina. Es la misma regla que fija `rebuildWorkSession`.
     */
    await llamar(
      {
        p_work_session_id: SESION,
        p_reason: 'Ajuste con segundos.',
        p_new_ends_at: '2026-09-21T20:00:59.000Z',
      },
      GERENTE,
    );

    expect((await sesion())?.gross_minutes).toBe(420);
  });

  it('deja rastro: una fila nueva con el antes, el después, el motivo y el autor', async () => {
    await llamar(
      {
        p_work_session_id: SESION,
        p_reason: 'Olvidó marcar la salida.',
        p_new_ends_at: '2026-09-21T20:00:00.000Z',
      },
      GERENTE,
    );

    const [ajuste] = await ajustes();
    expect(ajuste).toBeDefined();
    expect(ajuste!.work_session_id).toBe(SESION);
    expect(ajuste!.created_by).toBe(GERENTE);
    expect(ajuste!.reason).toBe('Olvidó marcar la salida.');
    expect(ajuste!.channel).toBe('manager_app');
    // El ANTES tiene que conservar lo que habia, o la correccion no se puede auditar.
    expect(ajuste!.before_value).toMatchObject({ ends_at: SALIDA, gross_minutes: 480 });
    expect(ajuste!.after_value).toMatchObject({
      ends_at: '2026-09-21T20:00:00.000Z',
      gross_minutes: 420,
    });
  });

  it('un gerente de OTRA sede no puede tocar estas horas', async () => {
    expect(
      await codigoDelFallo(
        llamar(
          {
            p_work_session_id: SESION,
            p_reason: 'No es mi tienda.',
            p_new_ends_at: '2026-09-21T23:00:00.000Z',
          },
          AJENO,
        ),
      ),
    ).toBe('permission-denied');

    // Y no ha cambiado nada: ni la sesion ni el registro de ajustes.
    expect((await sesion())?.ends_at).toBe(SALIDA);
    expect(await ajustes()).toHaveLength(0);
  });

  it('un empleado raso tampoco, aunque sea de la organización', async () => {
    expect(
      await codigoDelFallo(
        llamar(
          { p_work_session_id: SESION, p_reason: 'Yo mismo.', p_new_ends_at: SALIDA },
          CUALQUIERA,
        ),
      ),
    ).toBe('permission-denied');
    expect(await ajustes()).toHaveLength(0);
  });

  it('sin sesión iniciada no se corrigen horas', async () => {
    expect(
      await codigoDelFallo(
        llamar({ p_work_session_id: SESION, p_reason: 'Anónimo.', p_new_ends_at: SALIDA }, null),
      ),
    ).not.toBe('(no fallo)');
    expect(await ajustes()).toHaveLength(0);
  });

  it('sin motivo escrito no se corrige: la auditoría necesita el porqué', async () => {
    expect(
      await codigoDelFallo(llamar({ p_work_session_id: SESION, p_new_ends_at: SALIDA }, GERENTE)),
    ).toBe('invalid-argument');
    expect(await ajustes()).toHaveLength(0);
  });

  it('la salida no puede quedar antes de la entrada', async () => {
    expect(
      await codigoDelFallo(
        llamar(
          {
            p_work_session_id: SESION,
            p_reason: 'Al revés.',
            p_new_ends_at: '2026-09-21T10:00:00.000Z',
          },
          GERENTE,
        ),
      ),
    ).toBe('invalid-argument');
    expect((await sesion())?.ends_at).toBe(SALIDA);
  });

  it('dos personas editando a la vez: la segunda no pisa a la primera', async () => {
    /*
     * El caso real: dos encargados abren la misma jornada, uno guarda y el otro guarda
     * despues con lo que tenia en pantalla. Sin la comprobacion de version, el segundo
     * borra el cambio del primero y ninguno se entera.
     */
    await llamar(
      {
        p_work_session_id: SESION,
        p_reason: 'El primero.',
        p_new_ends_at: '2026-09-21T20:00:00.000Z',
        p_expected_updated_at: VERSION,
      },
      GERENTE,
    );

    expect(
      await codigoDelFallo(
        llamar(
          {
            p_work_session_id: SESION,
            p_reason: 'El segundo, con la pantalla vieja.',
            p_new_ends_at: '2026-09-21T23:00:00.000Z',
            p_expected_updated_at: VERSION,
          },
          GERENTE,
        ),
      ),
    ).toBe('aborted');

    // Gana el primero, y solo hay un ajuste registrado.
    expect((await sesion())?.ends_at).toBe('2026-09-21T20:00:00.000Z');
    expect(await ajustes()).toHaveLength(1);
  });

  it('una jornada que no existe no se inventa', async () => {
    expect(
      await codigoDelFallo(llamar({ p_work_session_id: 'no-existe', p_reason: 'Nada.' }, DUENO)),
    ).toBe('not-found');
  });
});
