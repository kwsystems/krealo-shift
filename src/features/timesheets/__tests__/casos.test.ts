import type { ShiftRow } from '@/features/schedules/api';

import type { WorkSession } from '../api';
import { casosPorResolver } from '../casos';

/**
 * «Por resolver» en Horas (Andree, 1-oct). Los dos casos de sus capturas —la que se fue
 * enferma a las 12:04 y la que no marcó su refrigerio— y el de quien se fue sin marcar.
 */

const TZ = 'America/Lima';
// Martes 29-sep en Lima (UTC-5).
const H = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 8, 29, hora + 5, minuto)).toISOString();

const TURNO = {
  id: 't1',
  employee_id: 'e1',
  location_id: 'l1',
  job_role_id: null,
  starts_at: H(10),
  ends_at: H(19),
  timezone: TZ,
  planned_unpaid_break_minutes: 60,
  employee_note: null,
  manager_note: null,
  status: 'published',
  publication_version: 1,
  published_at: null,
  updated_at: H(0),
} as unknown as ShiftRow;

function jornada(extra: Partial<WorkSession>): WorkSession {
  return {
    id: 's1',
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: 't1',
    starts_at: H(10),
    ends_at: H(19),
    gross_minutes: 540,
    paid_break_minutes: 0,
    unpaid_break_minutes: 60,
    net_minutes: 480,
    status: 'complete',
    flags: [],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    auto_clock_out: false,
    source: 'kiosk',
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: H(19),
    ...extra,
  };
}

const casos = (sesiones: WorkSession[], ahora = H(23)) =>
  casosPorResolver({ sesiones, turnos: [TURNO], ahoraISO: ahora, timezone: TZ });

describe('por resolver', () => {
  it('una jornada normal no es ningún caso', () => {
    expect(casos([jornada({})])).toEqual([]);
  });

  it('se fue enferma a las 12:04: le faltan lo planificado menos lo trabajado', () => {
    const [caso, ...resto] = casos([
      jornada({
        starts_at: H(9, 52),
        ends_at: H(12, 4),
        gross_minutes: 132,
        unpaid_break_minutes: 0,
        net_minutes: 132,
      }),
    ]);
    expect(resto).toEqual([]);
    // 8 h planificadas (9 h de turno menos 1 de refrigerio) − 2:12 trabajadas.
    expect(caso).toMatchObject({
      tipo: 'faltan_horas',
      faltan: 348,
      salioAntes: 416,
      dia: '2026-09-29',
    });
  });

  it('no marcó su refrigerio: 8:50 sin pausa en un turno con una hora', () => {
    const [caso, ...resto] = casos([
      jornada({
        ends_at: H(18, 50),
        gross_minutes: 530,
        unpaid_break_minutes: 0,
        net_minutes: 530,
      }),
    ]);
    expect(resto).toEqual([]);
    expect(caso).toMatchObject({ tipo: 'sin_refrigerio', refrigerio: 60 });
  });

  it('diez minutos antes no es un caso; resuelto, tampoco', () => {
    expect(casos([jornada({ ends_at: H(18, 50), gross_minutes: 530, net_minutes: 470 })])).toEqual(
      [],
    );
    const enferma = jornada({
      ends_at: H(12, 4),
      gross_minutes: 124,
      unpaid_break_minutes: 0,
      net_minutes: 124,
    });
    expect(casos([{ ...enferma, casos_resueltos: ['faltan_horas'] }])).toEqual([]);
  });

  it('sigue dentro media hora después de su turno: se propone la salida a su hora', () => {
    const abierta = jornada({ ends_at: null, gross_minutes: null, net_minutes: null });
    expect(casos([abierta], H(19, 20))).toEqual([]);
    expect(casos([abierta], H(19, 40))[0]).toMatchObject({
      tipo: 'sin_salida',
      salidaPropuesta: H(19),
    });
  });

  it('una salida a mañana es una salida dudosa, y se propone la misma hora el día de entrada', () => {
    // «Hoy a las 21:00» escrito pasada la medianoche: quedó para la noche siguiente.
    const manana21 = new Date(Date.UTC(2026, 8, 30, 21 + 5)).toISOString();
    const [caso, ...resto] = casos(
      [
        jornada({
          starts_at: H(16, 50),
          ends_at: manana21,
          gross_minutes: 1690,
          net_minutes: 1690,
        }),
      ],
      new Date(Date.UTC(2026, 8, 30, 2 + 5)).toISOString(),
    );
    // Y no se le buscan otros casos con una salida que está mal.
    expect(resto).toEqual([]);
    expect(caso).toMatchObject({ tipo: 'salida_dudosa', futura: true, salidaPropuesta: H(21) });
  });

  it('una jornada de más de 16 h también, aunque la salida ya pasó', () => {
    const [caso] = casos(
      [
        jornada({
          starts_at: H(10),
          ends_at: new Date(Date.UTC(2026, 8, 30, 9 + 5)).toISOString(),
          gross_minutes: 1380,
          net_minutes: 1380,
        }),
      ],
      new Date(Date.UTC(2026, 8, 30, 12 + 5)).toISOString(),
    );
    // A las 9:00 del día de entrada todavía no había entrado: se propone el fin de su turno.
    expect(caso).toMatchObject({ tipo: 'salida_dudosa', futura: false, salidaPropuesta: H(19) });
  });

  it('lo abierto va primero', () => {
    const lista = casos([
      jornada({
        id: 'a',
        ends_at: H(12, 4),
        gross_minutes: 124,
        unpaid_break_minutes: 0,
        net_minutes: 124,
      }),
      jornada({ id: 'b', ends_at: null, gross_minutes: null, net_minutes: null }),
    ]);
    expect(lista.map((c) => c.tipo)).toEqual(['sin_salida', 'faltan_horas']);
  });
});

describe('un turno con varias jornadas (auditoría, 4-oct)', () => {
  // Salió a almorzar marcando salida a las 14:00 y volvió a las 15:00: trabajó sus 8 h.
  const manana = jornada({
    id: 's-manana',
    starts_at: H(10),
    ends_at: H(14),
    gross_minutes: 240,
    unpaid_break_minutes: 0,
    net_minutes: 240,
  });
  const tarde = jornada({
    id: 's-tarde',
    starts_at: H(15),
    ends_at: H(19),
    gross_minutes: 240,
    unpaid_break_minutes: 0,
    net_minutes: 240,
  });

  it('salir a almorzar marcando salida no es «faltan horas» ni «sin refrigerio»', () => {
    expect(casos([manana, tarde])).toEqual([]);
  });

  it('si se fue antes por la tarde, debe UNA vez y lo que de verdad falta', () => {
    const temprano = { ...tarde, ends_at: H(17), gross_minutes: 120, net_minutes: 120 };
    const lista = casos([manana, temprano]);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      tipo: 'faltan_horas',
      id: 's-tarde:faltan_horas',
      faltan: 120,
      salioAntes: 120,
      llegoTarde: 0,
    });
  });

  it('resuelto en una de sus jornadas, resuelto en el turno', () => {
    const temprano = { ...tarde, ends_at: H(17), gross_minutes: 120, net_minutes: 120 };
    expect(casos([{ ...manana, casos_resueltos: ['faltan_horas'] }, temprano])).toEqual([]);
  });

  it('un turno en borrador no se usa para medir', () => {
    const borrador = { ...TURNO, status: 'draft' } as ShiftRow;
    const temprano = jornada({ ends_at: H(12), gross_minutes: 120, net_minutes: 120 });
    expect(
      casosPorResolver({
        sesiones: [temprano],
        turnos: [borrador],
        ahoraISO: H(23),
        timezone: TZ,
      }),
    ).toEqual([]);
  });

  describe('salida automática (5-oct)', () => {
    it('la jornada que se cerró sola se revisa, con su turno', () => {
      expect(casos([jornada({ auto_clock_out: true })])).toEqual([
        expect.objectContaining({
          tipo: 'salida_automatica',
          id: 's1:salida_automatica',
          turno: TURNO,
        }),
      ]);
    });

    it('«la salida está bien» la quita', () => {
      expect(
        casos([jornada({ auto_clock_out: true, casos_resueltos: ['salida_automatica'] })]),
      ).toEqual([]);
    });

    it('sin turno también sale, y no esconde lo que le falta a otra jornada', () => {
      const sola = jornada({ id: 's2', shift_id: null, auto_clock_out: true });
      expect(casos([sola]).map((caso) => caso.tipo)).toEqual(['salida_automatica']);
    });
  });
});

/**
 * LA HORA EXTRA APROBADA Y EL REFRIGERIO SIN MARCAR (6-oct). Una vendedora marcó de 09:54 a
 * 21:00 sin refrigerio en un turno de 10:00 a 21:00 con 1 h de refrigerio: 11:06 netas,
 * 1:06 más que sus 10 h planificadas. Quien gestiona aprobó esa 1:06 como extra, y Horas
 * seguía preguntando si descontar la hora de comer.
 */
describe('la hora extra aprobada decide el refrigerio (6-oct)', () => {
  const turnoLargo = { ...TURNO, ends_at: H(21) } as ShiftRow;
  const deLaVendedora = jornada({
    starts_at: H(9, 54),
    ends_at: H(21),
    gross_minutes: 666,
    unpaid_break_minutes: 0,
    net_minutes: 666,
  });
  const conExtra = (minutos: number | null) =>
    casosPorResolver({
      sesiones: [deLaVendedora],
      turnos: [turnoLargo],
      ahoraISO: H(23),
      timezone: TZ,
      aprobadas: new Map(minutos === null ? [] : [[`e1_2026-09-29`, minutos]]),
    }).map((caso) => caso.tipo);

  it('sin extra aprobada, el caso sigue', () => {
    expect(conExtra(null)).toEqual(['sin_refrigerio']);
  });

  it('con la 1:06 aprobada, la hora de comer ya cuenta como trabajada: no hay caso', () => {
    expect(conExtra(66)).toEqual([]);
  });

  it('una extra de solo lo de más sin el refrigerio (6 min) no decide nada sobre él', () => {
    expect(conExtra(6)).toEqual(['sin_refrigerio']);
  });

  it('quitar la extra vuelve a abrir el caso', () => {
    expect(conExtra(0)).toEqual(['sin_refrigerio']);
  });
});
