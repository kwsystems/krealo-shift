import {
  parsearHorarioPegado,
  problemaBloquea,
  refrigerioDeUnTurno,
  type EmpleadoConocido,
  type HorarioPegado,
} from '../pegar-horario';
import { weekDays } from '../week';

/**
 * Pegar una semana de horario desde una tabla.
 *
 * LA TABLA DE ABAJO ES LA FORMA DE UNA SEMANA REAL —cinco personas, 25 turnos, dos a
 * tiempo parcial, una que se va a mitad de semana— con los nombres cambiados: este
 * repositorio es público y los nombres de la tienda no entran. Las horas sí son las de
 * verdad, porque son ellas las que hacen la prueba: los totales de la columna «Horas»
 * solo cuadran si el refrigerio se resta donde toca, y son la forma más barata de
 * demostrar que la tabla se entendió y no solo se leyó.
 *
 * Y se pega TAL COMO SE PEGA: con tabuladores, con «– FT» detrás del nombre, con
 * DESCANSO en los días libres y con una raya en los días de quien ya no sigue.
 */

const TZ = 'America/Lima';
const DIAS = weekDays('2026-09-28');

const EQUIPO: EmpleadoConocido[] = [
  { id: 'e-ana', nombre: 'Ana Rivas', jobRoleId: 'puesto-jefa' },
  { id: 'e-bruno', nombre: 'Bruno Salas', jobRoleId: 'puesto-vendedora' },
  { id: 'e-carla', nombre: 'Carla Mendez', jobRoleId: 'puesto-vendedora' },
  { id: 'e-diana', nombre: 'Diana Rojas', jobRoleId: 'puesto-vendedora' },
  { id: 'e-elena', nombre: 'Elena Vidal', jobRoleId: null },
];

const TABLA_REAL = [
  'Personal\tLun 28 Sep\tMar 29 Sep\tMié 30 Sep\tJue 1 Oct\tVie 2 Oct\tSáb 3 Oct\tDom 4 Oct\tHoras',
  'Ana – FT\tDESCANSO\t10:00–19:00\t11:00–20:00\t10:00–19:00\t10:00–19:00\t12:00–21:00\t13:00–22:00\t48h',
  'Bruno – FT\t10:00–19:00\t12:00–21:00\t10:00–19:00\t17:30–22:00\tDESCANSO\t11:00–22:00\t10:00–20:30\t48h',
  'Carla – FT\tDESCANSO\tDESCANSO\t16:00–21:00\t10:00–22:00\t10:00–22:00\t10:00–22:00\t10:00–21:00\t48h',
  'Diana – PT\t17:00–21:00\t17:00–20:30\tDESCANSO\t18:30–22:00\t17:30–21:30\t18:00–22:00\t17:30–22:00\t23.5h',
  'Elena – PT\tDESCANSO\t17:00–21:00\t17:00–21:00\t—\t—\t—\t—\t8h',
].join('\n');

function pegar(texto: string, empleados: EmpleadoConocido[] = EQUIPO): HorarioPegado {
  return parsearHorarioPegado({ texto, dias: DIAS, empleados, timezone: TZ });
}

function minutosDe(horario: HorarioPegado, employeeId: string): number {
  return horario.resumen.find((fila) => fila.employeeId === employeeId)?.minutos ?? -1;
}

describe('refrigerioDeUnTurno', () => {
  it('descuenta una hora desde las ocho y ni un minuto antes', () => {
    expect(refrigerioDeUnTurno(8 * 60 - 1)).toBe(0);
    expect(refrigerioDeUnTurno(8 * 60)).toBe(60);
    expect(refrigerioDeUnTurno(12 * 60)).toBe(60);
  });
});

describe('parsearHorarioPegado, la semana real', () => {
  const horario = pegar(TABLA_REAL);

  it('lee los 25 turnos y ni uno más', () => {
    expect(horario.turnos).toHaveLength(25);
  });

  it('no encuentra ningún problema', () => {
    expect(horario.problemas).toEqual([]);
  });

  it('saca los totales que declara la tabla', () => {
    expect(minutosDe(horario, 'e-ana')).toBe(48 * 60);
    expect(minutosDe(horario, 'e-bruno')).toBe(48 * 60);
    expect(minutosDe(horario, 'e-carla')).toBe(48 * 60);
    expect(minutosDe(horario, 'e-diana')).toBe(23.5 * 60);
    expect(minutosDe(horario, 'e-elena')).toBe(8 * 60);
  });

  it('pone refrigerio solo en los turnos de ocho horas o más', () => {
    const conRefrigerio = horario.turnos.filter(
      (turno) => turno.plannedUnpaidBreakMinutes === 60,
    ).length;
    // Los cortos: Bruno el jueves, Carla el miércoles y los seis de Diana y dos de Elena.
    const sinRefrigerio = horario.turnos.filter(
      (turno) => turno.plannedUnpaidBreakMinutes === 0,
    ).length;
    expect(conRefrigerio).toBe(15);
    expect(sinRefrigerio).toBe(10);
  });

  it('respeta el día libre: un descanso no es un turno de cero horas', () => {
    const deAna = horario.turnos.filter((turno) => turno.employeeId === 'e-ana');
    expect(deAna).toHaveLength(6);
    expect(deAna.map((turno) => turno.dateKey)).not.toContain('2026-09-28');
  });

  it('la raya de quien ya no sigue tampoco crea turnos', () => {
    const deElena = horario.turnos.filter((turno) => turno.employeeId === 'e-elena');
    expect(deElena.map((turno) => turno.dateKey)).toEqual(['2026-09-29', '2026-09-30']);
  });

  it('le pone a cada turno el puesto de la persona', () => {
    const deAna = horario.turnos.filter((turno) => turno.employeeId === 'e-ana');
    expect(deAna.every((turno) => turno.jobRoleId === 'puesto-jefa')).toBe(true);
  });

  it('no inventa turnos para quien no sale en la tabla', () => {
    expect(horario.resumen).toHaveLength(5);
  });
});

describe('los totales de la tabla como oráculo', () => {
  it('avisa cuando lo leído no cuadra con lo declarado, sin bloquear', () => {
    // 17:30 leído como 7:30 da un horario perfectamente plausible y equivocado.
    const horario = pegar(TABLA_REAL.replace('17:30–22:00', '07:30–22:00'));
    const discrepa = horario.problemas.filter((problema) => problema.clave === 'totalDiscrepa');
    expect(discrepa).toHaveLength(1);
    expect(discrepa.every((problema) => !problemaBloquea(problema))).toBe(true);
  });

  it('acepta la coma decimal en el total', () => {
    const horario = pegar(TABLA_REAL.replace('23.5h', '23,5 h'));
    expect(horario.problemas).toEqual([]);
  });

  it('una columna de horas no se confunde con un día', () => {
    const horario = pegar(TABLA_REAL);
    expect(horario.turnos.every((turno) => DIAS.includes(turno.dateKey))).toBe(true);
  });
});

describe('la semana equivocada', () => {
  it('bloquea si la cabecera anuncia otros días del mes', () => {
    const horario = parsearHorarioPegado({
      texto: TABLA_REAL,
      dias: weekDays('2026-10-05'),
      empleados: EQUIPO,
      timezone: TZ,
    });
    const problema = horario.problemas.find((uno) => uno.clave === 'semanaDistinta');
    expect(problema).toBeDefined();
    expect(problemaBloquea(problema!)).toBe(true);
  });

  it('sin cabecera con fechas no hay nada que comparar y no se inventa un problema', () => {
    const sinCabecera = TABLA_REAL.split('\n').slice(1).join('\n');
    const horario = parsearHorarioPegado({
      texto: sinCabecera,
      dias: weekDays('2026-10-05'),
      empleados: EQUIPO,
      timezone: TZ,
    });
    expect(horario.problemas).toEqual([]);
    expect(horario.turnos).toHaveLength(25);
  });
});

describe('nombres', () => {
  it('no adivina un nombre que no conoce', () => {
    const horario = pegar('Fulana\t10:00-19:00\tDESCANSO');
    expect(horario.problemas).toEqual([{ clave: 'nombreDesconocido', texto: 'Fulana' }]);
    expect(horario.turnos).toEqual([]);
  });

  it('no elige por su cuenta entre dos personas que comparten nombre', () => {
    const dosAnas: EmpleadoConocido[] = [
      { id: 'e-ana', nombre: 'Ana Rivas', jobRoleId: null },
      { id: 'e-ana2', nombre: 'Ana Fuentes', jobRoleId: null },
    ];
    const horario = pegar('Ana\t10:00-19:00', dosAnas);
    const problema = horario.problemas[0];
    expect(problema?.clave).toBe('nombreAmbiguo');
    expect(horario.turnos).toEqual([]);
  });

  it('resuelve por nombre completo aunque haya otra con el mismo nombre de pila', () => {
    const dosAnas: EmpleadoConocido[] = [
      { id: 'e-ana', nombre: 'Ana Rivas', jobRoleId: null },
      { id: 'e-ana2', nombre: 'Ana Fuentes', jobRoleId: null },
    ];
    const horario = pegar('Ana Fuentes\t10:00-19:00', dosAnas);
    expect(horario.problemas).toEqual([]);
    expect(horario.turnos[0]?.employeeId).toBe('e-ana2');
  });

  it('los acentos y las mayúsculas no cuentan', () => {
    const horario = pegar('ana rivas\t10:00-19:00');
    expect(horario.turnos[0]?.employeeId).toBe('e-ana');
  });

  it('una línea de basura sin horas se ignora en silencio', () => {
    const horario = pegar(`Horario de la tienda\n${TABLA_REAL}`);
    expect(horario.problemas).toEqual([]);
    expect(horario.turnos).toHaveLength(25);
  });
});

describe('celdas', () => {
  it('lo que no se entiende se dice, no se salta', () => {
    const horario = pegar('Ana Rivas\tde 10 a 7\tDESCANSO');
    const problema = horario.problemas[0];
    expect(problema?.clave).toBe('celdaIlegible');
    expect(problemaBloquea(problema!)).toBe(true);
  });

  it('acepta el turno partido en una sola celda, EN UN SOLO DIA', () => {
    const horario = pegar('Ana Rivas\t10:00-13:00 / 17:00-21:00');
    expect(horario.turnos).toHaveLength(2);
    expect(minutosDe(horario, 'e-ana')).toBe(7 * 60);
    // Sin esta línea la prueba pasaba con los dos turnos en días distintos.
    expect(horario.turnos.map((turno) => turno.dateKey)).toEqual(['2026-09-28', '2026-09-28']);
  });

  it('un turno que cruza medianoche termina al día siguiente', () => {
    const horario = pegar('Ana Rivas\t22:00-02:00');
    expect(horario.turnos[0]?.cruzaMedianoche).toBe(true);
    expect(minutosDe(horario, 'e-ana')).toBe(4 * 60);
  });

  it('acepta «10:00 a 19:00» y el punto como separador de hora', () => {
    const horario = pegar('Ana Rivas\t10:00 a 19:00\tBruno Salas\t10.00-19.00');
    expect(horario.turnos[0]?.startTime).toBe('10:00');
    expect(horario.turnos[0]?.endTime).toBe('19:00');
  });

  it('lee una línea escrita con un solo espacio', () => {
    const horario = pegar('Ana Rivas DESCANSO 10:00-19:00 11:00-20:00');
    expect(horario.turnos).toHaveLength(2);
    expect(horario.turnos[0]?.dateKey).toBe('2026-09-29');
  });
});

describe('solapes', () => {
  it('avisa de dos turnos encima de la misma persona', () => {
    const horario = pegar('Ana Rivas\t10:00-19:00 / 18:00-22:00');
    const problema = horario.problemas.find((uno) => uno.clave === 'solape');
    expect(problema).toBeDefined();
    expect(problemaBloquea(problema!)).toBe(true);
  });

  it('un relevo no es un solape', () => {
    const horario = pegar('Ana Rivas\t10:00-14:00 / 14:00-18:00');
    expect(horario.problemas).toEqual([]);
  });
});

describe('nada que leer', () => {
  it('un cuadro vacío no es un horario vacío', () => {
    expect(pegar('   \n  ').problemas).toEqual([{ clave: 'nadaQueLeer' }]);
  });
});
