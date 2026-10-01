import {
  aplicaAlDia,
  chocaConElTurno,
  diaDeSemanaIso,
  disponibilidadDelDia,
  type Disponibilidad,
} from '../disponibilidad';

/** «Los martes no puedo» y «el 15 tengo cita»: qué aplica a qué día y con qué choca. */

const fila = (extra: Partial<Disponibilidad>): Disponibilidad => ({
  id: 'd1',
  employee_id: 'e1',
  kind: 'weekly',
  weekday: 2,
  date: null,
  type: 'unavailable',
  from_time: null,
  to_time: null,
  note: null,
  status: 'new',
  source: 'employee',
  updated_at: null,
  ...extra,
});

describe('disponibilidad', () => {
  it('el día de la semana es ISO: lunes 1, domingo 7', () => {
    expect(diaDeSemanaIso('2026-09-28')).toBe(1);
    expect(diaDeSemanaIso('2026-09-29')).toBe(2);
    expect(diaDeSemanaIso('2026-10-04')).toBe(7);
  });

  it('«los martes» aplica a todos los martes; «el 15», solo al 15', () => {
    expect(aplicaAlDia(fila({}), '2026-09-29')).toBe(true);
    expect(aplicaAlDia(fila({}), '2026-10-06')).toBe(true);
    expect(aplicaAlDia(fila({}), '2026-09-30')).toBe(false);
    const dia = fila({ kind: 'date', weekday: null, date: '2026-10-15' });
    expect(aplicaAlDia(dia, '2026-10-15')).toBe(true);
    expect(aplicaAlDia(dia, '2026-10-22')).toBe(false);
  });

  it('lo del día concreto va antes que lo de cada semana, y lo que impide antes que la nota', () => {
    const filas = [
      fila({ id: 'semanal-nota', type: 'note', note: 'x' }),
      fila({ id: 'semanal' }),
      fila({ id: 'del-dia', kind: 'date', weekday: null, date: '2026-09-29', type: 'note' }),
      fila({ id: 'de-otra', employee_id: 'e2' }),
    ];
    expect(disponibilidadDelDia(filas, 'e1', '2026-09-29').map((f) => f.id)).toEqual([
      'del-dia',
      'semanal',
      'semanal-nota',
    ]);
  });

  it('choca si no puede todo el día o la franja se pisa con el turno', () => {
    const turno = { desde: 9 * 60, hasta: 15 * 60 };
    expect(chocaConElTurno(fila({}), turno)).toBe(true);
    expect(chocaConElTurno(fila({ from_time: '08:00', to_time: '10:00' }), turno)).toBe(true);
    expect(chocaConElTurno(fila({ from_time: '15:00', to_time: '22:00' }), turno)).toBe(false);
    expect(
      chocaConElTurno(fila({ type: 'preferred', from_time: '14:00', to_time: '22:00' }), turno),
    ).toBe(false);
    expect(chocaConElTurno(fila({ type: 'note', note: 'x' }), turno)).toBe(false);
  });
});
