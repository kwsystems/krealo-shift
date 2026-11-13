import { analizarOrdenes, claveDeCelda, planDePersonal, type FilaDeOrdenes } from '../ordenes-por-hora';

const TZ = 'America/Lima';

const fila = (date: string, hours: FilaDeOrdenes['hours']): FilaDeOrdenes => ({
  date,
  hours,
  orders: Object.values(hours).reduce((s, h) => s + h.orders, 0),
  sales: Object.values(hours).reduce((s, h) => s + h.sales, 0),
  currency: 'PEN',
});

// Dos sábados (7 y 14 de noviembre de 2026) y un lunes (9).
const filas = [
  fila('2026-11-07', { '17': { orders: 4, sales: 400 }, '11': { orders: 1, sales: 50 } }),
  fila('2026-11-14', { '17': { orders: 2, sales: 200 }, '21': { orders: 1, sales: 30 } }),
  fila('2026-11-09', {}),
];

// Lima es UTC-5: 10:00 local = 15:00 UTC.
const turno = (employee_id: string, starts_at: string, ends_at: string, status = 'published') => ({
  employee_id,
  starts_at,
  ends_at,
  status: status as 'published' | 'draft' | 'cancelled',
  publication_version: 1,
});

describe('las órdenes por hora frente a quién estaba en turno', () => {
  const analisis = analizarOrdenes(
    filas,
    [
      // Sábado 7, de 10:00 a 19:00 y de 13:00 a 22:00.
      turno('a', '2026-11-07T15:00:00Z', '2026-11-08T00:00:00Z'),
      turno('b', '2026-11-07T18:00:00Z', '2026-11-08T03:00:00Z'),
      // Lunes 9, de 10:00 a 19:00, sin ninguna orden.
      turno('a', '2026-11-09T15:00:00Z', '2026-11-10T00:00:00Z'),
      // Un turno anulado no cuenta.
      turno('c', '2026-11-07T15:00:00Z', '2026-11-08T00:00:00Z', 'cancelled'),
    ],
    TZ,
  );

  it('da la media por día de la semana con datos, no la suma', () => {
    const sabado17 = analisis.celdas.get(claveDeCelda(6, 17));
    expect(sabado17?.ordenes).toBe(3); // (4 + 2) / 2 sábados
    expect(sabado17?.dias).toBe(2);
    // Dos personas el sábado 7 y nadie el 14 (no tiene turnos): media 1.
    expect(sabado17?.personas).toBe(1);
    expect(analisis.totalOrdenes).toBe(8);
    expect(analisis.dias).toBe(3);
    expect(analisis.diaFuerte).toEqual({ diaSemana: 6, ordenes: 4 });
  });

  it('dice la hora punta, dónde falta gente y dónde sobra', () => {
    expect(analisis.puntas[0]).toMatchObject({ diaSemana: 6, hora: 17 });
    // Sábado a las 21:00: media orden por día y nadie en turno el 14 → media 0,5 personas.
    expect(analisis.sinNadie).toEqual([]);
    // Con alguien en turno y ninguna orden: el lunes entero, y horas del sábado.
    expect(analisis.conPocas[0]).toMatchObject({ ordenes: 0, personas: 1 });
    expect(analisis.celdas.get(claveDeCelda(1, 12))).toMatchObject({ ordenes: 0, personas: 1 });
    expect(analisis.masPorPersona[0]).toMatchObject({ diaSemana: 6, hora: 17 });
  });

  it('las columnas van de la primera a la última hora con algo', () => {
    expect(analisis.horas[0]).toBe(10);
    expect(analisis.horas.at(-1)).toBe(21);
  });
});

describe('cuánta gente poner cada día (planDePersonal)', () => {
  // Una semana: el sábado vende el triple que el lunes, pero los dos tienen la misma gente.
  const semana = [
    fila('2026-11-09', { '12': { orders: 1, sales: 100 }, '16': { orders: 1, sales: 100 } }),
    fila('2026-11-14', {
      '12': { orders: 2, sales: 200 },
      '16': { orders: 3, sales: 300 },
      '17': { orders: 1, sales: 100 },
    }),
  ];
  const turnos = [
    // Lunes 9 y sábado 14, dos personas de 10:00 a 18:00 cada día (8 h).
    turno('a', '2026-11-09T15:00:00Z', '2026-11-09T23:00:00Z'),
    turno('b', '2026-11-09T15:00:00Z', '2026-11-09T23:00:00Z'),
    turno('a', '2026-11-14T15:00:00Z', '2026-11-14T23:00:00Z'),
    turno('b', '2026-11-14T15:00:00Z', '2026-11-14T23:00:00Z'),
  ];
  const analisis = analizarOrdenes(semana, turnos, TZ);
  const plan = planDePersonal(analisis, 5);

  it('cuenta personas distintas por día y el turno medio', () => {
    expect(analisis.personasPorDia.get(1)).toBe(2);
    expect(analisis.personasPorDia.get(6)).toBe(2);
    expect(analisis.turnoMedio).toBe(8);
  });

  it('reparte las mismas horas de la semana según las órdenes', () => {
    expect(plan).not.toBeNull();
    const total = plan!.dias.reduce((s, d) => s + d.horasSugeridas, 0);
    expect(total).toBeCloseTo(plan!.horasSemana, 5);
    expect(plan!.horasSemana).toBe(32);
    const lunes = plan!.dias.find((d) => d.diaSemana === 1)!;
    const sabado = plan!.dias.find((d) => d.diaSemana === 6)!;
    expect(sabado.horasSugeridas).toBeGreaterThan(lunes.horasSugeridas);
    expect(sabado.personasSugeridas).toBeGreaterThan(lunes.personasSugeridas);
    // El lunes no baja de una persona cada hora que abre (8 horas).
    expect(lunes.horasSugeridas).toBeGreaterThanOrEqual(8);
    expect(plan!.equipo).toBe(5);
  });

  it('dice las horas fuertes de cada día', () => {
    const sabado = plan!.dias.find((d) => d.diaSemana === 6)!;
    // Punta 3 a las 16:00; fuertes las que llegan a 1,8: 12:00 (2) y 16:00 (3). Son tramos
    // separados, y el refuerzo es el de la punta, no «de 12:00 a 17:00».
    expect(sabado.refuerzo).toEqual({ desde: 16, hasta: 17 });
  });

  it('sin turnos no hay plan: no hay horas que repartir', () => {
    expect(planDePersonal(analizarOrdenes(semana, [], TZ), 3)).toBeNull();
  });
});

describe('el plan no pide más gente de la que hay', () => {
  it('con un equipo de 2, el día fuerte se queda en 2 y lo dice', () => {
    const semana = [
      fila('2026-11-09', { '12': { orders: 1, sales: 100 } }),
      fila('2026-11-14', { '12': { orders: 9, sales: 900 }, '16': { orders: 9, sales: 900 } }),
    ];
    const turnos = [
      turno('a', '2026-11-09T15:00:00Z', '2026-11-09T23:00:00Z'),
      turno('b', '2026-11-09T15:00:00Z', '2026-11-09T23:00:00Z'),
      turno('a', '2026-11-14T15:00:00Z', '2026-11-14T23:00:00Z'),
      turno('b', '2026-11-14T15:00:00Z', '2026-11-14T23:00:00Z'),
    ];
    const plan = planDePersonal(analizarOrdenes(semana, turnos, TZ), 2)!;
    const sabado = plan.dias.find((d) => d.diaSemana === 6)!;
    expect(sabado.personasSugeridas).toBe(2);
    expect(sabado.todoElEquipo).toBe(true);
  });
});
