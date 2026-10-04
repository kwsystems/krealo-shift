import type { EligibleShift } from '../api';
import {
  diaRelativo,
  MARGEN_DEL_PERMISO_MS,
  permisoVigenteHasta,
  proximoTurno,
  turnoInicial,
  turnosParaEntrar,
} from '../turnos-del-reloj';

/**
 * El turno que enseña el reloj y el que queda elegido (4-oct).
 *
 * Lo que vio Andree en la tienda: una vendedora que venía a SALIR tenía «Elige tu turno»
 * con «10:00 – 22:00» y «10:00 – 21:00», el de hoy y el de mañana, sin el día. Y con un
 * solo turno —el de mañana— el reloj lo elegía por ella y la entrada de hoy quedaba atada a
 * él. Cada prueba es una de esas dos formas.
 */

const ZONA = 'America/Lima';
// Lima es UTC-5: el sábado 3-oct a la hora local indicada.
const sab = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 9, 3, hora + 5, minuto)).toISOString();
const dom = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 9, 4, hora + 5, minuto)).toISOString();
const vie = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 9, 2, hora + 5, minuto)).toISOString();

function turno(id: string, startsAt: string, endsAt: string): EligibleShift {
  return {
    id,
    startsAt,
    endsAt,
    jobRoleName: 'Personal de ventas',
    employeeNote: null,
    plannedUnpaidBreakMinutes: 60,
    changedSinceLastPublication: false,
  };
}

const deHoy = turno('hoy', sab(10), sab(22));
const deManana = turno('manana', dom(10), dom(21));

describe('de qué día es', () => {
  const ahora = new Date(sab(21, 30));
  it('hoy, mañana y ayer, en la zona de la tienda', () => {
    expect(diaRelativo(sab(10), ZONA, ahora)).toBe('today');
    expect(diaRelativo(dom(10), ZONA, ahora)).toBe('tomorrow');
    expect(diaRelativo(vie(9, 48), ZONA, ahora)).toBe('yesterday');
    expect(diaRelativo(new Date(Date.UTC(2026, 9, 6, 15)).toISOString(), ZONA, ahora)).toBe(
      'other',
    );
  });

  /** A las 21:00 de Lima ya es domingo en UTC: cortar la cadena diría «mañana». */
  it('un turno de esta noche sigue siendo de hoy aunque en UTC ya sea mañana', () => {
    expect(diaRelativo(sab(21), ZONA, new Date(sab(20)))).toBe('today');
  });
});

describe('qué se puede elegir al entrar', () => {
  it('el de mañana NO se ofrece: no es un turno al que se pueda entrar ahora', () => {
    expect(
      turnosParaEntrar([deHoy, deManana], new Date(sab(9, 48)), ZONA).map((t) => t.id),
    ).toEqual(['hoy']);
  });

  it('un turno de hoy que ya terminó tampoco', () => {
    const manana = turno('m', sab(10), sab(14));
    const tarde = turno('t', sab(17), sab(21));
    expect(turnosParaEntrar([tarde, manana], new Date(sab(15)), ZONA).map((t) => t.id)).toEqual([
      't',
    ]);
  });

  it('el turno partido de hoy se ofrece entero, en orden', () => {
    const manana = turno('m', sab(10), sab(14));
    const tarde = turno('t', sab(17), sab(21));
    expect(
      turnosParaEntrar([tarde, deManana, manana], new Date(sab(9, 50)), ZONA).map((t) => t.id),
    ).toEqual(['m', 't']);
  });

  it('el de noche que empezó ayer y sigue en curso, sí', () => {
    const noche = turno('noche', vie(22), sab(6));
    expect(turnosParaEntrar([noche], new Date(sab(0, 30)), ZONA).map((t) => t.id)).toEqual([
      'noche',
    ]);
  });
});

describe('el turno que queda elegido', () => {
  it('con la jornada abierta, el de la jornada, aunque haya otros', () => {
    expect(
      turnoInicial({
        turnos: [deHoy, deManana],
        turnoDeLaJornada: 'hoy',
        ahora: new Date(sab(21, 50)),
        zona: ZONA,
      }),
    ).toBe('hoy');
  });

  it('al entrar con solo el de mañana, NINGUNO: antes se elegía el de mañana', () => {
    expect(
      turnoInicial({
        turnos: [deManana],
        turnoDeLaJornada: null,
        ahora: new Date(sab(9, 48)),
        zona: ZONA,
      }),
    ).toBeNull();
  });

  it('con turno partido, el que está en curso o, si no, el siguiente', () => {
    const manana = turno('m', sab(10), sab(14));
    const tarde = turno('t', sab(17), sab(21));
    const elegido = (hora: number) =>
      turnoInicial({
        turnos: [manana, tarde],
        turnoDeLaJornada: null,
        ahora: new Date(sab(hora)),
        zona: ZONA,
      });
    expect(elegido(9)).toBe('m');
    expect(elegido(11)).toBe('m');
    expect(elegido(15)).toBe('t');
    expect(elegido(22)).toBeNull();
  });

  it('el próximo turno, para decir cuándo le toca aunque hoy no tenga', () => {
    expect(proximoTurno([deManana, deHoy], new Date(sab(23)))?.id).toBe('manana');
    expect(proximoTurno([deManana, deHoy], new Date(sab(12)))?.id).toBe('hoy');
  });
});

describe('hasta cuándo vale el permiso del PIN', () => {
  it('se cuenta desde que llegó la respuesta, no con la hora del servidor', () => {
    expect(
      permisoVigenteHasta({
        recibidoEn: 1_000_000,
        expiresInSeconds: 300,
        // Un servidor con otra hora: no se mira cuando hay duración.
        expiresAt: '2001-01-01T00:00:00.000Z',
      }),
    ).toBe(1_000_000 + 300_000 - MARGEN_DEL_PERMISO_MS);
  });

  it('un servidor de antes, sin duración, usa su `expiresAt`', () => {
    const expiresAt = '2026-10-03T22:00:00.000Z';
    expect(permisoVigenteHasta({ recibidoEn: 0, expiresInSeconds: undefined, expiresAt })).toBe(
      Date.parse(expiresAt) - MARGEN_DEL_PERMISO_MS,
    );
  });
});
