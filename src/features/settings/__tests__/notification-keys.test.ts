import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationKeys,
  type NotificationKey,
} from '../api';
import { managerAlertTypes } from '@/features/notifications/alerts';

/**
 * Los interruptores de la app y los de la base son el mismo conjunto (§11.6 y §19).
 *
 * POR QUÉ ESTA PRUEBA LEE UN ARCHIVO SQL. Hay una prueba en
 * `supabase/tests/30_manager.sql` que compara los interruptores de la base con los
 * tipos de alerta que la base declara. Eso cierra un lado. Pero el conjunto que
 * pinta la pantalla vive en TypeScript, y nada comparaba los dos: la app podía
 * ofrecer un interruptor que la base nunca lee, que es exactamente el fallo que hubo
 * —`earlyClockIn` y `scheduleChange` no controlaban nada— y duró hasta que alguien
 * fue a mirar a mano.
 *
 * Leer el SQL es feo y es a propósito: es la única forma de que este par no pueda
 * separarse sin que algo falle, sin levantar una base de datos en Jest.
 *
 * Y LO QUE ESTA PRUEBA NO PUEDE DECIR, que hay que tener presente: comprueba que las
 * dos copias coinciden, no que la copia sea correcta. Paso en verde con SEIS claves,
 * cuando §11.6 pide ocho, porque la app y la base estaban de acuerdo en estar mal.
 * Lo que ata esto a algo externo es la cuenta explícita de abajo contra las secciones
 * de la especificación.
 */

const MIGRACION = join(
  __dirname,
  '../../../../supabase/migrations/20260827001900_alertas_1106.sql',
);

/** Las claves del `jsonb_build_object` de `default_notification_preferences()`. */
function clavesDeLaBase(): string[] {
  const sql = readFileSync(MIGRACION, 'utf8');
  const inicio = sql.indexOf('create or replace function default_notification_preferences');
  expect(inicio).toBeGreaterThan(-1);
  const cuerpo = sql.slice(inicio, sql.indexOf('$$;', inicio));
  const objeto = cuerpo.slice(cuerpo.indexOf('jsonb_build_object'));
  return [...objeto.matchAll(/'([a-zA-Z]+)',\s*(?:true|false)/g)].map((m) => m[1] ?? '');
}

describe('interruptores de notificación', () => {
  it('la app y la base ofrecen exactamente las mismas claves', () => {
    expect([...notificationKeys].sort()).toEqual(clavesDeLaBase().sort());
  });

  it('son ocho: las nueve alertas menos wrongKiosk, que no lleva interruptor', () => {
    // El número está escrito a mano a propósito: si alguien añade o quita un
    // interruptor, esta prueba lo obliga a decidirlo, no a arrastrarlo. Nueve es la
    // UNIÓN de §11.6 y §19, que listan siete cada una y solo comparten cinco.
    expect(notificationKeys).toHaveLength(8);
    expect(notificationKeys).not.toContain('wrongKiosk');
  });

  it('están las siete que lista §11.6, incluidas las dos que solo aparecen ahí', () => {
    // Escritas por su nombre y contra la sección, no contra la base: es lo único que
    // habría detectado el error de haberlas borrado. La base y la app estaban de
    // acuerdo, así que compararlas entre sí no decía nada.
    const seccion116 = [
      'late',
      'noShow',
      'earlyClockIn',
      'nearOvertime',
      'incompleteEntry',
      'newRequest',
      'scheduleChange',
    ];
    for (const clave of seccion116) {
      expect(notificationKeys as readonly string[]).toContain(clave);
    }
  });

  it('está también la de §19 que no lista §11.6', () => {
    expect(notificationKeys as readonly string[]).toContain('kioskNotSyncing');
  });

  it('cada clave tiene un valor por defecto, y ninguno de más', () => {
    // Un valor por defecto que sobra sería un interruptor fantasma otra vez, esta
    // vez solo en el objeto de defectos.
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual(
      [...notificationKeys].sort(),
    );
  });

  it('entrada temprana viene apagada, y es la única', () => {
    // No es una incidencia sino un patrón que suma en la nómina, y la máquina de
    // estados ya impide fichar antes de la tolerancia. Encendida sería un aviso por
    // cada persona que llega diez minutos antes, todos los días.
    expect(DEFAULT_NOTIFICATION_PREFERENCES.earlyClockIn).toBe(false);
    const apagadas = Object.entries(DEFAULT_NOTIFICATION_PREFERENCES)
      .filter(([, valor]) => !valor)
      .map(([clave]) => clave);
    expect(apagadas).toEqual(['earlyClockIn']);
  });

  it('los avisos que importan vienen encendidos', () => {
    // `late`, `noShow` y `kioskNotSyncing` son el motivo por el que alguien mira el
    // panel. Si llegaran apagados por defecto, el sistema estaría callado justo en
    // los casos para los que existe.
    const encendidos: NotificationKey[] = ['late', 'noShow', 'kioskNotSyncing'];
    for (const clave of encendidos) {
      expect(DEFAULT_NOTIFICATION_PREFERENCES[clave]).toBe(true);
    }
  });
});

/**
 * Y el tercer par: los TIPOS DE ALERTA de la app contra los que declara la base.
 *
 * Hay tres copias de esta lista en el proyecto y no una: `alerts.ts` en la app,
 * `_shared/alert-messages.ts` en las Edge Functions —esas dos ya se comparan en
 * `notifications/__tests__/alert-messages.test.ts`— y la restricción `check` de
 * `manager_alert_deliveries`. Nada comparaba la tercera con las otras dos.
 *
 * IMPORTA porque el modo de fallo es silencioso en las dos direcciones. Si la app no
 * conoce un tipo, `isManagerAlertType` lo descarta y el envío lo salta: la fila queda
 * marcada como entregada y nadie recibe nada. Si la base no lo conoce, el insert de
 * la entrega revienta contra la restricción.
 */
function tiposDeLaBase(): string[] {
  const sql = readFileSync(MIGRACION, 'utf8');
  const inicio = sql.indexOf('add constraint manager_alert_deliveries_alert_type_check');
  expect(inicio).toBeGreaterThan(-1);
  const bloque = sql.slice(inicio, sql.indexOf('));', inicio));
  return [...bloque.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] ?? '');
}

describe('tipos de alerta', () => {
  it('la app conoce exactamente los tipos que declara la base', () => {
    expect([...managerAlertTypes].sort()).toEqual(tiposDeLaBase().sort());
  });

  it('son nueve: la unión de §11.6 y §19', () => {
    expect(managerAlertTypes).toHaveLength(9);
  });

  it('cada interruptor apaga un tipo de alerta que existe', () => {
    for (const clave of notificationKeys) {
      expect(managerAlertTypes as readonly string[]).toContain(clave);
    }
  });

  it('la única alerta sin interruptor es wrongKiosk', () => {
    const sinInterruptor = managerAlertTypes.filter(
      (tipo) => !(notificationKeys as readonly string[]).includes(tipo),
    );
    // Escrito así y no como un número: si alguien añade una alerta sin interruptor,
    // la prueba dice CUÁL, y esa decisión tiene que ser deliberada.
    expect(sinInterruptor).toEqual(['wrongKiosk']);
  });
});
