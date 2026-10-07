import { esJornadaDeCorrido, type JornadaDeCorrido } from '../de-corrido';

/**
 * La jornada de corrido (7-oct): sin almuerzo y se fue antes lo que dura el refrigerio. Las
 * horas en Lima (UTC-5): las 10:00 son las 15:00 Z.
 */
const TURNO = {
  starts_at: '2026-10-06T15:00:00.000Z', // 10:00
  ends_at: '2026-10-07T00:00:00.000Z', // 19:00
  planned_unpaid_break_minutes: 60,
};

const jornada = (
  entrada: string,
  salida: string | null,
  pausas: Partial<JornadaDeCorrido> = {},
): JornadaDeCorrido => ({
  starts_at: `2026-10-06T${entrada}:00.000Z`,
  ends_at: salida === null ? null : `2026-10-06T${salida}:00.000Z`,
  paid_break_minutes: 0,
  unpaid_break_minutes: 0,
  ...pausas,
});

describe('jornada de corrido', () => {
  it('de 09:53 a 18:01 sin pausa, en un turno de 10 a 19 con 1 h: es de corrido', () => {
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [jornada('14:53', '23:01')] })).toBe(true);
  });

  it('el turno entero sin almorzar NO: trabajó una hora más y el caso tiene que preguntar', () => {
    // De 10:00 a 19:00 (las 00:00 Z del día siguiente), sin pausa: 9 h en un turno de 8 netas.
    const enteraSinAlmorzar = { ...jornada('15:00', null), ends_at: TURNO.ends_at };
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [enteraSinAlmorzar] })).toBe(false);
  });

  it('con el almuerzo marcado no es de corrido: es una jornada normal', () => {
    expect(
      esJornadaDeCorrido({
        turno: TURNO,
        jornadas: [jornada('15:00', '23:00', { unpaid_break_minutes: 60 })],
      }),
    ).toBe(false);
  });

  it('dos jornadas del mismo turno: el hueco entre ellas es su almuerzo', () => {
    expect(
      esJornadaDeCorrido({
        turno: TURNO,
        jornadas: [jornada('15:00', '18:00'), jornada('18:30', '23:30')],
      }),
    ).toBe(false);
  });

  it('salir dos horas antes y trabajar de menos sigue siendo salir antes', () => {
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [jornada('15:00', '22:00')] })).toBe(false);
  });

  it('quince minutos de menos ya no: es lo que Horas cuenta como «le faltan»', () => {
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [jornada('15:00', '22:45')] })).toBe(false);
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [jornada('15:00', '22:50')] })).toBe(true);
  });

  it('entrar dos horas antes y salir tres antes no: se fue más que su refrigerio', () => {
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [jornada('13:00', '21:00')] })).toBe(false);
  });

  it('sin refrigerio en el turno, o con la jornada abierta, no', () => {
    expect(
      esJornadaDeCorrido({
        turno: { ...TURNO, planned_unpaid_break_minutes: 0 },
        jornadas: [jornada('15:00', '23:00')],
      }),
    ).toBe(false);
    expect(esJornadaDeCorrido({ turno: TURNO, jornadas: [jornada('15:00', null)] })).toBe(false);
  });
});
