import {
  BREAK_REASONS,
  DEFAULT_PAID_REASONS,
  breakTypeForReason,
  type BreakReason,
} from '../break-reason';

/**
 * Qué motivos cuentan como tiempo trabajado.
 *
 * ESTO DECIDE LO QUE SE LE PAGA A ALGUIEN, así que no puede vivir solo en la cabeza de
 * quien escribió la tabla. Un motivo mal clasificado no rompe nada, no sale en ningún
 * error y no lo ve nadie: simplemente, cada vez que esa persona se ausenta por ese
 * motivo, cobra de menos o de más.
 */

describe('la tabla de motivos pagados', () => {
  /**
   * Sin esto, añadir un motivo nuevo y olvidarse de clasificarlo lo dejaría en
   * `undefined`, y `breakTypeForReason` lo trataría como no pagado en silencio. El
   * compilador ya lo exige con `Record<BreakReason, boolean>`, pero esta prueba lo
   * sostiene aunque alguien afloje ese tipo.
   */
  it('clasifica TODOS los motivos, sin huecos', () => {
    for (const reason of BREAK_REASONS) {
      expect(typeof DEFAULT_PAID_REASONS[reason]).toBe('boolean');
    }
  });

  it('el trabajo que pide la empresa cuenta: reunión, capacitación, mandado y descanso corto', () => {
    expect(breakTypeForReason('meeting', undefined)).toBe('paid');
    expect(breakTypeForReason('training', undefined)).toBe('paid');
    expect(breakTypeForReason('errand', undefined)).toBe('paid');
    expect(breakTypeForReason('rest', undefined)).toBe('paid');
  });

  it('el tiempo propio no cuenta: comida y permiso personal', () => {
    expect(breakTypeForReason('meal', undefined)).toBe('unpaid');
    expect(breakTypeForReason('permit', undefined)).toBe('unpaid');
  });

  /**
   * «Otro» NO cuenta, y es deliberado: es el cajón de sastre, y ante la duda es mejor
   * que alguien reclame una hora que no se le pagó —se corrige— a que la empresa pague
   * horas que nadie sabe de qué eran. Por eso mismo hacía falta `errand`: sin él, un
   * mandado real acababa aquí y le quitaba horas a quien estaba trabajando.
   */
  it('«Otro» no cuenta, porque es el cajón de sastre', () => {
    expect(breakTypeForReason('other', undefined)).toBe('unpaid');
  });

  /** La tabla es un punto de partida: cada sede la cambia y su decisión manda. */
  it('lo que configure la sede gana sobre el valor de fábrica', () => {
    expect(breakTypeForReason('meal', { meal: true })).toBe('paid');
    expect(breakTypeForReason('errand', { errand: false })).toBe('unpaid');
  });

  it('un motivo que la sede no configuró conserva su valor de fábrica', () => {
    expect(breakTypeForReason('errand', { meal: true })).toBe('paid');
  });
});

describe('el motivo «mandado»', () => {
  /**
   * El caso que lo motivó (Andree, 2026-09-22): alguien sale a llevar algo al almacén.
   * Está trabajando, pero desde la puerta parece que se va.
   */
  it('existe y cuenta como trabajado', () => {
    const reason: BreakReason = 'errand';
    expect(BREAK_REASONS).toContain(reason);
    expect(DEFAULT_PAID_REASONS.errand).toBe(true);
  });
});
