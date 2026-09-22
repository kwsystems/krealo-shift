import {
  EARLY_DEPARTURE_REASONS,
  pideMotivoDeSalida,
  requiresDepartureNote,
  type EarlyDepartureReason,
} from '@/domain/early-departure-reason';

const AHORA = new Date('2026-09-22T17:00:00.000Z');
const en = (minutos: number) => new Date(AHORA.getTime() + minutos * 60_000);

describe('pideMotivoDeSalida', () => {
  it('no pregunta si la ubicacion lo tiene apagado (umbral 0)', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(300), umbralMinutos: 0 })).toBe(
      false,
    );
  });

  it('con el mismo adelanto SI pregunta cuando el umbral esta puesto: el 0 es lo que apaga', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(300), umbralMinutos: 30 })).toBe(
      true,
    );
  });

  it('no pregunta sin turno: no hay hora de fin contra la que ser temprano', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: null, umbralMinutos: 30 })).toBe(false);
  });

  it('no pregunta por salir cinco minutos antes, que es lo que pedia la decision', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(5), umbralMinutos: 30 })).toBe(false);
  });

  it('no pregunta justo en el umbral: 30 minutos exactos todavia no lo pasan', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(30), umbralMinutos: 30 })).toBe(
      false,
    );
  });

  it('pregunta un minuto despues del umbral', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(31), umbralMinutos: 30 })).toBe(true);
  });

  it('pregunta en el caso de Andree: turno hasta las 22:00 y se va a las 17:00', () => {
    expect(
      pideMotivoDeSalida({
        ahora: new Date('2026-09-22T17:00:00.000Z'),
        finDelTurno: new Date('2026-09-22T22:00:00.000Z'),
        umbralMinutos: 30,
      }),
    ).toBe(true);
  });

  it('no pregunta si se va DESPUES de su hora: eso no es salir antes', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(-90), umbralMinutos: 30 })).toBe(
      false,
    );
  });

  it('un umbral de 1 minuto es la forma de preguntar practicamente siempre', () => {
    expect(pideMotivoDeSalida({ ahora: AHORA, finDelTurno: en(2), umbralMinutos: 1 })).toBe(true);
  });

  it('un umbral que no es un numero no enciende la pregunta', () => {
    expect(
      pideMotivoDeSalida({
        ahora: AHORA,
        finDelTurno: en(300),
        umbralMinutos: Number.NaN,
      }),
    ).toBe(false);
  });
});

describe('requiresDepartureNote', () => {
  it('solo «Otro» obliga a escribir', () => {
    expect(requiresDepartureNote('other')).toBe(true);
  });

  it('«Mandado / otra sede» NO la pide: es el motivo que mas queremos que se diga de verdad', () => {
    expect(requiresDepartureNote('errand')).toBe(false);
  });

  it('ningun otro motivo la pide', () => {
    const conNota = EARLY_DEPARTURE_REASONS.filter((r) => requiresDepartureNote(r));
    expect(conNota).toEqual(['other']);
  });
});

describe('la lista de motivos', () => {
  it('no tiene repetidos', () => {
    expect(new Set(EARLY_DEPARTURE_REASONS).size).toBe(EARLY_DEPARTURE_REASONS.length);
  });

  it('«Otro» va el ultimo, para que sea la salida y no el atajo', () => {
    expect(EARLY_DEPARTURE_REASONS[EARLY_DEPARTURE_REASONS.length - 1]).toBe('other');
  });

  it('incluye el caso que pidio Andree: irse porque te mandaron a otro sitio', () => {
    const reason: EarlyDepartureReason = 'errand';
    expect(EARLY_DEPARTURE_REASONS).toContain(reason);
  });

  it('NO reutiliza los motivos de pausa: «comida» no es un motivo para irse a casa', () => {
    expect(EARLY_DEPARTURE_REASONS).not.toContain('meal' as never);
    expect(EARLY_DEPARTURE_REASONS).not.toContain('rest' as never);
  });
});
