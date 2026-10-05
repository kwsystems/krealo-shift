import type { TFunction } from 'i18next';

import {
  esSalidaAutomatica,
  etiquetaDeSalidaAutomatica,
  marcaConSalidaAutomatica,
  tramoConSalida,
} from '../textos-de-salida';

/** La salida que puso el sistema (5-oct) se dice igual en todas las pantallas. */

const t = ((clave: string, valores?: { from?: string }) =>
  clave === 'timesheet.autoExitLabel'
    ? 'Salida automática'
    : clave === 'portal.markOpen'
      ? `Entraste ${valores?.from}`
      : clave) as unknown as TFunction;

describe('textos de la salida automática', () => {
  it('solo la jornada marcada por el sistema lo es', () => {
    expect(esSalidaAutomatica({ auto_clock_out: true })).toBe(true);
    expect(esSalidaAutomatica({ auto_clock_out: false })).toBe(false);
    expect(esSalidaAutomatica({})).toBe(false);
  });

  it('el tramo lo dice detrás, y el de siempre no cambia', () => {
    expect(etiquetaDeSalidaAutomatica(t)).toBe('Salida automática');
    expect(tramoConSalida(t, { auto_clock_out: true }, '10:00 – 19:00')).toBe(
      '10:00 – 19:00 · Salida automática',
    );
    expect(tramoConSalida(t, { auto_clock_out: false }, '10:00 – 19:00')).toBe('10:00 – 19:00');
  });

  it('en el celular no dice «Marcaste» una salida que no marcó', () => {
    expect(marcaConSalidaAutomatica(t, '10:00', '19:00')).toBe(
      'Entraste 10:00 · Salida automática 19:00',
    );
  });
});
