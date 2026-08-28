import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ATTENDANCE_STATES,
  TIME_EVENT_TYPES,
  allowedEvents,
  canTransition,
  type AttendanceState,
  type TimeEventType,
} from '../attendance-state-machine';

/**
 * La máquina de estados de TypeScript y la de SQL son la misma (§10).
 *
 * POR QUÉ HACE FALTA. `attendance_transition_allowed` en SQL y esta máquina en
 * TypeScript son DOS COPIAS de la misma regla, y nada las comparaba. La de SQL es la
 * que decide si un fichaje se acepta; la de TypeScript es la que decide qué botones
 * se pintan en el iPad. Si se separan, el kiosco ofrece una acción que el servidor va
 * a rechazar —o esconde una que sí se puede— y en los dos casos la persona se queda
 * sin fichar sin entender por qué.
 *
 * Ese patrón ya produjo tres fallos en este proyecto: los interruptores de
 * notificación que no controlaban nada, los tipos de alerta que la app no conocía, y
 * el redondeo de minutos que difería entre SQL y TypeScript. Leer el archivo SQL es
 * feo, y es la única forma de que este par no pueda separarse en silencio sin
 * levantar una base de datos en Jest.
 */

const MIGRACION = join(__dirname, '../../../supabase/migrations/20260827000300_functions.sql');

/**
 * Extrae la tabla de transiciones del `case` de SQL.
 *
 *     when 'OFF_SHIFT' then p_event = 'clock_in'
 *     when 'WORKING'   then p_event in ('break_start', 'clock_out')
 */
function transicionesDeSql(): Record<string, string[]> {
  const sql = readFileSync(MIGRACION, 'utf8');
  const inicio = sql.indexOf('create or replace function attendance_transition_allowed');
  expect(inicio).toBeGreaterThan(-1);
  const cuerpo = sql.slice(inicio, sql.indexOf('$$;', inicio));

  const tabla: Record<string, string[]> = {};
  for (const linea of cuerpo.split('\n')) {
    const m = /when '([A-Z_]+)'\s+then p_event (?:= '([a-z_]+)'|in \(([^)]*)\))/.exec(linea);
    if (m === null) continue;
    const estado = m[1] ?? '';
    const eventos =
      m[2] !== undefined
        ? [m[2]]
        : [...(m[3] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '');
    tabla[estado] = eventos;
  }
  return tabla;
}

describe('paridad de la máquina de estados', () => {
  const sql = transicionesDeSql();

  it('SQL declara los tres estados que conoce TypeScript', () => {
    expect(Object.keys(sql).sort()).toEqual([...ATTENDANCE_STATES].sort());
  });

  it('para cada estado, las transiciones permitidas coinciden exactamente', () => {
    for (const estado of ATTENDANCE_STATES) {
      expect({ estado, eventos: (sql[estado] ?? []).slice().sort() }).toEqual({
        estado,
        eventos: allowedEvents(estado).slice().sort(),
      });
    }
  });

  it('y las PROHIBIDAS también, que es la mitad que suele fallar', () => {
    // Comparar solo las permitidas dejaría pasar una copia que permite algo de más.
    const prohibidas: [AttendanceState, TimeEventType][] = [];
    for (const estado of ATTENDANCE_STATES) {
      for (const evento of TIME_EVENT_TYPES) {
        if (!canTransition(estado, evento)) prohibidas.push([estado, evento]);
      }
    }

    // Cinco permitidas de doce combinaciones: siete prohibidas.
    expect(prohibidas).toHaveLength(7);

    for (const [estado, evento] of prohibidas) {
      expect((sql[estado] ?? []).includes(evento)).toBe(false);
    }
  });

  it('ningún estado se queda sin salida', () => {
    // Un estado sin transiciones sería un empleado atrapado: el kiosco no le
    // ofrecería nada y el servidor rechazaría todo.
    for (const estado of ATTENDANCE_STATES) {
      expect(allowedEvents(estado).length).toBeGreaterThan(0);
      expect((sql[estado] ?? []).length).toBeGreaterThan(0);
    }
  });

  it('siempre se puede marcar salida salvo estando fuera de turno', () => {
    // Es la garantía que impide que alguien quede con una sesión abierta para
    // siempre porque el descanso no se puede cerrar.
    expect(canTransition('WORKING', 'clock_out')).toBe(true);
    expect(canTransition('ON_BREAK', 'clock_out')).toBe(true);
    expect(canTransition('OFF_SHIFT', 'clock_out')).toBe(false);
  });
});
