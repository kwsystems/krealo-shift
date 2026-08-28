import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationKeys,
  type NotificationKey,
} from '../api';

/**
 * Los interruptores de la app y los de la base tienen que ser el mismo conjunto (§19).
 *
 * POR QUÉ ESTA PRUEBA LEE UN ARCHIVO SQL. Hay una prueba en
 * `supabase/tests/30_manager.sql` que compara los interruptores de la base con los
 * tipos de alerta que la base declara. Eso cierra un lado. Pero el conjunto que
 * pinta la pantalla vive en TypeScript, y nada comparaba los dos: la app podía
 * ofrecer un interruptor que la base nunca lee, que es exactamente el fallo que
 * hubo —`earlyClockIn` y `scheduleChange` no controlaban nada— y duró hasta que
 * alguien fue a mirar a mano.
 *
 * Leer el SQL es feo y es a propósito: es la única forma de que este par no pueda
 * separarse sin que algo falle, sin levantar una base de datos en Jest.
 */

const MIGRACION = join(
  __dirname,
  '../../../../supabase/migrations/20260827001700_notification_preferences_real.sql',
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

  it('son seis: las siete alertas de §19 menos wrongKiosk, que no lleva interruptor', () => {
    // El número está escrito a mano a propósito: si alguien añade o quita un
    // interruptor, esta prueba lo obliga a decidirlo, no a arrastrarlo.
    expect(notificationKeys).toHaveLength(6);
    expect(notificationKeys).not.toContain('wrongKiosk');
  });

  it('cada clave tiene un valor por defecto, y ninguno de más', () => {
    // Un valor por defecto que sobra sería un interruptor fantasma otra vez, esta
    // vez solo en el objeto de defectos.
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual(
      [...notificationKeys].sort(),
    );
  });

  it('no queda ninguna de las dos claves que no controlaban nada', () => {
    const muertas = ['earlyClockIn', 'scheduleChange'];
    for (const muerta of muertas) {
      expect(notificationKeys as readonly string[]).not.toContain(muerta);
      expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)).not.toContain(muerta);
      expect(clavesDeLaBase()).not.toContain(muerta);
    }
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
