import type { TFunction } from 'i18next';

import { decisionesDeLaJornada, textoDeDecision } from '../decisiones-de-la-jornada';

const t = ((clave: string, opciones?: Record<string, unknown>) =>
  opciones === undefined ? clave : `${clave} ${JSON.stringify(opciones)}`) as unknown as TFunction;

const jornada = (extra: Partial<Parameters<typeof decisionesDeLaJornada>[0]> = {}) => ({
  id: 'emp_2026-10-12T15:00:00.000Z',
  casos_resueltos: [] as string[],
  casos_decision: undefined,
  unpaid_break_minutes: 0,
  ...extra,
});

describe('lo que se decidió en una jornada', () => {
  it('sin decisiones no hay nada que cambiar', () => {
    expect(decisionesDeLaJornada(jornada())).toEqual([]);
  });

  it('el refrigerio descontado, con su nota o reconocido por sus fichajes', () => {
    expect(
      decisionesDeLaJornada(
        jornada({
          casos_decision: {
            refrigerio_del_turno: { decision: 'applied', nota: null, minutos: 60 },
          },
          unpaid_break_minutes: 60,
        }),
      ),
    ).toEqual([{ clave: 'refrigerio_del_turno', decision: 'applied', nota: null, minutos: 60 }]);

    // Antes del 13-oct no quedaba nota: se reconoce por el id fijo de su pausa.
    const vieja = jornada({ unpaid_break_minutes: 60 });
    expect(
      decisionesDeLaJornada(vieja, [
        { id: 'org_kiosk_1' },
        { id: `org_refrigerio_${vieja.id}_break_start` },
      ]),
    ).toEqual([{ clave: 'refrigerio_del_turno', decision: 'applied', nota: null, minutos: 60 }]);
    // La pausa de OTRA jornada no es de esta.
    expect(decisionesDeLaJornada(vieja, [{ id: 'org_refrigerio_otra_break_start' }])).toEqual([]);
  });

  it('los casos resueltos, con lo decidido o sin saberlo, en un orden fijo', () => {
    const lista = decisionesDeLaJornada(
      jornada({
        casos_resueltos: ['salida_automatica', 'faltan_horas'],
        casos_decision: { faltan_horas: { decision: 'owes', nota: 'Se enfermó', minutos: null } },
      }),
    );
    expect(lista.map((d) => [d.clave, d.decision, d.nota])).toEqual([
      ['faltan_horas', 'owes', 'Se enfermó'],
      ['salida_automatica', 'unknown', null],
    ]);
  });

  it('cada decisión se dice con su texto', () => {
    expect(
      textoDeDecision(t, {
        clave: 'faltan_horas',
        decision: 'justified',
        nota: null,
        minutos: null,
      }),
    ).toBe('timesheet.decisions.justified');
    expect(
      textoDeDecision(t, {
        clave: 'refrigerio_del_turno',
        decision: 'applied',
        nota: null,
        minutos: null,
      }),
    ).toBe('timesheet.decisions.breakApplied');
    expect(
      textoDeDecision(t, {
        clave: 'sin_refrigerio',
        decision: 'worked_through',
        nota: null,
        minutos: null,
      }),
    ).toBe('timesheet.decisions.workedThrough');
  });
});
