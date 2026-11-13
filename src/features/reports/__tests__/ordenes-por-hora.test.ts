import { analizarOrdenes, claveDeCelda, type FilaDeOrdenes } from '../ordenes-por-hora';

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
