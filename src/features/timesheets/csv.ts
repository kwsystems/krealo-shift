import type { TimesheetExportRow } from './api';
import type { SupportedLanguage } from '@/i18n';
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
  | 'flags';

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
   * Umbral diario de la ubicación, en minutos, para separar regulares de extra.
   *
   * Se pasa y no se lee de ninguna parte porque esta función es pura, y porque el
   * umbral es de la UBICACIÓN: exportar dos ubicaciones con el mismo umbral fijo daría
   * números equivocados en una de las dos.
   */
  dailyOvertimeThresholdMinutes: number;
};

function minutesCell(value: number | null): string {
  return minutesToHHmm(value ?? 0);
}

export function buildTimesheetCsv(rows: TimesheetExportRow[], options: CsvOptions): string {
  const {
    labels,
    timezone,
    timeFormat = '24h',
    language = 'es-PE',
    dailyOvertimeThresholdMinutes,
  } = options;

  const header = buildCsvLine(CSV_COLUMNS.map((column) => labels[column]));

  const body = rows.map((row) => {
    /*
     * REGULARES Y EXTRA, que §13 manda separar y el CSV no llevaba.
     *
     * La pantalla ya los mostraba; el archivo no. Y el archivo es justo lo que sale de
     * la app hacia quien hace la nómina, así que obligaba a recalcular fuera lo que la
     * app ya calculaba bien dentro — y ahí es donde se cometen los errores.
     *
     * Se derivan del umbral y no se guardan en la base a propósito: el umbral de una
     * ubicación se puede cambiar, y unas horas extra congeladas con el umbral viejo
     * dejarían de cuadrar con lo que muestra la pantalla.
     */
    const { regularMinutes, overtimeMinutes } = splitRegularAndOvertime(
      row.net_minutes ?? 0,
      dailyOvertimeThresholdMinutes,
    );

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
