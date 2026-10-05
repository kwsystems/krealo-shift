import type { TimesheetExportRow } from './api';
import type { SupportedLanguage } from '@/i18n';
import { claveDelDia } from './horas-extra';
import {
  formatClockTime,
  minutesToDecimalHours,
  minutesToHHmm,
  splitRegularAndOvertime,
  type TimeFormatPreference,
} from '@/utils/time';

/**
 * Exportación CSV de la hoja de tiempo (§11.4, §13).
 *
 * Dos cosas que aquí no se pueden equivocar:
 *   - el decimal: 1 h 30 min es 1.50, no 1.30. Es el error clásico de nómina;
 *   - el escapado: un nombre con coma o con comillas no debe romper la columna.
 *
 * La función es pura para poder probarla: quien comparte el archivo es
 * `share-csv.ts`, que sí toca el sistema de archivos.
 */

export type CsvColumnKey =
  | 'employee'
  | 'date'
  | 'clockIn'
  | 'clockOut'
  | 'grossHours'
  | 'paidBreak'
  | 'unpaidBreak'
  | 'netHours'
  | 'netDecimal'
  | 'regularHours'
  | 'overtimeHours'
  | 'status'
  | 'flags'
  | 'holiday';

export const CSV_COLUMNS: CsvColumnKey[] = [
  'employee',
  'date',
  'clockIn',
  'clockOut',
  'grossHours',
  'paidBreak',
  'unpaidBreak',
  'netHours',
  'netDecimal',
  'regularHours',
  'overtimeHours',
  'status',
  'flags',
  // Al final y no junto a la fecha: quien ya lee el archivo por posición no se descoloca.
  'holiday',
];

export type CsvLabels = Record<CsvColumnKey, string>;

/** Comillas dobles y separador según RFC 4180. */
export function escapeCsvField(value: string): string {
  if (!/[",\r\n;]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildCsvLine(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

export type CsvOptions = {
  labels: CsvLabels;
  timezone: string;
  timeFormat?: TimeFormatPreference;
  language?: SupportedLanguage;
  /**
   * Horas extra APROBADAS por persona y día (`claveDelDia`), para separar regulares de
   * extra. Se pasan y no se leen de ninguna parte porque esta función es pura.
   */
  horasExtraAprobadas: ReadonlyMap<string, number>;
  /**
   * EL FERIADO DE CADA DÍA, por su nombre, o '' (4-oct): un feriado trabajado se paga
   * distinto (D.L. 713), y quien hace la nómina lo tenía que buscar en el calendario.
   */
  nombreDelFeriado?: (dateKey: string) => string;
};

function minutesCell(value: number | null): string {
  return minutesToHHmm(value ?? 0);
}

export function buildTimesheetCsv(rows: TimesheetExportRow[], options: CsvOptions): string {
  const { labels, timezone, timeFormat = '24h', language = 'es-PE', horasExtraAprobadas } = options;

  /*
   * LO APROBADO ES POR DÍA Y EL ARCHIVO VA POR JORNADA: si alguien tuvo dos jornadas ese
   * día, lo aprobado se reparte en orden, sin pasar de lo trabajado en cada una. Así la
   * suma de la columna de extra del archivo es la misma que la de la pantalla.
   */
  const quedaPorDia = new Map(horasExtraAprobadas);

  const header = buildCsvLine(CSV_COLUMNS.map((column) => labels[column]));

  const body = rows.map((row) => {
    /*
     * REGULARES Y EXTRA, que §13 manda separar y el CSV no llevaba.
     *
     * La pantalla ya los mostraba; el archivo no. Y el archivo es justo lo que sale de
     * la app hacia quien hace la nómina, así que obligaba a recalcular fuera lo que la
     * app ya calculaba bien dentro — y ahí es donde se cometen los errores.
     *
     * Extra es lo que quien gestiona aprobó ese día (ver `horas-extra.ts`).
     */
    const clave = row.employee_id === null ? null : claveDelDia(row.employee_id, row.work_date);
    const queda = clave === null ? 0 : (quedaPorDia.get(clave) ?? 0);
    const { regularMinutes, overtimeMinutes } = splitRegularAndOvertime(
      row.net_minutes ?? 0,
      queda,
    );
    if (clave !== null) quedaPorDia.set(clave, queda - overtimeMinutes);

    return buildCsvLine([
      row.employee_name,
      row.work_date,
      row.clock_in === null ? '' : formatClockTime(row.clock_in, timezone, timeFormat, language),
      row.clock_out === null ? '' : formatClockTime(row.clock_out, timezone, timeFormat, language),
      minutesCell(row.gross_minutes),
      minutesCell(row.paid_break_minutes),
      minutesCell(row.unpaid_break_minutes),
      minutesCell(row.net_minutes),
      minutesToDecimalHours(row.net_minutes ?? 0).toFixed(2),
      minutesCell(regularMinutes),
      minutesCell(overtimeMinutes),
      row.status,
      (row.flags ?? []).join(' '),
      options.nombreDelFeriado?.(row.work_date) ?? '',
    ]);
  });

  // Salto de línea CRLF: es lo que espera Excel en Windows, y el equipo de
  // Krealo revisa estas exportaciones en Windows.
  return [header, ...body].join('\r\n');
}

/** Nombre de archivo estable y ordenable: incluye el rango exportado. */
export function timesheetFileName(params: { from: string; to: string }): string {
  return `krealo-shift-${params.from}_${params.to}.csv`;
}

/** Marca de orden de bytes: sin ella Excel abre los acentos mal. */
export const CSV_BOM = '﻿';
