import { describeQueueFlush, describeSeen, isSyncStale } from '../settings-panel';

/**
 * Estado de un kiosco en el panel (§11.6, §19).
 *
 * Lo que se fija es la decisión que el panel y el trabajo de notificaciones tienen
 * que tomar IGUAL sobre el mismo iPad: si está atrasado o no. Si se separan, el
 * teléfono avisa de un reloj que la pantalla muestra como correcto.
 *
 * Y SOBRE TODO, se fija cuál de los dos campos se mide. La versión anterior medía
 * `minutes_since_sync` —cuánto lleva sin VACIAR LA COLA— y trataba `null` como
 * atrasado. Pero ese campo solo lo escribe la sincronización offline: en un iPad con
 * buen wifi se queda en `null` para siempre, así que la pantalla marcaba en ámbar
 * todos los kioscos sanos y la alerta del §19 avisaba todos los días. Una alerta que
 * siempre está encendida entrena a ignorarla.
 */

const t = (key: string, options?: Record<string, unknown>): string =>
  options === undefined ? key : `${key}:${JSON.stringify(options)}`;

describe('isSyncStale', () => {
  it('marca atrasado el que pasó del umbral sin dar señales', () => {
    expect(isSyncStale({ status: 'active', minutes_since_seen: 121 }, 120)).toBe(true);
  });

  it('no marca atrasado el que está justo en el umbral', () => {
    // El umbral es "más de", no "a partir de": si no, un kiosco que da señales cada
    // 120 minutos exactos avisaría en cada pasada.
    expect(isSyncStale({ status: 'active', minutes_since_seen: 120 }, 120)).toBe(false);
  });

  it('NO marca atrasado un kiosco que habla con el servidor pero nunca vació la cola', () => {
    // EL CASO QUE FALLABA. Un iPad con buen wifi nunca tiene eventos encolados, así
    // que nunca "sincroniza": eso es lo normal y lo bueno. Antes esta era la
    // situación de todos los kioscos sanos y todos salían en ámbar.
    expect(isSyncStale({ status: 'active', minutes_since_seen: 3 }, 120)).toBe(false);
  });

  it('ignora los revocados', () => {
    // Un kiosco revocado no debe dar señales: avisar de eso sería avisar de que la
    // revocación funcionó.
    expect(isSyncStale({ status: 'revoked', minutes_since_seen: 9999 }, 120)).toBe(false);
  });
});

describe('describeSeen', () => {
  it('usa minutos por debajo de una hora', () => {
    expect(describeSeen(45, 120, t)).toBe('settings.kioskSyncFresh:{"minutes":45}');
  });

  it('usa horas por encima de una hora, redondeando hacia abajo', () => {
    expect(describeSeen(119, 120, t)).toBe('settings.kioskSyncHours:{"hours":1}');
  });

  it('dice "sin sincronizar" cuando pasó del umbral', () => {
    // El texto lo dice; no se deja el juicio en manos de quien lee "hace 7 h".
    expect(describeSeen(430, 120, t)).toBe('settings.kioskSyncStale:{"hours":7}');
  });

  it('respeta un umbral configurado más alto', () => {
    expect(describeSeen(430, 600, t)).toBe('settings.kioskSyncHours:{"hours":7}');
  });
});

describe('describeQueueFlush', () => {
  it('sin nada que sincronizar NO dice "nunca sincronizó"', () => {
    // "Nunca sincronizó" se lee como un problema, y es el caso normal de una tienda
    // con red estable: nunca hubo nada pendiente.
    expect(describeQueueFlush(null, t)).toBe('settings.kioskNothingToSync');
  });

  it('cuando sí vació la cola, dice cuándo', () => {
    expect(describeQueueFlush(20, t)).toBe('settings.kioskSyncFresh:{"minutes":20}');
    expect(describeQueueFlush(200, t)).toBe('settings.kioskSyncHours:{"hours":3}');
  });

  it('no juzga: aquí no hay umbral', () => {
    // Llevar mucho sin vaciar la cola no es un problema por sí mismo. Lo que importa
    // es si el iPad sigue hablando, y eso lo mide `describeSeen`.
    expect(describeQueueFlush(9999, t)).toBe('settings.kioskSyncHours:{"hours":166}');
  });
});
