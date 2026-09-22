import {
  hoursByEmployee,
  minutesByDay,
  minutesByReason,
  punctuality,
  type BreakRow,
} from '../aggregate';
import { computeTotals } from '@/features/timesheets/hooks';
import type { DailySummary, WorkSession } from '@/features/timesheets/api';

/**
 * LA PRUEBA QUE JUSTIFICA QUE ESTE MÓDULO EXISTA APARTE
 *
 * La promesa de Reportes es una sola: sus números cuadran con los que enseña Horas
 * para el mismo periodo. Si no cuadran, uno de los dos miente, y con un tablero de
 * horas se toman decisiones sobre la paga de gente real.
 *
 * Aquí se comprueba de verdad, no por construcción: `computeTotals` recorre los días
 * y suma; `hoursByEmployee` AGRUPA POR PERSONA y luego suma. Son dos recorridos
 * distintos sobre las mismas filas, y por eso pueden discrepar —de hecho discreparían
 * si las horas extra se partieran por semana en un sitio y por día en el otro, que es
 * el error fácil—. Que salga lo mismo es información, no una tautología.
 */

const UMBRAL = 8 * 60;

function dia(
  parcial: Partial<DailySummary> & { employee_id: string; work_date: string },
): DailySummary {
  return {
    location_id: 'loc-1',
    sessions: 1,
    gross_minutes: 0,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: 0,
    needs_review: false,
    flags: [],
    ...parcial,
  };
}

function sesion(
  parcial: Partial<WorkSession> & { employee_id: string; flags: string[] },
): WorkSession {
  return {
    id: `s-${Math.random()}`,
    location_id: 'loc-1',
    shift_id: null,
    starts_at: '2026-09-14T13:00:00.000Z',
    ends_at: '2026-09-14T21:00:00.000Z',
    gross_minutes: 480,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: 480,
    status: 'complete',
    updated_at: '2026-09-14T21:00:00.000Z',
    ...parcial,
  };
}

/** Una semana con jornadas cortas, largas y una de exactamente el umbral. */
const SEMANA: DailySummary[] = [
  dia({ employee_id: 'ana', work_date: '2026-09-14', net_minutes: 480, gross_minutes: 510 }),
  dia({ employee_id: 'ana', work_date: '2026-09-15', net_minutes: 530, gross_minutes: 560 }),
  dia({ employee_id: 'ana', work_date: '2026-09-16', net_minutes: 300, gross_minutes: 330 }),
  dia({ employee_id: 'beto', work_date: '2026-09-14', net_minutes: 240, gross_minutes: 240 }),
  dia({ employee_id: 'beto', work_date: '2026-09-16', net_minutes: 610, gross_minutes: 640 }),
  dia({ employee_id: 'caro', work_date: '2026-09-15', net_minutes: 0, gross_minutes: 30 }),
];

describe('las cuentas de Reportes cuadran con las de Horas', () => {
  it('la suma del ranking es exactamente el total neto del periodo', () => {
    const totales = computeTotals(SEMANA, UMBRAL);
    const ranking = hoursByEmployee(SEMANA, UMBRAL);
    const suma = ranking.reduce((acumulado, fila) => acumulado + fila.netMinutes, 0);
    expect(suma).toBe(totales.netMinutes);
  });

  it('y las horas extra también, partidas por día en los dos sitios', () => {
    const totales = computeTotals(SEMANA, UMBRAL);
    const ranking = hoursByEmployee(SEMANA, UMBRAL);
    expect(ranking.reduce((a, f) => a + f.overtimeMinutes, 0)).toBe(totales.overtimeMinutes);
    expect(ranking.reduce((a, f) => a + f.regularMinutes, 0)).toBe(totales.regularMinutes);
  });

  it('la suma de las columnas de la semana es el mismo total', () => {
    const dias = minutesByDay(SEMANA, [
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    const totales = computeTotals(SEMANA, UMBRAL);
    expect(dias.reduce((a, d) => a + d.netMinutes, 0)).toBe(totales.netMinutes);
  });
});

describe('horas por persona', () => {
  it('ordena de más a menos y parte las extra por día, no por semana', () => {
    const ranking = hoursByEmployee(SEMANA, UMBRAL);
    expect(ranking.map((fila) => fila.employeeId)).toEqual(['ana', 'beto', 'caro']);

    const ana = ranking[0];
    expect(ana?.netMinutes).toBe(1310);
    // 480 (justo el umbral, cero extra) + 530 (50 extra) + 300 (cero extra).
    // Por semana serían 1310 - 2400 = negativo, o sobre 40 h daría otra cifra: la
    // prueba falla si alguien cambia a sumar primero y partir después.
    expect(ana?.overtimeMinutes).toBe(50);
    expect(ana?.regularMinutes).toBe(1260);
    expect(ana?.days).toBe(3);
  });

  it('un día exactamente en el umbral no genera ni un minuto extra', () => {
    const ranking = hoursByEmployee(
      [dia({ employee_id: 'ana', work_date: '2026-09-14', net_minutes: UMBRAL })],
      UMBRAL,
    );
    expect(ranking[0]?.overtimeMinutes).toBe(0);
  });
});

describe('minutos por día', () => {
  it('devuelve los siete días, incluidos los que no tienen ninguna fila', () => {
    const claves = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'];
    const dias = minutesByDay(SEMANA, claves);
    expect(dias.map((d) => d.dateKey)).toEqual(claves);
    // Jueves sin datos: columna a cero, no una columna que desaparece. Si se quitara,
    // una semana con tres días flojos parecería una semana de días buenos.
    expect(dias[3]).toEqual({ dateKey: '2026-09-17', netMinutes: 0, sessions: 0 });
  });

  it('ignora filas de fuera del rango en vez de sumarlas al primer día', () => {
    const dias = minutesByDay(
      [...SEMANA, dia({ employee_id: 'ana', work_date: '2026-08-01', net_minutes: 999 })],
      ['2026-09-14', '2026-09-15'],
    );
    expect(dias.reduce((a, d) => a + d.netMinutes, 0)).toBe(480 + 530 + 240 + 0);
  });
});

describe('puntualidad', () => {
  const SESIONES: WorkSession[] = [
    sesion({ employee_id: 'ana', flags: [] }),
    sesion({ employee_id: 'ana', flags: ['late_arrival'] }),
    sesion({ employee_id: 'beto', flags: ['late_arrival'] }),
    sesion({ employee_id: 'beto', flags: ['late_arrival'] }),
    sesion({ employee_id: 'caro', flags: [] }),
  ];

  it('cuenta las tardanzas que marcó el servidor', () => {
    const resultado = punctuality(SESIONES);
    expect(resultado.measured).toBe(5);
    expect(resultado.late).toBe(3);
    expect(resultado.onTimePercent).toBe(40);
    expect(resultado.byEmployee[0]).toEqual({ employeeId: 'beto', measured: 2, late: 2 });
  });

  /**
   * ESTA ES LA IMPORTANTE. Un fichaje sin turno programado no puede llegar tarde: no
   * había hora a la que llegar. Si contara como «a tiempo», una tienda que no programa
   * turnos saldría con 100% de puntualidad para siempre —la cifra tranquilizadora y
   * falsa que hace que nadie vuelva a mirar el tablero—.
   */
  it('deja fuera los fichajes sin turno en vez de contarlos como puntuales', () => {
    const resultado = punctuality([
      ...SESIONES,
      sesion({ employee_id: 'dani', flags: ['unscheduled'] }),
      sesion({ employee_id: 'dani', flags: ['unscheduled'] }),
    ]);
    expect(resultado.unscheduled).toBe(2);
    expect(resultado.measured).toBe(5);
    expect(resultado.onTimePercent).toBe(40);
    expect(resultado.byEmployee.some((fila) => fila.employeeId === 'dani')).toBe(false);
  });

  it('sin nada medible responde «no se sabe», no «100%»', () => {
    const resultado = punctuality([sesion({ employee_id: 'dani', flags: ['unscheduled'] })]);
    expect(resultado.onTimePercent).toBeNull();
  });
});

describe('en qué se va el tiempo que no se trabaja', () => {
  const PAUSAS: BreakRow[] = [
    { employee_id: 'ana', break_reason: 'meal', minutes: 60, pauses: 2 },
    { employee_id: 'beto', break_reason: 'meal', minutes: 30, pauses: 1 },
    { employee_id: 'ana', break_reason: 'meeting', minutes: 45, pauses: 1 },
    { employee_id: 'beto', break_reason: 'rest', minutes: 15, pauses: 1 },
  ];

  it('agrupa por motivo, ordena de más a menos y reparte el 100%', () => {
    const filas = minutesByReason(PAUSAS);
    expect(filas.map((fila) => fila.reason)).toEqual(['meal', 'meeting', 'rest']);
    expect(filas[0]).toMatchObject({ minutes: 90, pauses: 3, sharePercent: 60 });
    expect(filas.reduce((a, f) => a + f.minutes, 0)).toBe(150);
  });

  it('un motivo que la app no conoce cae en «otro» y NO se pierde', () => {
    // Una fila vieja, o un valor que la base gane en el futuro. Descartarla haría que
    // la suma de los motivos no llegue al total de pausas y el gráfico contradiría al
    // titular sin que nada avisara.
    const filas = minutesByReason([
      ...PAUSAS,
      { employee_id: 'caro', break_reason: 'lo_que_sea', minutes: 50, pauses: 1 },
    ]);
    expect(filas.reduce((a, f) => a + f.minutes, 0)).toBe(200);
    expect(filas.find((fila) => fila.reason === 'other')?.minutes).toBe(50);
  });

  it('no inventa filas para los motivos que nadie usó', () => {
    const filas = minutesByReason([PAUSAS[0] as BreakRow]);
    expect(filas).toHaveLength(1);
  });
});

/**
 * LAS NOTAS DE «OTRO», que son la razón de que se le pida una a la gente.
 *
 * Lo que se comprueba aquí es que juntarlas NO toca los minutos: el gráfico y la lista
 * salen de la misma fila, así que si sumar las explicaciones cambiara un total, la
 * pantalla se contradiría a sí misma —«Otro: 45 min» arriba y tres notas que suman otra
 * cosa abajo— y nadie sabría cuál creer.
 */
describe('las explicaciones de las pausas por «Otro»', () => {
  const CON_NOTAS: BreakRow[] = [
    {
      employee_id: 'ana',
      break_reason: 'other',
      minutes: 20,
      pauses: 1,
      notes: [{ at: '2026-09-21T14:00:00.000Z', minutes: 20, note: 'Fui a la clínica.' }],
    },
    {
      employee_id: 'beto',
      break_reason: 'other',
      minutes: 25,
      pauses: 1,
      notes: [{ at: '2026-09-22T14:00:00.000Z', minutes: 25, note: 'Trámite en el banco.' }],
    },
    { employee_id: 'ana', break_reason: 'meal', minutes: 30, pauses: 1 },
  ];

  it('las junta en la fila de «otro» sin mover los minutos', () => {
    const filas = minutesByReason(CON_NOTAS);
    const otro = filas.find((fila) => fila.reason === 'other');
    expect(otro?.minutes).toBe(45);
    expect(otro?.pauses).toBe(2);
    expect(otro?.notes).toHaveLength(2);
  });

  it('las más recientes primero: al abrir se quiere ver lo de hoy', () => {
    const otro = minutesByReason(CON_NOTAS).find((fila) => fila.reason === 'other');
    expect(otro?.notes.map((nota) => nota.note)).toEqual([
      'Trámite en el banco.',
      'Fui a la clínica.',
    ]);
  });

  it('cada nota sabe de QUIÉN es, que es la mitad de lo que se necesita para leerla', () => {
    const otro = minutesByReason(CON_NOTAS).find((fila) => fila.reason === 'other');
    expect(otro?.notes.map((nota) => nota.employeeId)).toEqual(['beto', 'ana']);
  });

  /**
   * Una fila sin notas lleva la lista VACÍA y no `undefined`: la pantalla hace
   * `notes.length` sin preguntar, y una fila que viene de una función desplegada vieja
   * —sin el campo— no puede tumbarla.
   */
  it('un motivo sin explicaciones trae la lista vacía, no un hueco', () => {
    const comida = minutesByReason(CON_NOTAS).find((fila) => fila.reason === 'meal');
    expect(comida?.notes).toEqual([]);
  });

  it('una nota en blanco no ocupa una línea para no decir nada', () => {
    const filas = minutesByReason([
      {
        employee_id: 'ana',
        break_reason: 'other',
        minutes: 10,
        pauses: 1,
        notes: [{ at: '2026-09-22T14:00:00.000Z', minutes: 10, note: '   ' }],
      },
    ]);
    expect(filas.find((fila) => fila.reason === 'other')?.notes).toEqual([]);
  });
});
