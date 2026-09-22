import { applyMigrations } from '../database';

/**
 * UN IPAD QUE YA ESTABA ACTIVADO TIENE QUE PODER SEGUIR FICHANDO TRAS ACTUALIZAR.
 *
 * Esta prueba existe por un fallo real y silencioso. La tarea del motivo de pausa
 * añadió `break_reason` a la sentencia `create table` de la cola y no escribió ninguna
 * migración. `create table if not exists` NO toca una tabla que ya existe, así que un
 * iPad ya activado se habría quedado con la tabla vieja y CADA FICHAJE habría fallado
 * al insertar en una columna inexistente —en un reloj compartido, con la cola detrás,
 * y sin más síntoma que un error al guardar—.
 *
 * No se veía por ningún lado: una instalación nueva crea la tabla completa, y las
 * pruebas crean la base de cero. Solo aparece al ACTUALIZAR, que es lo que le pasa a
 * todo dispositivo que ya está en una tienda.
 *
 * Aquí no hay SQLite —Jest no lo tiene— así que se comprueba lo que sí se puede y es
 * lo que importa: qué sentencias emite la migración ante una base vieja.
 */

type Fila = { name: string };

function baseFalsa(columnas: string[]) {
  const ejecutadas: string[] = [];
  const database = {
    getAllAsync: (consulta: string): Promise<Fila[]> => {
      if (consulta.includes('outbox_time_events')) {
        return Promise.resolve(columnas.map((name) => ({ name })));
      }
      // `pending_media` con su columna ya puesta: no es lo que se mide aquí.
      return Promise.resolve([{ name: 'local_uri' }, { name: 'event_id' }]);
    },
    execAsync: (sql: string): Promise<void> => {
      ejecutadas.push(sql);
      return Promise.resolve();
    },
  };
  return { database, ejecutadas };
}

const COMPLETAS = [
  'idempotency_key',
  'event_type',
  'break_type',
  'break_reason',
  'break_note',
  'departure_reason',
  'departure_note',
  'shift_id',
];

describe('migración de la cola de fichajes', () => {
  it('a una base vieja le añade las dos columnas que le faltan', async () => {
    const { database, ejecutadas } = baseFalsa(['idempotency_key', 'event_type', 'break_type']);
    await applyMigrations(database as never, 3);

    expect(ejecutadas).toContain('alter table outbox_time_events add column break_reason text');
    expect(ejecutadas).toContain('alter table outbox_time_events add column break_note text');
  });

  /**
   * El caso intermedio, y es el que de verdad va a existir: un iPad que ya corrió el
   * esquema con `break_reason` —porque se instaló la versión del motivo— y al que solo
   * le falta la nota. Migrar por número de versión y no columna a columna dejaría a
   * este a medias, o intentaría añadir dos veces una columna que ya está.
   */
  it('a una base a medias le añade solo lo que le falta', async () => {
    const { database, ejecutadas } = baseFalsa([
      'idempotency_key',
      'event_type',
      'break_type',
      'break_reason',
    ]);
    await applyMigrations(database as never, 3);

    expect(ejecutadas).toContain('alter table outbox_time_events add column break_note text');
    expect(ejecutadas).not.toContain('alter table outbox_time_events add column break_reason text');
  });

  it('a una base ya al día no le toca nada', async () => {
    const { database, ejecutadas } = baseFalsa(COMPLETAS);
    await applyMigrations(database as never, 3);
    expect(ejecutadas.filter((sql) => sql.includes('outbox_time_events'))).toEqual([]);
  });

  /**
   * v4 → v5, el mismo caso una versión más tarde: un reloj que se quedó en la versión
   * del motivo de pausa y al que le faltan las dos columnas de la salida anticipada.
   *
   * Sin esta migración el primer fichaje sin conexión tras actualizar falla al insertar
   * una columna que en ese aparato no existe —y falla EN EL RELOJ, con la cola detrás,
   * que es el peor sitio donde puede fallar nada.
   */
  it('a una base de la versión anterior le añade las columnas de la salida anticipada', async () => {
    const { database, ejecutadas } = baseFalsa([
      'idempotency_key',
      'event_type',
      'break_type',
      'break_reason',
      'break_note',
      'shift_id',
    ]);
    await applyMigrations(database as never, 4);

    expect(ejecutadas).toContain('alter table outbox_time_events add column departure_reason text');
    expect(ejecutadas).toContain('alter table outbox_time_events add column departure_note text');
    expect(ejecutadas).not.toContain('alter table outbox_time_events add column break_reason text');
  });

  /**
   * Una instalación NUEVA llega con `previous = 0`: la tabla no existe todavía y la
   * crea el esquema completo. Tocarla aquí fallaría con «no such table» antes de que la
   * app llegara a arrancar.
   */
  it('en una instalación nueva no intenta alterar una tabla que aún no existe', async () => {
    const { database, ejecutadas } = baseFalsa([]);
    await applyMigrations(database as never, 0);
    expect(ejecutadas).toEqual([]);
  });
});
