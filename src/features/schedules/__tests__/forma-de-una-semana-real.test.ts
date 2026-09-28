import { detectOverlaps, scheduledMinutesByEmployee, type ScheduledShift } from '../conflicts';
import { refrigerioDeUnTurno } from '../pegar-horario';

/**
 * UNA SEMANA DE VERDAD DE LA TIENDA, PASADA POR LAS FUNCIONES DE LA APP.
 *
 * POR QUÉ EXISTE. Antes de poner a cinco personas a fichar se preguntó lo obvio: ¿sabe
 * esta app expresar el horario que la tienda usa de verdad? Las pruebas que había miden
 * casos sueltos —un turno, un solape, un descanso— y eso no contesta la pregunta. Una
 * semana real trae a la vez turnos de nueve horas, uno de cuatro y media, jornadas hasta
 * las 22:00, dos días de descanso seguidos y alguien que deja de trabajar a media semana.
 *
 * LO QUE DE VERDAD COMPRUEBA es que los totales que salen de la app son los mismos que
 * la tienda tiene apuntados. Eso no es aritmética: depende de una regla que no estaba
 * escrita en ningún sitio y que se deduce de los totales —una hora de refrigerio no
 * pagado en los turnos de ocho horas o más— y de que el refrigerio viva en el TURNO
 * (`plannedUnpaidBreakMinutes`) y no en lo que marque la persona. Si alguien cambia
 * cualquiera de las dos cosas, la app empezará a decir 54 h donde la tienda dice 48, y
 * la primera conclusión de cualquiera será que la app cuenta mal.
 *
 * SIN NOMBRES: A, B, C, D, E. Los horarios de una tienda no son secretos —están en su
 * puerta— pero los nombres de las trabajadoras no entran en un repositorio público.
 */
const TZ = '-05:00'; // America/Lima, sin horario de verano
type Turno = [string, string, string] | null;
type Fila = [string, Turno[]];

const SEMANA: Fila[] = [
  ['A', [null, ['2026-09-29','10:00','19:00'], ['2026-09-30','11:00','20:00'], ['2026-10-01','10:00','19:00'], ['2026-10-02','10:00','19:00'], ['2026-10-03','12:00','21:00'], ['2026-10-04','13:00','22:00']]],
  ['B', [['2026-09-28','10:00','19:00'], ['2026-09-29','12:00','21:00'], ['2026-09-30','10:00','19:00'], ['2026-10-01','17:30','22:00'], null, ['2026-10-03','11:00','22:00'], ['2026-10-04','10:00','20:30']]],
  ['C', [null, null, ['2026-09-30','16:00','21:00'], ['2026-10-01','10:00','22:00'], ['2026-10-02','10:00','22:00'], ['2026-10-03','10:00','22:00'], ['2026-10-04','10:00','21:00']]],
  ['D', [['2026-09-28','17:00','21:00'], ['2026-09-29','17:00','20:30'], null, ['2026-10-01','18:30','22:00'], ['2026-10-02','17:30','21:30'], ['2026-10-03','18:00','22:00'], ['2026-10-04','17:30','22:00']]],
  ['E', [null, ['2026-09-29','17:00','21:00'], ['2026-09-30','17:00','21:00'], null, null, null, null]],
];

/*
 * La regla que sale de los totales de la tabla —1 h de refrigerio en turnos de 8 h o
 * mas— estaba escrita a mano aqui. Ahora es codigo de la app, porque el importador de
 * horarios la aplica al pegar una semana, y se importa desde alli: si alguien cambia el
 * umbral, esta prueba tiene que dejar de cuadrar con los totales de la tienda.
 */
const REFRIGERIO = refrigerioDeUnTurno;

const turnos: ScheduledShift[] = [];
for (const [quien, dias] of SEMANA) {
  dias.forEach((d, i) => {
    if (d === null) return;
    const [fecha, desde, hasta] = d;
    const startsAt = `${fecha}T${desde}:00${TZ}`;
    const endsAt = `${fecha}T${hasta}:00${TZ}`;
    const bruto = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000;
    turnos.push({
      id: `${quien}-${i}`, employeeId: quien, employeeName: quien,
      startsAt, endsAt, plannedUnpaidBreakMinutes: REFRIGERIO(bruto), status: 'published',
    });
  });
}

describe('la app sabe expresar una semana real de la tienda', () => {
  it('los totales por persona son los de la tabla de la tienda', () => {
    const t = scheduledMinutesByEmployee(turnos);
    expect(t.get('A')).toBe(48 * 60);
    expect(t.get('B')).toBe(48 * 60);
    expect(t.get('C')).toBe(48 * 60);
    expect(t.get('D')).toBe(23 * 60 + 30);
    expect(t.get('E')).toBe(8 * 60);
  });

  it('no inventa solapes donde no hay', () => {
    expect(detectOverlaps(turnos)).toEqual([]);
  });

  it('25 turnos: los descansos no son turnos, y quien se va no deja huecos', () => {
    expect(turnos).toHaveLength(25);
    expect(turnos.filter((s) => s.employeeId === 'E')).toHaveLength(2);
  });
});
