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
