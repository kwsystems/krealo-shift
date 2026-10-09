import type { Almacen, Fila } from '../postgrest';
import { registrarFichajeDemo } from '../reconstruir';

/**
 * EN LA DEMO, FICHAR EN VIVO MIDE LO MISMO QUE EN PRODUCCIÓN (8-oct). Antes la jornada salía
 * sin turno y sin marcas: nadie llegaba tarde ni salía antes fichando en la demostración.
 */
const ZONA = 'America/Lima';
// Lima, UTC-5: el lunes 21-sep de 2026.
const H = (hora: number, minuto = 0) => new Date(Date.UTC(2026, 8, 21, hora + 5, minuto));

function almacenCon(turnos: Fila[]): Almacen {
  return new Map<string, Fila[]>([
    ['locations', [{ id: 'sede', timezone: ZONA, settings: { lateGraceMinutes: 5 } }]],
    ['employees', [{ id: 'e1', full_name: 'Persona de prueba' }]],
    ['shifts', turnos],
    ['time_events', []],
    ['work_sessions', []],
    ['daily_time_summary', []],
    ['employees_working_now', []],
  ]);
}

const turno = (extra: Fila = {}): Fila => ({
  id: 't1',
  employee_id: 'e1',
  location_id: 'sede',
  starts_at: H(10).toISOString(),
  ends_at: H(19).toISOString(),
  planned_unpaid_break_minutes: 60,
  status: 'published',
  publication_version: 1,
  ...extra,
});

const fichar = (almacen: Almacen, eventType: string, ahora: Date) =>
  registrarFichajeDemo(almacen, {
    employeeId: 'e1',
    locationId: 'sede',
    eventType,
    zona: ZONA,
    ahora,
  });

const jornadas = (almacen: Almacen) => almacen.get('work_sessions') ?? [];

describe('fichar en vivo en la demo', () => {
  it('entrar 40 min tarde: la jornada lleva su turno y «llegó tarde»', () => {
    const almacen = almacenCon([turno()]);
    fichar(almacen, 'clock_in', H(10, 40));
    expect(jornadas(almacen)[0]).toMatchObject({ shift_id: 't1', flags: ['late_arrival'] });
    expect(almacen.get('employees_working_now')?.[0]).toMatchObject({ shift_id: 't1' });
  });

  it('irse 3 h antes es «salió antes»', () => {
    const almacen = almacenCon([turno()]);
    fichar(almacen, 'clock_in', H(10));
    fichar(almacen, 'clock_out', H(16));
    expect(jornadas(almacen)[0]).toMatchObject({ flags: ['early_departure'] });
  });

  it('de corrido no es salir antes, como en el servidor', () => {
    const almacen = almacenCon([turno()]);
    fichar(almacen, 'clock_in', H(10));
    fichar(almacen, 'clock_out', H(18));
    expect(jornadas(almacen)[0]).toMatchObject({ shift_id: 't1', flags: [] });
  });

  it('salir a almorzar y volver: ni salida antes por la mañana ni tardanza por la tarde', () => {
    const almacen = almacenCon([turno()]);
    fichar(almacen, 'clock_in', H(10));
    fichar(almacen, 'clock_out', H(14));
    fichar(almacen, 'clock_in', H(15));
    fichar(almacen, 'clock_out', H(19));
    const [manana, tarde] = [...jornadas(almacen)].sort((a, b) =>
      String(a.starts_at).localeCompare(String(b.starts_at)),
    );
    expect(manana).toMatchObject({ shift_id: 't1', flags: [] });
    expect(tarde).toMatchObject({ shift_id: 't1', flags: [] });
  });

  it('sin turno es «sin turno»; un borrador nunca publicado no cuenta', () => {
    const almacen = almacenCon([turno({ status: 'draft', publication_version: 0 })]);
    fichar(almacen, 'clock_in', H(10));
    expect(jornadas(almacen)[0]).toMatchObject({ shift_id: null, flags: ['unscheduled'] });
  });
});
