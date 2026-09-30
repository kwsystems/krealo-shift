import type { TFunction } from 'i18next';

import es from '@/i18n/locales/es-PE.json';

import { propuestaDe, RechazoDeLaSolicitud, registraFichajes } from '../api';
import { mensajeDelFallo } from '../requests-panel';

/**
 * Lo que la Bandeja enseña de una solicitud, y lo que dice cuando no puede aprobarla.
 *
 * Las del reloj guardaban la hora tal como se tecleó, «14:30», y la Bandeja la pintaba
 * como «--:--» sin fecha: no había nada que aprobar. Y al aprobar, un fallo del servidor
 * no se enseñaba: el botón giraba y la solicitud seguía ahí.
 */

const LIMA = 'America/Lima';
const base = {
  target_date: null,
  created_at: '2026-09-29T14:00:00.000Z', // 09:00 del 29 en Lima
};

describe('la hora y el día que propone la solicitud', () => {
  it('un instante completo se lee en la hora de la tienda', () => {
    expect(
      propuestaDe({ ...base, proposed_value: { proposedAt: '2026-09-28T13:30:00.000Z' } }, LIMA),
    ).toEqual({ fecha: '2026-09-28', hora: '08:30' });
  });

  it('la hora tecleada en el reloj se lee tal cual, con el día en que se pidió', () => {
    expect(propuestaDe({ ...base, proposed_value: { proposedAt: '14:30' } }, LIMA)).toEqual({
      fecha: '2026-09-29',
      hora: '14:30',
    });
    expect(propuestaDe({ ...base, proposed_value: { proposedAt: '8.05' } }, LIMA).hora).toBe(
      '08:05',
    );
  });

  it('la fecha de la solicitud manda si la trae', () => {
    expect(
      propuestaDe(
        {
          ...base,
          target_date: '2026-09-27',
          proposed_value: { endsAt: '2026-09-28T00:00:00.000Z' },
        },
        LIMA,
      ),
    ).toEqual({ fecha: '2026-09-27', hora: '19:00' });
  });

  it('sin hora, o con una que no se entiende, no se inventa ninguna', () => {
    expect(propuestaDe({ ...base, proposed_value: {} }, LIMA)).toEqual({
      fecha: '2026-09-29',
      hora: null,
    });
    expect(propuestaDe({ ...base, proposed_value: { proposedAt: '25:00' } }, LIMA).hora).toBeNull();
  });

  it('solo los «olvidé marcar» registran fichajes al aprobarse', () => {
    expect(registraFichajes('forgot_clock_in')).toBe(true);
    expect(registraFichajes('forgot_clock_out')).toBe(true);
    expect(registraFichajes('forgot_break')).toBe(true);
    expect(registraFichajes('correction')).toBe(false);
    expect(registraFichajes('unscheduled_shift')).toBe(false);
  });
});

describe('lo que se dice cuando no se pudo', () => {
  // Resuelve la clave contra el español de verdad: un texto que falta saldría como la clave.
  const t = ((clave: string) =>
    clave
      .split('.')
      .reduce<unknown>((nodo, parte) => (nodo as Record<string, unknown>)?.[parte], es) ??
    clave) as unknown as TFunction;

  const casos: [RechazoDeLaSolicitud, RegExp][] = [
    [new RechazoDeLaSolicitud('NO_ENCAJA', 'clock_in', 'WORKING', ''), /ya figuraba dentro/],
    [new RechazoDeLaSolicitud('NO_ENCAJA', 'break_start', 'ON_BREAK', ''), /Solo el final/],
    [new RechazoDeLaSolicitud('NO_ENCAJA', 'break_end', 'WORKING', ''), /Todo el descanso/],
    [new RechazoDeLaSolicitud('NO_ENCAJA', 'clock_out', 'OFF_SHIFT', ''), /fuera de su jornada/],
    [new RechazoDeLaSolicitud('CHOCA', null, null, ''), /chocan/],
    [new RechazoDeLaSolicitud('FALTA_SALIDA', null, null, ''), /a qué hora salió/],
    [new RechazoDeLaSolicitud('YA_RESUELTA', null, null, ''), /ya resolvió/],
  ];

  it.each(casos)('%# el motivo del servidor se convierte en qué hacer', (error, esperado) => {
    expect(mensajeDelFallo(t, error)).toMatch(esperado);
  });

  it('un fallo cualquiera tampoco se calla', () => {
    expect(mensajeDelFallo(t, new Error('boom'))).toBe(es.requests.reviewErrorGeneric);
  });
});
