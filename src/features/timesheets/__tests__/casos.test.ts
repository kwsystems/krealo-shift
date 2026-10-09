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

  // 8-oct: proponer la misma salida no arreglaba nada; se propone el fin del turno.
  it('en una jornada larga del mismo día no propone la misma hora que ya tiene', () => {
    const [caso] = casos(
      [jornada({ starts_at: H(6, 30), ends_at: H(23), gross_minutes: 990, net_minutes: 990 })],
      new Date(Date.UTC(2026, 8, 30, 12 + 5)).toISOString(),
    );
    expect(caso).toMatchObject({ tipo: 'salida_dudosa', futura: false, salidaPropuesta: H(19) });
  });

  it('dada por buena, no vuelve', () => {
    const lista = casos(
      [
        jornada({
          starts_at: H(6, 30),
          ends_at: H(23),
          gross_minutes: 990,
          net_minutes: 990,
          casos_resueltos: ['salida_dudosa'],
        }),
      ],
      new Date(Date.UTC(2026, 8, 30, 12 + 5)).toISOString(),
    );
    expect(lista.map((c) => c.tipo)).not.toContain('salida_dudosa');
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
    // Con una jornada del turno abierta, lo que le falta no se sabe todavía (8-oct).
    expect(lista.map((c) => c.tipo)).toEqual(['sin_salida']);
  });

  it('sin salida, no propone el fin de un turno anterior a su entrada', () => {
    const [caso] = casos(
      [jornada({ starts_at: H(19, 30), ends_at: null, gross_minutes: null, net_minutes: null })],
      H(23, 50),
    );
    expect(caso).toMatchObject({ tipo: 'sin_salida', salidaPropuesta: null });
  });

  // 8-oct: salió a almorzar a las 14:00; a las 14:20 no le falta nada ni le sobra refrigerio.
  it('a medio turno, quien salió a almorzar no tiene casos', () => {
    const lista = casos(
      [
        jornada({
          id: 'manana',
          starts_at: H(9),
          ends_at: H(14),
          gross_minutes: 300,
          unpaid_break_minutes: 0,
          net_minutes: 300,
        }),
      ],
      H(14, 20),
    );
    expect(lista).toEqual([]);
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
    const borrador = { ...TURNO, status: 'draft', publication_version: 0 } as ShiftRow;
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

  // 8-oct: CUALQUIER extra aprobada decide el día. Con «más que lo de más sin el refrigerio»,
  // Andree aprobaba la hora que veía y el caso no se iba nunca.
  it('una extra aprobada, aunque sea solo lo de más sin el refrigerio, decide el caso', () => {
    expect(conExtra(6)).toEqual([]);
    expect(conExtra(60)).toEqual([]);
  });

  it('quitar la extra vuelve a abrir el caso', () => {
    expect(conExtra(0)).toEqual(['sin_refrigerio']);
  });
});

/**
 * DE CORRIDO (7-oct): sin almorzar, trabajó sus 8 h y se fue una hora antes. Andree: «valen
 * las 8 horas, haz que sea normal». Ni «sin refrigerio» ni «le faltan».
 */
describe('la jornada de corrido no es un caso (7-oct)', () => {
  const tipos = (sesion: WorkSession, extra: { umbralExtra?: number } = {}) =>
    casosPorResolver({
      sesiones: [sesion],
      turnos: [TURNO],
      ahoraISO: H(23),
      timezone: TZ,
      ...extra,
    }).map((caso) => caso.tipo);

  it('de 09:53 a 18:01 sin pausa en un turno de 10 a 19 con 1 h: nada que resolver', () => {
    const deCorrido = jornada({
      starts_at: H(9, 53),
      ends_at: H(18, 1),
      gross_minutes: 488,
      unpaid_break_minutes: 0,
      net_minutes: 488,
    });
    expect(tipos(deCorrido)).toEqual([]);
    // Tampoco con la posible hora extra puesta: 8 min de más no llegan al aviso.
    expect(tipos(deCorrido, { umbralExtra: 60 })).toEqual([]);
  });

  it('el turno entero sin almorzar sigue preguntando: ahí sí pudo comer sin marcarlo', () => {
    expect(
      tipos(jornada({ gross_minutes: 540, unpaid_break_minutes: 0, net_minutes: 540 })),
    ).toEqual(['sin_refrigerio']);
  });

  it('irse dos horas antes sin almorzar sigue siendo «le faltan»', () => {
    expect(
      tipos(
        jornada({ ends_at: H(17), gross_minutes: 420, unpaid_break_minutes: 0, net_minutes: 420 }),
      ),
    ).toEqual(['sin_refrigerio', 'faltan_horas']);
  });
});

/**
 * FUERA DE TURNO (6-oct): la posible hora extra y las marcas fuera del turno, decididas en
 * Horas y no en dos pantallas.
 */
describe('fuera de turno (6-oct)', () => {
  const turnoLargo = { ...TURNO, ends_at: H(21) } as ShiftRow;
  const dia = (sesiones: WorkSession[], extra: { aprobadas?: Map<string, number> } = {}) =>
    casosPorResolver({
      sesiones,
      turnos: [turnoLargo],
      ahoraISO: H(23),
      timezone: TZ,
      umbralExtra: 60,
      aprobadas: extra.aprobadas,
    }).filter((caso) => caso.tipo === 'fuera_de_turno');
  // De 09:54 a 21:00 con su refrigerio de 1 h marcado: 10:06 netas sobre 10 h planificadas.
  const largaConPausa = jornada({
    starts_at: H(8, 30),
    ends_at: H(21),
    gross_minutes: 750,
    unpaid_break_minutes: 60,
    net_minutes: 690,
    flags: ['early_arrival'],
  });

  it('trabajó 1:30 de más: se pregunta la extra, con lo que entró antes', () => {
    const [caso, ...resto] = dia([largaConPausa]);
    expect(resto).toEqual([]);
    expect(caso).toMatchObject({ posibleExtra: true, deMas: 90, entroAntes: 90 });
  });

  it('con la extra decidida —aprobada o «no es extra» (0)— ya no pregunta', () => {
    expect(dia([largaConPausa], { aprobadas: new Map([['e1_2026-09-29', 90]]) })).toEqual([]);
    expect(dia([largaConPausa], { aprobadas: new Map([['e1_2026-09-29', 0]]) })).toEqual([]);
  });

  it('entró una hora antes y salió una hora antes: no hay extra, solo «está bien así»', () => {
    const corrida = jornada({
      starts_at: H(9),
      ends_at: H(20),
      gross_minutes: 660,
      unpaid_break_minutes: 60,
      net_minutes: 600,
      flags: ['early_arrival'],
    });
    const [caso] = dia([corrida]);
    expect(caso).toMatchObject({ posibleExtra: false, entroAntes: 60, deMas: 0 });
    expect(caso?.tipo === 'fuera_de_turno' && caso.conMarcas.map((s) => s.id)).toEqual(['s1']);
  });

  it('una marca ya vista sin horas de más no es caso', () => {
    const vista = jornada({
      starts_at: H(9),
      ends_at: H(20),
      gross_minutes: 660,
      unpaid_break_minutes: 60,
      net_minutes: 600,
      flags: ['early_arrival'],
      avisos_vistos: ['early_arrival'],
    });
    expect(dia([vista])).toEqual([]);
  });

  it('quien sigue dentro todavía no trabajó «de más»', () => {
    expect(dia([jornada({ ...largaConPausa, ends_at: null, net_minutes: null })])).toEqual([]);
  });

  it('sin umbral no se buscan (quien no sabe decidirlos no los pide)', () => {
    expect(
      casosPorResolver({
        sesiones: [largaConPausa],
        turnos: [turnoLargo],
        ahoraISO: H(23),
        timezone: TZ,
      }).map((caso) => caso.tipo),
    ).toEqual([]);
  });
});

/*
 * «LE DEBE» QUE YA NO CUADRA (8-oct): se apuntó la deuda y después se corrigió la jornada.
 */
describe('una deuda que ya no cuadra', () => {
  const deuda = (minutos: number) => ({
    id: 's1',
    work_session_id: 's1',
    minutes: minutos,
    note: null,
    status: 'pending',
  });
  const conDeuda = (sesion: WorkSession, minutos: number) =>
    casosPorResolver({
      sesiones: [sesion],
      turnos: [TURNO],
      ahoraISO: H(23),
      timezone: TZ,
      debidas: [deuda(minutos)],
    });

  it('se apuntó «debe 4 h» y la jornada corregida ya está completa: se dice', () => {
    const lista = conDeuda(jornada({ casos_resueltos: ['faltan_horas'] }), 240);
    expect(lista).toEqual([
      expect.objectContaining({ tipo: 'deuda_que_no_cuadra', faltaAhora: 0 }),
    ]);
  });

  it('si ahora le falta otra cantidad, también, con la nueva', () => {
    const lista = conDeuda(
      jornada({
        ends_at: H(17),
        gross_minutes: 420,
        net_minutes: 360,
        casos_resueltos: ['faltan_horas'],
      }),
      240,
    );
    expect(lista).toEqual([
      expect.objectContaining({ tipo: 'deuda_que_no_cuadra', faltaAhora: 120 }),
    ]);
  });

  it('si cuadra, nada', () => {
    const lista = conDeuda(
      jornada({
        ends_at: H(17),
        gross_minutes: 420,
        net_minutes: 360,
        casos_resueltos: ['faltan_horas'],
      }),
      120,
    );
    expect(lista).toEqual([]);
  });
});
