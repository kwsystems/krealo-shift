import { describeSync, isSyncStale } from '../settings-panel';

/**
 * Estado de sincronización de un kiosco (§11.6, §19).
 *
 * Lo que se fija aquí es la decisión que el panel y el trabajo de notificaciones
 * tienen que tomar IGUAL sobre el mismo iPad: si está atrasado o no. Si se
 * separan, el teléfono avisa de un reloj que la pantalla muestra como correcto.
 */

const t = (key: string, options?: Record<string, unknown>): string =>
  options === undefined ? key : `${key}:${JSON.stringify(options)}`;

describe('isSyncStale', () => {
  it('marca atrasado el que pasó del umbral', () => {
    expect(isSyncStale({ status: 'active', minutes_since_sync: 121 }, 120)).toBe(true);
  });

  it('no marca atrasado el que está justo en el umbral', () => {
    // El umbral es "más de", no "a partir de": si no, un kiosco que sincroniza
    // cada 120 minutos exactos avisaría en cada pasada.
    expect(isSyncStale({ status: 'active', minutes_since_sync: 120 }, 120)).toBe(false);
  });

  it('marca atrasado el que NUNCA sincronizó', () => {
    // Es el caso que importa: un iPad activado que jamás sincronizó es uno que
    // nadie terminó de instalar. Tratar `null` como "sin datos" lo esconde.
    expect(isSyncStale({ status: 'active', minutes_since_sync: null }, 120)).toBe(true);
  });

  it('ignora los revocados, incluso si nunca sincronizaron', () => {
    // Un kiosco revocado no debe sincronizar: avisar de eso sería avisar de que
    // la revocación funcionó.
    expect(isSyncStale({ status: 'revoked', minutes_since_sync: null }, 120)).toBe(false);
    expect(isSyncStale({ status: 'revoked', minutes_since_sync: 9999 }, 120)).toBe(false);
  });
});

describe('describeSync', () => {
  it('dice que nunca sincronizó', () => {
    expect(describeSync(null, 120, t)).toBe('settings.kioskNeverSynced');
  });

  it('usa minutos por debajo de una hora', () => {
    expect(describeSync(45, 120, t)).toBe('settings.kioskSyncFresh:{"minutes":45}');
  });

  it('usa horas por encima de una hora, redondeando hacia abajo', () => {
    expect(describeSync(119, 120, t)).toBe('settings.kioskSyncHours:{"hours":1}');
  });

  it('dice "sin sincronizar" cuando pasó del umbral', () => {
    // El texto lo dice; no se deja el juicio en manos de quien lee "hace 7 h".
    expect(describeSync(430, 120, t)).toBe('settings.kioskSyncStale:{"hours":7}');
  });

  it('respeta un umbral configurado más alto', () => {
    expect(describeSync(430, 600, t)).toBe('settings.kioskSyncHours:{"hours":7}');
  });
});
