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
  status: 'Estado',
  flags: 'Alertas',
};

function row(overrides: Partial<TimesheetExportRow> = {}): TimesheetExportRow {
  return {
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

describe('exportación de la hoja de tiempo', () => {
  it('escribe el encabezado traducido y una fila por sesión', () => {
    const csv = buildTimesheetCsv([row()], { labels, timezone: 'America/Lima' });
    const lines = csv.split('\r\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Empleado,Fecha,Entrada,Salida,Horas brutas,Descanso pagado,Descanso no pagado,Horas netas,Horas netas decimales,Estado,Alertas',
    );
    expect(lines[1]).toBe(
      'Ana Torres,2026-08-27,09:00,18:30,09:30,00:00,01:00,08:30,8.50,complete,',
    );
  });

  it('convierte 1 h 30 min en 1.50 horas, no en 1.30', () => {
    const csv = buildTimesheetCsv([row({ net_minutes: 90, net_hours_decimal: 1.5 })], {
      labels,
      timezone: 'America/Lima',
    });

    expect(csv.split('\r\n')[1]).toContain(',01:30,1.50,');
  });

  it('respeta el formato de 12 horas de la ubicación', () => {
    const csv = buildTimesheetCsv([row()], {
      labels,
      timezone: 'America/Lima',
      timeFormat: '12h',
      language: 'en',
    });

    expect(csv.split('\r\n')[1]).toContain('9:00 AM');
  });

  it('deja vacías las horas de una sesión sin salida', () => {
    const csv = buildTimesheetCsv(
      [row({ clock_out: null, net_minutes: null, net_hours_decimal: 0, status: 'open' })],
      { labels, timezone: 'America/Lima' },
    );

    expect(csv.split('\r\n')[1]).toBe(
      'Ana Torres,2026-08-27,09:00,,09:30,00:00,01:00,00:00,0.00,open,',
    );
  });

  it('no rompe columnas con un nombre con coma ni con varias alertas', () => {
    const csv = buildTimesheetCsv(
      [row({ employee_name: 'Torres, Ana', flags: ['late_arrival', 'clock_drift'] })],
      { labels, timezone: 'America/Lima' },
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
});
