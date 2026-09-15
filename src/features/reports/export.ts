import type { EmployeeHours, Punctuality, ReasonTotal } from './aggregate';
import { escapeCsvField } from '@/features/timesheets/csv';
import { minutesToDecimalHours, minutesToHHmm } from '@/utils/time';

/**
 * Lo que se manda desde Reportes (§11.4, «necesito poder mandar reportes siempre desde
 * ahí»).
 *
 * DOS FORMATOS PORQUE SON DOS USOS DISTINTOS
 *   - CSV: se abre en Excel y con eso se paga. Una fila por persona, con los mismos
 *     números que enseña la pantalla.
 *   - Resumen: cuatro líneas de texto para pegar en WhatsApp sin adjuntar nada. Es lo
 *     que de verdad se manda un martes por la tarde.
 *
 * Funciones puras, las dos, y por la misma razón que las cuentas: el decimal de la
 * nómina y el escapado de un nombre con coma son exactamente las dos cosas que no se
 * pueden equivocar, y sin poder probarlas no hay forma de saber que no lo están.
 */

export type ReportExportLabels = {
  employee: string;
  days: string;
  netHours: string;
  netDecimal: string;
  regularHours: string;
  overtimeHours: string;
  shifts: string;
  lateArrivals: string;
  breakMinutes: string;
};

export type ReportExportRow = {
  employeeId: string;
  name: string;
  hours: EmployeeHours;
  measuredShifts: number;
  lateArrivals: number;
  breakMinutes: number;
};

/**
 * Una fila por persona, con las mismas columnas que se ven en pantalla.
 *
 * El decimal va aparte del HH:MM porque son para dos lectores distintos: una persona
 * lee 08:30 y una hoja de cálculo multiplica 8.50. Ponerlo solo en HH:MM obliga a quien
 * paga a convertirlo a mano, y ahí es donde 1 h 30 min se convierte en 1.30.
 */
export function buildReportCsv(params: {
  rows: ReportExportRow[];
  labels: ReportExportLabels;
}): string {
  const cabecera = [
    params.labels.employee,
    params.labels.days,
    params.labels.netHours,
    params.labels.netDecimal,
    params.labels.regularHours,
    params.labels.overtimeHours,
    params.labels.shifts,
    params.labels.lateArrivals,
    params.labels.breakMinutes,
  ];

  const lineas = [cabecera.map(escapeCsvField).join(',')];

  for (const fila of params.rows) {
    lineas.push(
      [
        escapeCsvField(fila.name),
        String(fila.hours.days),
        minutesToHHmm(fila.hours.netMinutes),
        minutesToDecimalHours(fila.hours.netMinutes).toFixed(2),
        minutesToHHmm(fila.hours.regularMinutes),
        minutesToHHmm(fila.hours.overtimeMinutes),
        String(fila.measuredShifts),
        String(fila.lateArrivals),
        String(fila.breakMinutes),
      ].join(','),
    );
  }

  return lineas.join('\r\n');
}

export type SummaryLabels = {
  /** Encabezado con la sede y el periodo ya escritos. */
  heading: string;
  totalHours: string;
  people: string;
  overtime: string;
  punctuality: string;
  punctualityUnknown: string;
  topPerson: string;
  topReason: string;
  footer: string;
};

/**
 * El resumen de texto que se pega en un chat.
 *
 * SIN NOMBRES SALVO UNO, Y ESE ES EL QUE EL PROPIO GRÁFICO DESTACA. Un resumen que
 * lista la jornada de doce personas pegado en el grupo equivocado no se deshace; lo que
 * se manda por chat son los totales del local, que es lo que alguien necesita saber de
 * un vistazo. Quien quiera el detalle por persona manda el CSV, que es un archivo que
 * se elige adjuntar y se ve lo que es.
 */
export function buildReportSummary(params: {
  labels: SummaryLabels;
  totalMinutes: number;
  people: number;
  overtimeMinutes: number;
  punctuality: Punctuality;
  top: { name: string; minutes: number } | null;
  topReason: { name: string; minutes: number } | null;
}): string {
  const lineas = [params.labels.heading, ''];

  lineas.push(`• ${params.labels.totalHours}: ${minutesToHHmm(params.totalMinutes)}`);
  lineas.push(`• ${params.labels.people}: ${params.people}`);

  if (params.overtimeMinutes > 0) {
    lineas.push(`• ${params.labels.overtime}: ${minutesToHHmm(params.overtimeMinutes)}`);
  }

  lineas.push(
    params.punctuality.onTimePercent === null
      ? `• ${params.labels.punctualityUnknown}`
      : `• ${params.labels.punctuality}: ${params.punctuality.onTimePercent}% (${params.punctuality.late}/${params.punctuality.measured})`,
  );

  if (params.top !== null) {
    lineas.push(
      `• ${params.labels.topPerson}: ${params.top.name} ${minutesToHHmm(params.top.minutes)}`,
    );
  }
  if (params.topReason !== null) {
    lineas.push(
      `• ${params.labels.topReason}: ${params.topReason.name} ${minutesToHHmm(params.topReason.minutes)}`,
    );
  }

  lineas.push('', params.labels.footer);
  return lineas.join('\n');
}

/** `krealo-shift-reporte-2026-09-14_2026-09-20.csv` */
export function reportFileName(params: { from: string; to: string }): string {
  return `krealo-shift-reporte-${params.from}_${params.to}.csv`;
}

/** La fila de exportación que corresponde a cada persona del ranking. */
export function buildExportRows(params: {
  ranking: EmployeeHours[];
  nameOf: (employeeId: string) => string;
  punctuality: Punctuality;
  breakMinutesByEmployee: Map<string, number>;
}): ReportExportRow[] {
  const puntual = new Map(params.punctuality.byEmployee.map((fila) => [fila.employeeId, fila]));

  return params.ranking.map((fila) => {
    const suyo = puntual.get(fila.employeeId);
    return {
      employeeId: fila.employeeId,
      name: params.nameOf(fila.employeeId),
      hours: fila,
      measuredShifts: suyo?.measured ?? 0,
      lateArrivals: suyo?.late ?? 0,
      breakMinutes: params.breakMinutesByEmployee.get(fila.employeeId) ?? 0,
    };
  });
}

/** Minutos de pausa por persona, para la columna del CSV. */
export function breakMinutesByEmployee(
  rows: { employee_id: string; minutes: number }[],
): Map<string, number> {
  const porPersona = new Map<string, number>();
  for (const fila of rows) {
    porPersona.set(fila.employee_id, (porPersona.get(fila.employee_id) ?? 0) + fila.minutes);
  }
  return porPersona;
}

/** El motivo que más tiempo se lleva, si hay alguno. */
export function topReasonOf(motivos: ReasonTotal[]): ReasonTotal | null {
  return motivos[0] ?? null;
}
