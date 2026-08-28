import { readAdjustmentSide } from '../adjustment-summary';

/**
 * Historial de cambios: qué cambió, no solo que algo cambió (§11.4).
 *
 * Los dos valores ya venían en la consulta y la pantalla NO los pintaba: el historial
 * mostraba fecha, canal y motivo. Un motivo suelto —"corrección de salida"— no dice si
 * fueron cinco minutos o cinco horas, que es lo único que se revisa en una auditoría.
 *
 * Las formas que se prueban son las que escriben de verdad las funciones de la base:
 * `manager_adjust_time` y `manager_add_time_event`.
 */
describe('lados de una corrección', () => {
  it('una corrección de sesión trae entrada, salida y minutos netos', () => {
    // La forma exacta que escribe `manager_adjust_time`.
    expect(
      readAdjustmentSide({
        startsAt: '2026-08-28T13:00:00Z',
        endsAt: '2026-08-28T21:00:00Z',
        netMinutes: 450,
      }),
    ).toEqual({
      kind: 'session',
      startsAt: '2026-08-28T13:00:00Z',
      endsAt: '2026-08-28T21:00:00Z',
      netMinutes: 450,
    });
  });

  it('una sesión abierta se lee igual, con la salida en null', () => {
    const lado = readAdjustmentSide({ startsAt: '2026-08-28T13:00:00Z', endsAt: null });
    expect(lado.kind).toBe('session');
    expect(lado).toMatchObject({ endsAt: null, netMinutes: null });
  });

  it('"no existía" es un caso propio, no un valor vacío', () => {
    /*
     * `{existed: false}` es lo que escribe `manager_add_time_event`, y la distinción
     * importa en una auditoría laboral: "se corrigió una hora" y "se agregó un fichaje
     * que no existía" no son lo mismo. Pintado como "—" se leería como un dato que
     * falta en vez de como un fichaje inventado a mano por un gerente.
     */
    expect(readAdjustmentSide({ existed: false })).toEqual({ kind: 'absent' });
  });

  it('un fichaje agregado a mano trae el tipo de evento', () => {
    expect(
      readAdjustmentSide({
        eventType: 'clock_out',
        occurredAt: '2026-08-28T21:00:00Z',
        breakType: null,
        source: 'manager',
      }),
    ).toEqual({
      kind: 'event',
      eventType: 'clock_out',
      occurredAt: '2026-08-28T21:00:00Z',
      breakType: null,
    });
  });

  it('una forma desconocida se dice, no se adivina ni revienta', () => {
    // Si una migración futura cambia la forma del jsonb, la pantalla tiene que seguir
    // abriéndose. Un historial que revienta deja sin auditoría justo el día que se
    // audita.
    for (const raro of [null, undefined, 42, 'texto', [], {}, { otraCosa: 1 }]) {
      expect(readAdjustmentSide(raro).kind).toBe('unknown');
    }
  });

  it('un objeto de sesión totalmente vacío cuenta como desconocido', () => {
    // Los tres campos tienen valor por defecto, así que `{}` pasa el esquema. Pintar
    // "— – —" sería peor que decir que no se sabe.
    expect(readAdjustmentSide({ startsAt: null, endsAt: null, netMinutes: null }).kind).toBe(
      'unknown',
    );
  });
});
