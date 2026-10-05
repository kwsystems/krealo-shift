import { resumirCorrecciones, type FilaDeCorreccion } from '../correcciones';

/**
 * El resumen de la casilla de correcciones de Reportes: por tipo, por persona, y lo
 * registrado desde el horario aparte —no es un fichaje que el reloj no recogió—.
 */

const fila = (tipo: FilaDeCorreccion['tipo'], employee_id: string | null): FilaDeCorreccion => ({
  tipo,
  employee_id,
  work_date: '2026-09-22',
  author_name: 'Gerente',
});

const filas = [
  fila('fichaje_anadido', 'a'),
  fila('fichaje_anadido', 'b'),
  fila('hora_corregida', 'a'),
  fila('solicitud_aprobada', 'b'),
  fila('segun_horario', 'a'),
  fila('segun_horario', 'a'),
  fila('cumplido_especial', 'b'),
  // La salida que puso el sistema (5-oct): cuenta, porque es un fichaje que faltó.
  fila('salida_automatica', 'a'),
];

describe('resumen de correcciones', () => {
  it('cuenta por tipo y deja lo del horario aparte', () => {
    expect(resumirCorrecciones(filas, null)).toEqual({
      total: 5,
      porTipo: {
        fichaje_anadido: 2,
        hora_corregida: 1,
        salida_a_pausa: 0,
        solicitud_aprobada: 1,
        salida_automatica: 1,
      },
      segunHorario: 2,
      // Miembro de mesa (4-oct): aparte, ni corrección ni «según horario».
      cumplidosEspeciales: 1,
    });
  });

  it('con una persona elegida, solo las suyas', () => {
    expect(resumirCorrecciones(filas, 'b')).toMatchObject({ total: 2, segunHorario: 0 });
  });

  it('sin filas, cero', () => {
    expect(resumirCorrecciones([], null).total).toBe(0);
  });
});
