import { alertsForSession } from '../alerts';
import type { WorkSession } from '../api';
import {
  dentroPorEmpleado,
  dentroPrimero,
  enCursoPorSesionDe,
  estadoDeFila,
  minutosEnCurso,
  totalEnCurso,
  type EnCurso,
} from '../en-curso';

/**
 * Qué es una sesión abierta en Horas: alguien trabajando, alguien en su descanso o una
 * salida olvidada. Solo la tercera es un problema, y las tres se pintaban igual.
 */

function abierta(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 's1',
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: 'turno-1',
    starts_at: '2026-09-29T14:55:00.000Z',
    ends_at: null,
    gross_minutes: null,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: null,
    status: 'open',
    flags: [],
    departure_reason: null,
    departure_note: null,
    updated_at: '2026-09-29T14:55:01.000Z',
    ...overrides,
  };
}

const AHORA = '2026-09-29T17:10:00.000Z'; // 2 h 15 min después de entrar

describe('estado de una fila de Horas', () => {
  it('una sesión cerrada es cerrada, aunque haya dato de «ahora mismo»', () => {
    const cerrada = abierta({ ends_at: '2026-09-29T23:00:00.000Z', status: 'complete' });
    expect(estadoDeFila(cerrada, [], { estado: 'trabajando', descansoDesde: null })).toBe(
      'cerrada',
    );
  });

  it('abierta y reciente es alguien trabajando', () => {
    const sesion = abierta();
    const alertas = alertsForSession(sesion, AHORA);
    expect(alertas).not.toContain('missingClockOut');
    expect(estadoDeFila(sesion, alertas, { estado: 'trabajando', descansoDesde: null })).toBe(
      'trabajando',
    );
  });

  it('sin el dato de quién está dentro, sigue siendo «trabajando», no «sin salida»', () => {
    // El dato llega después que las sesiones; la fila no debe parpadear a rojo en cada carga.
    const sesion = abierta();
    expect(estadoDeFila(sesion, alertsForSession(sesion, AHORA), undefined)).toBe('trabajando');
  });

  it('en su refrigerio es «descanso»', () => {
    expect(
      estadoDeFila(abierta(), [], {
        estado: 'descanso',
        descansoDesde: '2026-09-29T17:00:00.000Z',
      }),
    ).toBe('descanso');
  });

  it('abierta más de lo que dura un turno es una salida olvidada, esté donde esté', () => {
    // Misma regla que las alertas: la del día anterior que nadie cerró.
    const sesion = abierta({ starts_at: '2026-09-28T14:55:00.000Z' });
    const alertas = alertsForSession(sesion, AHORA);
    expect(alertas).toContain('missingClockOut');
    expect(estadoDeFila(sesion, alertas, { estado: 'trabajando', descansoDesde: null })).toBe(
      'sinSalida',
    );
  });
});

describe('minutos en curso', () => {
  it('cuenta desde la entrada hasta ahora', () => {
    expect(minutosEnCurso(abierta(), undefined, AHORA)).toBe(135);
  });

  it('descuenta los descansos no pagados ya cerrados', () => {
    expect(minutosEnCurso(abierta({ unpaid_break_minutes: 60 }), undefined, AHORA)).toBe(75);
  });

  it('se para al empezar el descanso: esos minutos no se trabajan', () => {
    const enCurso = { estado: 'descanso' as const, descansoDesde: '2026-09-29T16:55:00.000Z' };
    expect(minutosEnCurso(abierta(), enCurso, AHORA)).toBe(120);
    // Y no sigue subiendo mientras dure.
    expect(minutosEnCurso(abierta(), enCurso, '2026-09-29T17:40:00.000Z')).toBe(120);
  });

  it('nunca es negativo, aunque el reloj del aparato vaya por detrás', () => {
    expect(minutosEnCurso(abierta(), undefined, '2026-09-29T14:00:00.000Z')).toBe(0);
  });
});

describe('lista de Horas con gente dentro', () => {
  const lunes = abierta({
    id: 'lunes',
    starts_at: '2026-09-28T14:55:00.000Z',
    ends_at: '2026-09-28T23:00:00.000Z',
    status: 'complete',
    net_minutes: 425,
  });
  const olvidada = abierta({
    id: 'olvidada',
    employee_id: 'e2',
    starts_at: '2026-09-28T15:00:00.000Z',
  });
  const trabajando = abierta({ id: 'trabajando', employee_id: 'e3' });
  const enDescanso = abierta({
    id: 'descanso',
    employee_id: 'e4',
    starts_at: '2026-09-29T15:10:00.000Z',
  });
  const sesiones = [lunes, olvidada, trabajando, enDescanso];

  const alertas = new Map(sesiones.map((s) => [s.id, alertsForSession(s, AHORA)]));
  const enCurso = new Map<string, EnCurso>([
    ['trabajando', { estado: 'trabajando', descansoDesde: null }],
    ['descanso', { estado: 'descanso', descansoDesde: '2026-09-29T16:10:00.000Z' }],
  ]);

  it('pone arriba a quien está dentro y conserva el orden del resto', () => {
    expect(dentroPrimero(sesiones, alertas, enCurso).map((s) => s.id)).toEqual([
      'trabajando',
      'descanso',
      'lunes',
      'olvidada',
    ]);
  });

  it('sin nadie dentro no cambia nada', () => {
    expect(dentroPrimero([lunes, olvidada], alertas, new Map()).map((s) => s.id)).toEqual([
      'lunes',
      'olvidada',
    ]);
  });

  it('la casilla cuenta a quien está dentro, no la salida olvidada', () => {
    // 135 min trabajando + 60 min del que entró a las 10:10 y paró a las 11:10.
    expect(totalEnCurso(sesiones, alertas, enCurso, AHORA)).toEqual({ personas: 2, minutos: 195 });
  });

  it('con el filtro en una persona, la casilla habla solo de ella', () => {
    expect(totalEnCurso([trabajando], alertas, enCurso, AHORA)).toEqual({
      personas: 1,
      minutos: 135,
    });
  });
});

describe('quién está dentro, por persona (Equipo)', () => {
  it('lee las filas de «quién está dentro»', () => {
    const map = enCursoPorSesionDe([
      { work_session_id: 'a', attendance_state: 'WORKING', break_started_at: null },
      {
        work_session_id: 'b',
        attendance_state: 'ON_BREAK',
        break_started_at: '2026-09-29T17:00:00.000Z',
      },
    ]);
    expect(map.get('a')).toEqual({ estado: 'trabajando', descansoDesde: null });
    expect(map.get('b')).toEqual({
      estado: 'descanso',
      descansoDesde: '2026-09-29T17:00:00.000Z',
    });
    expect(enCursoPorSesionDe(undefined).size).toBe(0);
  });

  it('da lo que lleva cada persona, con la misma cuenta que Horas', () => {
    const trabajando = abierta({ id: 'a', employee_id: 'e1', unpaid_break_minutes: 60 });
    const enCurso = enCursoPorSesionDe([
      { work_session_id: 'a', attendance_state: 'WORKING', break_started_at: null },
    ]);
    const persona = dentroPorEmpleado([trabajando], enCurso, AHORA).get('e1');
    expect(persona).toEqual({ estado: 'trabajando', desde: trabajando.starts_at, minutos: 75 });
    // Y es exactamente lo que diría su fila en Horas.
    expect(persona?.minutos).toBe(minutosEnCurso(trabajando, enCurso.get('a'), AHORA));
  });

  it('ni la jornada cerrada ni la salida olvidada son alguien dentro', () => {
    const cerrada = abierta({
      id: 'c',
      employee_id: 'e1',
      ends_at: '2026-09-29T16:00:00.000Z',
      status: 'complete',
      net_minutes: 65,
    });
    const olvidada = abierta({ id: 'o', employee_id: 'e2', starts_at: '2026-09-28T14:00:00.000Z' });
    expect(dentroPorEmpleado([cerrada, olvidada], new Map(), AHORA).size).toBe(0);
  });
});
