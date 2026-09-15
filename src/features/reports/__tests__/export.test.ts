import {
  breakMinutesByEmployee,
  buildExportRows,
  buildReportCsv,
  buildReportSummary,
  reportFileName,
  type ReportExportLabels,
  type SummaryLabels,
} from '../export';
import type { EmployeeHours, Punctuality } from '../aggregate';

/**
 * Lo que un reporte exportado no puede equivocar.
 *
 * Dos cosas, y las dos se cobran en dinero o en confianza:
 *   - EL DECIMAL. 1 h 30 min es 1.50, no 1.30. Es el error clásico de nómina y no lo
 *     denuncia nadie: 1.30 es un número perfectamente válido que se paga mal.
 *   - EL ESCAPADO. Un apellido con coma parte la fila en dos columnas y desplaza todos
 *     los números de esa persona una posición. El CSV sigue abriendo sin quejarse.
 *
 * Y una tercera que no es de formato sino de privacidad: el resumen que se pega en un
 * chat NO puede ir llenándose de nombres.
 */

const ETIQUETAS: ReportExportLabels = {
  employee: 'Persona',
  days: 'Días',
  netHours: 'Horas netas',
  netDecimal: 'Horas netas (decimal)',
  regularHours: 'Normales',
  overtimeHours: 'Extra',
  shifts: 'Turnos',
  lateArrivals: 'Tardanzas',
  breakMinutes: 'Minutos de pausa',
};

const horas = (parcial: Partial<EmployeeHours>): EmployeeHours => ({
  employeeId: 'e1',
  netMinutes: 0,
  regularMinutes: 0,
  overtimeMinutes: 0,
  days: 0,
  ...parcial,
});

describe('CSV del reporte', () => {
  it('escribe el decimal de nómina, no el reloj: 1 h 30 es 1.50', () => {
    const csv = buildReportCsv({
      rows: [
        {
          employeeId: 'e1',
          name: 'Ana',
          hours: horas({ netMinutes: 90, regularMinutes: 90, days: 1 }),
          measuredShifts: 1,
          lateArrivals: 0,
          breakMinutes: 0,
        },
      ],
      labels: ETIQUETAS,
    });
    const fila = csv.split('\r\n')[1] ?? '';
    expect(fila).toContain('01:30');
    expect(fila).toContain('1.50');
    expect(fila).not.toContain('1.30');
  });

  it('un apellido con coma no parte la fila en dos columnas', () => {
    const csv = buildReportCsv({
      rows: [
        {
          employeeId: 'e1',
          name: 'Salazar, Bruno',
          hours: horas({ netMinutes: 480, regularMinutes: 480, days: 1 }),
          measuredShifts: 1,
          lateArrivals: 0,
          breakMinutes: 30,
        },
      ],
      labels: ETIQUETAS,
    });
    const fila = csv.split('\r\n')[1] ?? '';
    expect(fila.startsWith('"Salazar, Bruno",')).toBe(true);
    // Nueve columnas exactas: si la coma del nombre hubiera partido la fila, serían diez
    // y todos los números de esta persona estarían corridos un sitio.
    const columnas = (fila.match(/,/g) ?? []).length - 1;
    expect(columnas).toBe(8);
  });

  it('las columnas de la cabecera y las de los datos coinciden en número', () => {
    const csv = buildReportCsv({
      rows: [
        {
          employeeId: 'e1',
          name: 'Ana',
          hours: horas({ netMinutes: 600, regularMinutes: 480, overtimeMinutes: 120, days: 2 }),
          measuredShifts: 2,
          lateArrivals: 1,
          breakMinutes: 45,
        },
      ],
      labels: ETIQUETAS,
    });
    const [cabecera = '', datos = ''] = csv.split('\r\n');
    expect(cabecera.split(',')).toHaveLength(9);
    expect(datos.split(',')).toHaveLength(9);
  });

  it('sin nadie, deja la cabecera y ninguna fila', () => {
    const csv = buildReportCsv({ rows: [], labels: ETIQUETAS });
    expect(csv.split('\r\n')).toHaveLength(1);
  });
});

describe('resumen para pegar en un chat', () => {
  const ETIQUETAS_RESUMEN: SummaryLabels = {
    heading: 'Krealo Shift · Sede Principal · 14 al 20 de septiembre',
    totalHours: 'Horas del periodo',
    people: 'Personas',
    overtime: 'Extra',
    punctuality: 'Llegó a tiempo',
    punctualityUnknown: 'Puntualidad: sin turnos programados',
    topPerson: 'Más horas',
    topReason: 'Más tiempo de pausa',
    footer: 'Son horas fichadas, no producción.',
  };

  const PUNTUAL: Punctuality = {
    measured: 9,
    late: 3,
    unscheduled: 1,
    onTimePercent: 67,
    byEmployee: [],
  };

  it('resume el periodo con los totales del local', () => {
    const texto = buildReportSummary({
      labels: ETIQUETAS_RESUMEN,
      totalMinutes: 2931,
      people: 7,
      overtimeMinutes: 226,
      punctuality: PUNTUAL,
      top: { name: 'Diego', minutes: 681 },
      topReason: { name: 'Comida', minutes: 45 },
    });
    expect(texto).toContain('48:51');
    expect(texto).toContain('67% (3/9)');
    expect(texto).toContain('Diego 11:21');
    expect(texto).toContain('Comida 00:45');
    expect(texto).toContain('no producción');
  });

  /**
   * LA IMPORTANTE. El resumen se pega en un chat de un toque, así que solo puede llevar
   * el nombre de quien encabeza el ranking —que es el dato que se está mandando— y
   * ninguno más. El detalle por persona va en el CSV, que es un archivo que alguien
   * elige adjuntar y ve lo que es.
   */
  it('no lleva más nombres que el de quien encabeza', () => {
    const texto = buildReportSummary({
      labels: ETIQUETAS_RESUMEN,
      totalMinutes: 2931,
      people: 7,
      overtimeMinutes: 0,
      punctuality: { ...PUNTUAL, byEmployee: [{ employeeId: 'e2', measured: 2, late: 2 }] },
      top: { name: 'Diego', minutes: 681 },
      topReason: null,
    });
    expect(texto).toContain('Diego');
    expect(texto).not.toContain('e2');
    // Y sin horas extra, esa línea no aparece: una línea que dice 00:00 es ruido.
    expect(texto).not.toContain('Extra');
  });

  it('cuando no hay con qué medir la puntualidad, lo dice en vez de poner 100%', () => {
    const texto = buildReportSummary({
      labels: ETIQUETAS_RESUMEN,
      totalMinutes: 100,
      people: 1,
      overtimeMinutes: 0,
      punctuality: { measured: 0, late: 0, unscheduled: 3, onTimePercent: null, byEmployee: [] },
      top: null,
      topReason: null,
    });
    expect(texto).toContain('sin turnos programados');
    expect(texto).not.toContain('100%');
  });
});

describe('armado de las filas', () => {
  it('cruza horas, puntualidad y pausas por la misma persona', () => {
    const filas = buildExportRows({
      ranking: [
        horas({ employeeId: 'ana', netMinutes: 600, days: 2 }),
        horas({ employeeId: 'beto', netMinutes: 300, days: 1 }),
      ],
      nameOf: (id) => (id === 'ana' ? 'Ana' : 'Beto'),
      punctuality: {
        measured: 3,
        late: 1,
        unscheduled: 0,
        onTimePercent: 67,
        byEmployee: [{ employeeId: 'ana', measured: 2, late: 1 }],
      },
      breakMinutesByEmployee: new Map([['beto', 30]]),
    });

    expect(filas[0]).toMatchObject({
      name: 'Ana',
      measuredShifts: 2,
      lateArrivals: 1,
      breakMinutes: 0,
    });
    // Beto no aparece en la puntualidad —todos sus fichajes fueron sin turno— y eso
    // son cero turnos medibles, NO una tardanza ni un hueco: si se colara el valor de
    // la fila anterior, el reporte acusaría a alguien de llegar tarde por error.
    expect(filas[1]).toMatchObject({
      name: 'Beto',
      measuredShifts: 0,
      lateArrivals: 0,
      breakMinutes: 30,
    });
  });

  it('suma los minutos de pausa de una persona por todos sus motivos y días', () => {
    const mapa = breakMinutesByEmployee([
      { employee_id: 'ana', minutes: 45 },
      { employee_id: 'ana', minutes: 12 },
      { employee_id: 'beto', minutes: 30 },
    ]);
    expect(mapa.get('ana')).toBe(57);
    expect(mapa.get('beto')).toBe(30);
  });
});

describe('nombre del archivo', () => {
  it('lleva el periodo, para no acabar con cinco «reporte.csv» en Descargas', () => {
    expect(reportFileName({ from: '2026-09-14', to: '2026-09-20' })).toBe(
      'krealo-shift-reporte-2026-09-14_2026-09-20.csv',
    );
  });
});
