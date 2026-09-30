import type { TimesheetExportRow } from '../api';
import {
  buildCsvLine,
  buildTimesheetCsv,
  escapeCsvField,
  timesheetFileName,
  type CsvLabels,
} from '../csv';

/**
 * La exportación es lo que sale de la app hacia una planilla, así que dos errores
 * son inaceptables: el decimal mal convertido (1 h 30 = 1.50, nunca 1.30) y un
 * nombre con coma que rompe las columnas.
 */

const labels: CsvLabels = {
  employee: 'Empleado',
  date: 'Fecha',
  clockIn: 'Entrada',
  clockOut: 'Salida',
  grossHours: 'Horas brutas',
  paidBreak: 'Descanso pagado',
  unpaidBreak: 'Descanso no pagado',
  netHours: 'Horas netas',
  netDecimal: 'Horas netas decimales',
  regularHours: 'Horas regulares',
  overtimeHours: 'Horas extra',
  status: 'Estado',
  flags: 'Alertas',
};

function row(overrides: Partial<TimesheetExportRow> = {}): TimesheetExportRow {
  return {
    employee_id: 'e-ana',
    employee_name: 'Ana Torres',
    work_date: '2026-08-27',
    clock_in: '2026-08-27T14:00:00.000Z',
    clock_out: '2026-08-27T23:30:00.000Z',
    gross_minutes: 570,
    paid_break_minutes: 0,
    unpaid_break_minutes: 60,
    net_minutes: 510,
    net_hours_decimal: 8.5,
    status: 'complete',
    flags: [],
    ...overrides,
  };
}

describe('escapado CSV', () => {
  it('deja intacto lo que no necesita comillas', () => {
    expect(escapeCsvField('Ana Torres')).toBe('Ana Torres');
  });

  it('entrecomilla comas, comillas y saltos de línea', () => {
    expect(escapeCsvField('Torres, Ana')).toBe('"Torres, Ana"');
    expect(escapeCsvField('Ana "La Jefa"')).toBe('"Ana ""La Jefa"""');
    expect(escapeCsvField('linea1\nlinea2')).toBe('"linea1\nlinea2"');
  });

  it('une campos con coma', () => {
    expect(buildCsvLine(['a', 'b, c'])).toBe('a,"b, c"');
  });
});

describe('las horas extra del archivo son las aprobadas (30-sep)', () => {
  const opciones = (aprobadas: [string, number][]) => ({
    labels,
    timezone: 'America/Lima',
    horasExtraAprobadas: new Map(aprobadas),
  });
  const extraDe = (linea: string | undefined) => linea?.split(',')[10];
  const regularDe = (linea: string | undefined) => linea?.split(',')[9];

  it('sin nada aprobado, 8:30 trabajadas son 8:30 regulares', () => {
    const csv = buildTimesheetCsv([row()], opciones([]));
    expect(regularDe(csv.split('\r\n')[1])).toBe('08:30');
    expect(extraDe(csv.split('\r\n')[1])).toBe('00:00');
  });

  it('con dos jornadas el mismo día, lo aprobado se reparte sin pasar de cada una', () => {
    const csv = buildTimesheetCsv(
      [row({ net_minutes: 60 }), row({ net_minutes: 120 })],
      opciones([['e-ana_2026-08-27', 90]]),
    );
    const [, primera, segunda] = csv.split('\r\n');
    expect([regularDe(primera), extraDe(primera)]).toEqual(['00:00', '01:00']);
    expect([regularDe(segunda), extraDe(segunda)]).toEqual(['01:30', '00:30']);
  });

  it('una fila sin persona no se lleva la extra de nadie', () => {
    const csv = buildTimesheetCsv(
      [row({ employee_id: null })],
      opciones([['e-ana_2026-08-27', 30]]),
    );
    expect(extraDe(csv.split('\r\n')[1])).toBe('00:00');
  });
});

describe('exportación de la hoja de tiempo', () => {
  it('escribe el encabezado traducido y una fila por sesión', () => {
    const csv = buildTimesheetCsv([row()], {
      labels,
      timezone: 'America/Lima',
      // Media hora aprobada ese día: el resto de las 8:30 son regulares.
      horasExtraAprobadas: new Map([['e-ana_2026-08-27', 30]]),
    });
    const lines = csv.split('\r\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Empleado,Fecha,Entrada,Salida,Horas brutas,Descanso pagado,Descanso no pagado,Horas netas,Horas netas decimales,Horas regulares,Horas extra,Estado,Alertas',
    );
    expect(lines[1]).toBe(
      'Ana Torres,2026-08-27,09:00,18:30,09:30,00:00,01:00,08:30,8.50,08:00,00:30,complete,',
    );
  });

  it('convierte 1 h 30 min en 1.50 horas, no en 1.30', () => {
    const csv = buildTimesheetCsv([row({ net_minutes: 90, net_hours_decimal: 1.5 })], {
      labels,
      timezone: 'America/Lima',
      horasExtraAprobadas: new Map(),
    });

    expect(csv.split('\r\n')[1]).toContain(',01:30,1.50,');
  });

  it('respeta el formato de 12 horas de la ubicación', () => {
    const csv = buildTimesheetCsv([row()], {
      labels,
      timezone: 'America/Lima',
      horasExtraAprobadas: new Map(),
      timeFormat: '12h',
      language: 'en',
    });

    expect(csv.split('\r\n')[1]).toContain('9:00 AM');
  });

  it('deja vacías las horas de una sesión sin salida', () => {
    const csv = buildTimesheetCsv(
      [row({ clock_out: null, net_minutes: null, net_hours_decimal: 0, status: 'open' })],
      { labels, timezone: 'America/Lima', horasExtraAprobadas: new Map() },
    );

    expect(csv.split('\r\n')[1]).toBe(
      'Ana Torres,2026-08-27,09:00,,09:30,00:00,01:00,00:00,0.00,00:00,00:00,open,',
    );
  });

  it('no rompe columnas con un nombre con coma ni con varias alertas', () => {
    const csv = buildTimesheetCsv(
      [row({ employee_name: 'Torres, Ana', flags: ['late_arrival', 'clock_drift'] })],
      { labels, timezone: 'America/Lima', horasExtraAprobadas: new Map() },
    );

    const line = csv.split('\r\n')[1] ?? '';
    expect(line.startsWith('"Torres, Ana",')).toBe(true);
    expect(line.endsWith('late_arrival clock_drift')).toBe(true);
  });

  it('nombra el archivo con el rango exportado', () => {
    expect(timesheetFileName({ from: '2026-08-24', to: '2026-08-30' })).toBe(
      'krealo-shift-2026-08-24_2026-08-30.csv',
    );
  });

  it('separa horas regulares y extra (§13): extra es lo aprobado ese día', () => {
    /*
     * §13 manda separar SEIS cubos de minutos, y el CSV llevaba cuatro: faltaban
     * regulares y extra. Es el peor sitio donde podían faltar, porque el CSV es lo que
     * sale de la app hacia quien hace la nómina, y obligaba a recalcular a mano fuera lo
     * que la app ya calculaba bien dentro.
     */
    const csv = buildTimesheetCsv([row({ net_minutes: 600 })], {
      labels,
      timezone: 'America/Lima',
      horasExtraAprobadas: new Map([['e-ana_2026-08-27', 120]]),
    });

    // Diez horas con dos aprobadas: ocho regulares y dos extra.
    expect(csv.split('\r\n')[1]).toContain(',10:00,10.00,08:00,02:00,');
  });

  it('las mismas horas sin aprobar son todas regulares', () => {
    // Con el umbral de antes, estas diez horas daban dos de extra aunque nadie las pidiera.
    const csv = buildTimesheetCsv([row({ net_minutes: 600 })], {
      labels,
      timezone: 'America/Lima',
      horasExtraAprobadas: new Map(),
    });

    expect(csv.split('\r\n')[1]).toContain(',10:00,10.00,10:00,00:00,');
  });

  it('sin horas netas no inventa ni regulares ni extra', () => {
    const csv = buildTimesheetCsv([row({ net_minutes: null })], {
      labels,
      timezone: 'America/Lima',
      horasExtraAprobadas: new Map(),
    });

    expect(csv.split('\r\n')[1]).toContain(',00:00,00:00,');
  });
});
