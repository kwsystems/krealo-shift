import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

/**
 * Las reglas de Firestore, probadas de verdad (§22).
 *
 * ESTO EMPIEZA A PAGAR LA DEUDA MAS GRANDE DE LA MIGRACION. Las politicas RLS tenian
 * 265 aserciones que impersonaban usuarios contra Postgres, y se fueron con el. Sin
 * algo asi, las reglas estan razonadas y desplegadas pero nada las vigila contra una
 * edicion futura: se puede abrir un agujero y que todo siga en verde.
 *
 * Se escribio persiguiendo un fallo concreto —«Falta un permiso» en un panel con la
 * membresia correcta en la base— porque mirar las reglas y razonarlas no bastaba para
 * decidir si denegaban o si la consulta volvia vacia: la pantalla dice lo mismo en los
 * dos casos.
 *
 * NECESITA EL EMULADOR. Sin el, se salta entera en vez de fallar: una prueba que
 * revienta cuando falta una herramienta opcional entrena a la gente a ignorar el rojo.
 *
 *     firebase emulators:exec --only firestore "npx jest reglas"
 */

const PROYECTO = 'demo-krealo-shift';
const PUERTO = 8099;

/** Los valores de Firestore van tipados en la REST; esto es solo el traductor. */
function aFirestore(campos: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(campos)) {
    if (typeof valor === 'string') salida[clave] = { stringValue: valor };
    else if (typeof valor === 'boolean') salida[clave] = { booleanValue: valor };
    else if (Array.isArray(valor)) {
      salida[clave] = { arrayValue: { values: valor.map((v) => ({ stringValue: String(v) })) } };
    } else salida[clave] = { nullValue: null };
  }
  return salida;
}
const UID = 'usuario-de-prueba';
const ORG = 'krealo-demo';
const SEDE = 'sede-principal';

/**
 * SIN EMULADOR ESTO FALLA, Y ANTES SE SALTABA. El cambio es deliberado.
 *
 * Saltarse tenia sentido cuando este archivo corria dentro de `npm test`, que lo
 * ejecuta todo el mundo: reventar por una herramienta opcional entrena a la gente a
 * ignorar el rojo. Pero ahora vive en `jest.emulador.config.js` y solo se llega a el
 * pidiendolo (`npm run reglas:check`), asi que llegar aqui sin emulador no es una
 * maquina sin herramientas: es que el emulador no arranco. Y eso hay que verlo.
 *
 * Lo que se evita es justo lo que pasaba: el CI decia «8 skipped» y salia verde. Ocho
 * pruebas que no corren y ocho que no existen protegen exactamente lo mismo.
 */
if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  it('el emulador de Firestore tiene que estar corriendo', () => {
    throw new Error(
      'Sin FIRESTORE_EMULATOR_HOST no hay nada que probar. Lanza: npm run emulador:check',
    );
  });
}

describe('reglas de Firestore', () => {
  let entorno: RulesTestEnvironment;

  beforeAll(async () => {
    /*
     * EL HUB SE FIJA POR VARIABLE DE ENTORNO, no por opcion, porque la libreria NO
     * TIENE opcion para el. Se leyo su codigo despues de tres intentos fallidos:
     * `initializeTestEnvironment` acepta host y puerto de Firestore, pero el hub solo
     * lo saca de `FIREBASE_EMULATOR_HUB`. Pasarselo como `hub: {...}` se ignora en
     * silencio, que es lo que hacia que el arreglo pareciera no funcionar.
     *
     * Y el hub no es un detalle: `withSecurityRulesDisabled`, que es como se siembran
     * los datos, habla con el hub y no con Firestore. Sin el fallan las ocho pruebas a
     * la vez con «Emulator Hub at undefined», que parece que el emulador no arranco
     * cuando si arranco.
     *
     * `??=` y no asignacion directa: si `emulators:exec` si lo exporto, manda el suyo.
     * Los puertos salen de `firebase.json` para que estos numeros y los del emulador
     * no puedan separarse.
     */
    entorno = await initializeTestEnvironment({
      projectId: PROYECTO,
      firestore: {
        host: '127.0.0.1',
        port: PUERTO,
        rules: readFileSync(join(__dirname, '../../../../firestore.rules'), 'utf8'),
      },
    });
  });

  afterAll(async () => entorno?.cleanup());

  /**
   * Se limpia y se siembra por la API REST del emulador, NO con
   * `clearFirestore()` ni `withSecurityRulesDisabled()`.
   *
   * Las dos de la libreria hablan con el «hub» de emuladores, y el hub solo se
   * descubre por `FIREBASE_EMULATOR_HUB`, que los trabajadores de Jest no reciben
   * —se comprobo: `emulators:exec` si lo exporta a su hijo directo—. El sintoma es
   * «Emulator Hub at undefined» en todas las pruebas a la vez, que parece que el
   * emulador no arranco cuando si arranco. Tres intentos de pasarselo fallaron: la
   * libreria no tiene opcion para el hub, solo lee la variable.
   *
   * La REST del emulador escribe SALTANDOSE las reglas, que es justo lo que hace
   * falta: si los datos se sembraran con las reglas puestas, la prueba solo podria
   * preparar escenarios que las reglas ya permiten.
   */
  const REST = `http://127.0.0.1:${PUERTO}/v1/projects/${PROYECTO}/databases/(default)/documents`;

  const escribir = async (ruta: string, campos: Record<string, unknown>) => {
    const res = await fetch(`${REST}/${ruta.split('/')[0]}?documentId=${ruta.split('/')[1]}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: aFirestore(campos) }),
    });
    if (!res.ok) throw new Error(`sembrar ${ruta}: ${res.status} ${await res.text()}`);
  };

  beforeEach(async () => {
    await fetch(
      `http://127.0.0.1:${PUERTO}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`,
      { method: 'DELETE', headers: { Authorization: 'Bearer owner' } },
    );

    await escribir(`organizations/${ORG}`, { id: ORG, name: 'Krealo Demo' });
    await escribir(`organization_memberships/${ORG}_${UID}`, {
      id: `${ORG}_${UID}`,
      organization_id: ORG,
      user_id: UID,
      role: 'owner',
      status: 'active',
      managed_location_ids: [SEDE],
      created_at: '2026-09-21T16:23:34.370Z',
    });
    await escribir(`locations/${SEDE}`, {
      id: SEDE,
      organization_id: ORG,
      name: 'Sede Principal',
    });
    // El centinela del sembrador: existe y NO tiene los campos de una membresia.
    await escribir('organization_memberships/_coleccion', {
      _centinela: true,
      created_at: '2026-09-21T15:38:20.102Z',
    });
  });

  /** Las tres consultas del arranque del panel, en orden. */
  describe('el arranque del panel de un owner', () => {
    it('encuentra su propia membresía', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      const resultado = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'organization_memberships'),
            where('user_id', '==', UID),
            where('status', '==', 'active'),
            orderBy('created_at', 'asc'),
            limit(1),
          ),
        ),
      );
      expect(resultado.size).toBe(1);
      expect(resultado.docs[0]?.data().role).toBe('owner');
    });

    /**
     * SE LEE EL DOCUMENTO, NO SE CONSULTA POR EL CAMPO, y la diferencia costo un panel.
     *
     * La regla es `allow read: if isMember(orgId)`, donde `orgId` es el id del
     * DOCUMENTO. Una consulta `where('id','==',X)` filtra por un CAMPO, y ahi Firestore
     * no puede demostrar que el resultado cumple la regla: deniega el `list` entero
     * sobre un documento que ese mismo usuario si puede leer directo. El sintoma fue
     * «Falta un permiso» con la membresia correcta en la base.
     *
     * Por eso `query.ts` convierte `.eq('id', X)` en un `getDoc`, y por eso esta prueba
     * ejercita las DOS formas: que la buena pase y que la mala siga denegada. Sin la
     * segunda mitad, alguien podria «arreglar» las reglas abriendo el `list` de
     * organizaciones —que es justo lo que no hay que hacer— y esto seguiria en verde.
     */
    it('lee su organización por documento, y la consulta por campo sigue denegada', async () => {
      const db = entorno.authenticatedContext(UID).firestore();

      const documento = await assertSucceeds(getDoc(doc(db, 'organizations', ORG)));
      expect(documento.exists()).toBe(true);
      expect(documento.data()?.name).toBe('Krealo Demo');

      await assertFails(getDocs(query(collection(db, 'organizations'), where('id', '==', ORG))));
    });

    it('lista las ubicaciones de su organización', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      const resultado = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'locations'),
            where('organization_id', '==', ORG),
            orderBy('name', 'asc'),
          ),
        ),
      );
      expect(resultado.size).toBe(1);
    });
  });

  /**
   * DIAS LIBRES MARCADOS: la coleccion nueva del importador de horarios.
   *
   * Se prueba aqui porque las reglas de una coleccion nueva son exactamente el sitio
   * donde el razonamiento no vale: esta misma semana, las reglas de Storage para el
   * logotipo se desplegaron con dos funciones que no existen en ese lenguaje —`get()` y
   * `exists()` son de Firestore— y el despliegue las acepto con un aviso. El sintoma fue
   * «el dueno no tiene permiso» sobre su propia empresa. Leerlas parecia correcto.
   */
  describe('dias libres marcados', () => {
    const DESCANSO = `${SEDE}_empleada-1_2026-09-28`;

    it('quien gestiona la sede lo marca, lo vuelve a escribir y lo quita', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      const referencia = doc(db, 'rest_days', DESCANSO);
      const fila = {
        id: DESCANSO,
        organization_id: ORG,
        location_id: SEDE,
        employee_id: 'empleada-1',
        date_key: '2026-09-28',
        note: null,
      };

      await assertSucceeds(setDoc(referencia, fila));
      // Volver a pegar la misma tabla escribe encima del mismo documento: eso es un
      // `update`, y sin permiso de update pegar dos veces fallaria la segunda.
      await assertSucceeds(setDoc(referencia, fila, { merge: true }));
      await assertSucceeds(deleteDoc(referencia));
    });

    it('la consulta de la semana entera pasa como la hace la app', async () => {
      await escribir(`rest_days/${DESCANSO}`, {
        id: DESCANSO,
        organization_id: ORG,
        location_id: SEDE,
        employee_id: 'empleada-1',
        date_key: '2026-09-28',
      });

      const db = entorno.authenticatedContext(UID).firestore();
      const resultado = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'rest_days'),
            where('organization_id', '==', ORG),
            where('location_id', '==', SEDE),
            where('date_key', '>=', '2026-09-28'),
            where('date_key', '<=', '2026-10-04'),
            orderBy('date_key', 'asc'),
          ),
        ),
      );
      expect(resultado.size).toBe(1);
    });

    it('alguien de fuera de la organizacion no los ve ni los marca', async () => {
      await escribir(`rest_days/${DESCANSO}`, {
        id: DESCANSO,
        organization_id: ORG,
        location_id: SEDE,
        employee_id: 'empleada-1',
        date_key: '2026-09-28',
      });

      const ajeno = entorno.authenticatedContext('otro-usuario').firestore();
      await assertFails(
        getDocs(query(collection(ajeno, 'rest_days'), where('organization_id', '==', ORG))),
      );
      await assertFails(
        setDoc(doc(ajeno, 'rest_days', `${SEDE}_empleada-1_2026-09-29`), {
          organization_id: ORG,
          location_id: SEDE,
          employee_id: 'empleada-1',
          date_key: '2026-09-29',
        }),
      );
      await assertFails(deleteDoc(doc(ajeno, 'rest_days', DESCANSO)));
    });

    it('un gerente de otra sede de la misma empresa no marca descansos en esta', async () => {
      await escribir(`organization_memberships/${ORG}_gerente-de-otra`, {
        id: `${ORG}_gerente-de-otra`,
        organization_id: ORG,
        user_id: 'gerente-de-otra',
        role: 'manager',
        status: 'active',
        managed_location_ids: ['otra-sede'],
        created_at: '2026-09-21T16:23:34.370Z',
      });

      await escribir('locations/otra-sede', {
        id: 'otra-sede',
        organization_id: ORG,
        name: 'La otra',
      });

      const db = entorno.authenticatedContext('gerente-de-otra').firestore();
      await assertFails(
        setDoc(doc(db, 'rest_days', `${SEDE}_empleada-1_2026-09-30`), {
          organization_id: ORG,
          location_id: SEDE,
          employee_id: 'empleada-1',
          date_key: '2026-09-30',
        }),
      );

      /*
       * Y AHORA LA MITAD QUE HACE QUE LA DE ARRIBA SIGNIFIQUE ALGO: el mismo gerente SI
       * puede marcarlo en SU sede. Sin esto, la denegacion anterior pasaria igual con una
       * membresia mal sembrada o con el usuario equivocado, y estariamos midiendo que un
       * desconocido no puede escribir —que es otra prueba, y ya esta mas arriba—.
       */
      await assertSucceeds(
        setDoc(doc(db, 'rest_days', `otra-sede_empleada-9_2026-09-30`), {
          organization_id: ORG,
          location_id: 'otra-sede',
          employee_id: 'empleada-9',
          date_key: '2026-09-30',
        }),
      );
    });
  });

  /**
   * LA VISTA DEL VENDEDOR (30-sep): un `employee` ligado a su ficha lee lo suyo y NADA MÁS.
   *
   * Antes los turnos, los descansos y las asignaciones se leían con `isMember`: cualquier
   * cuenta de la empresa podía pedir por la API el horario de todo el equipo aunque su
   * pantalla solo enseñara el suyo. Se prueba con las consultas tal cual las hace la app
   * (`src/features/portal/api.ts`) y con las que un curioso haría a mano.
   */
  /*
   * «¿Desde cuándo se ficha con el reloj en esta sede?» (30-sep). Es lo que decide si
   * Horario ofrece registrar una semana como cumplida. La consulta es de TODA la sede, así
   * que la puede hacer quien la administra y no un vendedor: le enseñaría fichajes ajenos.
   */
  describe('el primer fichaje del reloj en la sede', () => {
    type Db = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
    const consulta = (db: Db) =>
      getDocs(
        query(
          collection(db, 'time_events'),
          where('organization_id', '==', ORG),
          where('location_id', '==', SEDE),
          where('source', '==', 'kiosk'),
          orderBy('occurred_at', 'asc'),
          limit(1),
        ),
      );

    beforeEach(async () => {
      await escribir('time_events/primero', {
        organization_id: ORG,
        location_id: SEDE,
        employee_id: 'emp-otra',
        source: 'kiosk',
        occurred_at: '2026-09-29T14:00:00.000Z',
      });
    });

    it('quien administra la sede lo puede leer', async () => {
      const filas = await assertSucceeds(consulta(entorno.authenticatedContext(UID).firestore()));
      expect(filas.docs.map((d) => d.id)).toEqual(['primero']);
    });

    it('un vendedor no: serían los fichajes de todo el equipo', async () => {
      await escribir(`organization_memberships/${ORG}_vendedor-curioso`, {
        id: `${ORG}_vendedor-curioso`,
        organization_id: ORG,
        user_id: 'vendedor-curioso',
        role: 'employee',
        status: 'active',
        employee_id: 'emp-yo',
        managed_location_ids: [],
      });
      await assertFails(consulta(entorno.authenticatedContext('vendedor-curioso').firestore()));
    });
  });

  describe('un vendedor ve lo suyo y nada más', () => {
    const VENDEDOR = 'cuenta-del-vendedor';
    const turno = (id: string, empleado: string) =>
      escribir(`shifts/${id}`, {
        id,
        organization_id: ORG,
        location_id: SEDE,
        employee_id: empleado,
        status: 'published',
        starts_at: '2026-10-05T15:00:00.000Z',
        ends_at: '2026-10-05T23:00:00.000Z',
      });
    const jornada = (id: string, empleado: string) =>
      escribir(`work_sessions/${id}`, {
        id,
        organization_id: ORG,
        location_id: SEDE,
        employee_id: empleado,
        starts_at: '2026-10-05T15:02:00.000Z',
      });

    beforeEach(async () => {
      await escribir(`organization_memberships/${ORG}_${VENDEDOR}`, {
        id: `${ORG}_${VENDEDOR}`,
        organization_id: ORG,
        user_id: VENDEDOR,
        role: 'employee',
        status: 'active',
        employee_id: 'emp-yo',
        managed_location_ids: [],
        created_at: '2026-09-30T12:00:00.000Z',
      });
      await escribir('employees/emp-yo', { id: 'emp-yo', organization_id: ORG, full_name: 'Yo' });
      await escribir('employees/emp-otra', {
        id: 'emp-otra',
        organization_id: ORG,
        full_name: 'Otra',
      });
      await turno('turno-mio', 'emp-yo');
      await turno('turno-ajeno', 'emp-otra');
      await jornada('jornada-mia', 'emp-yo');
      await jornada('jornada-ajena', 'emp-otra');
      await escribir('employee_location_assignments/asig-mia', {
        organization_id: ORG,
        location_id: SEDE,
        employee_id: 'emp-yo',
      });
    });

    it('lee sus turnos y sus jornadas con las consultas de su pantalla', async () => {
      const db = entorno.authenticatedContext(VENDEDOR).firestore();
      const turnos = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'shifts'),
            where('organization_id', '==', ORG),
            where('employee_id', '==', 'emp-yo'),
            where('status', '==', 'published'),
            where('starts_at', '>=', '2026-10-01T05:00:00.000Z'),
            where('starts_at', '<', '2026-11-01T05:00:00.000Z'),
            orderBy('starts_at', 'asc'),
          ),
        ),
      );
      expect(turnos.docs.map((d) => d.id)).toEqual(['turno-mio']);

      const jornadas = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'work_sessions'),
            where('organization_id', '==', ORG),
            where('employee_id', '==', 'emp-yo'),
            where('starts_at', '>=', '2026-10-01T05:00:00.000Z'),
            where('starts_at', '<', '2026-11-01T05:00:00.000Z'),
            orderBy('starts_at', 'asc'),
          ),
        ),
      );
      expect(jornadas.docs.map((d) => d.id)).toEqual(['jornada-mia']);

      await assertSucceeds(getDoc(doc(db, 'employees', 'emp-yo')));
      await assertSucceeds(
        getDocs(
          query(
            collection(db, 'employee_location_assignments'),
            where('organization_id', '==', ORG),
            where('employee_id', '==', 'emp-yo'),
          ),
        ),
      );
    });

    it('no lee el turno, la jornada ni la ficha de otra persona', async () => {
      const db = entorno.authenticatedContext(VENDEDOR).firestore();
      await assertFails(getDoc(doc(db, 'shifts', 'turno-ajeno')));
      await assertFails(getDoc(doc(db, 'work_sessions', 'jornada-ajena')));
      await assertFails(getDoc(doc(db, 'employees', 'emp-otra')));
    });

    it('no puede pedir el horario de toda la sede, que es lo que hace el panel', async () => {
      const db = entorno.authenticatedContext(VENDEDOR).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, 'shifts'),
            where('organization_id', '==', ORG),
            where('location_id', '==', SEDE),
          ),
        ),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, 'employee_location_assignments'),
            where('organization_id', '==', ORG),
          ),
        ),
      );
    });

    it('quien administra sigue viéndolo todo', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      await assertSucceeds(getDoc(doc(db, 'shifts', 'turno-ajeno')));
      const sede = await assertSucceeds(
        getDocs(
          query(
            collection(db, 'shifts'),
            where('organization_id', '==', ORG),
            where('location_id', '==', SEDE),
          ),
        ),
      );
      expect(sede.size).toBe(2);
    });
  });

  describe('lo que NO puede pasar', () => {
    it('sin sesión no se lee nada', async () => {
      const db = entorno.unauthenticatedContext().firestore();
      await assertFails(getDocs(collection(db, 'organizations')));
    });

    it('alguien de fuera de la organización no ve sus ubicaciones', async () => {
      const db = entorno.authenticatedContext('otro-usuario').firestore();
      await assertFails(
        getDocs(query(collection(db, 'locations'), where('organization_id', '==', ORG))),
      );
    });

    it('EL PIN NO SE LEE NUNCA, ni siendo owner', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      await assertFails(getDocs(collection(db, 'employee_pin_credentials')));
    });

    it('los secretos del kiosco tampoco', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      await assertFails(getDocs(collection(db, 'kiosk_device_secrets')));
    });

    it('los fichajes son de solo lectura: nadie escribe un time_event', async () => {
      const db = entorno.authenticatedContext(UID).firestore();
      await assertFails(
        setDoc(doc(db, 'time_events/inventado'), {
          organization_id: ORG,
          employee_id: 'x',
          location_id: SEDE,
          event_type: 'clock_in',
        }),
      );
    });
  });
});
