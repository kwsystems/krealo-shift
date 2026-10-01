import { fireEvent, screen } from '@testing-library/react-native';

import { SessionRow } from '../session-row';
import type { WorkSession } from '@/features/timesheets/api';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La fila de Horas de alguien que está dentro. Antes decía «09:55 – Sin salida · 00:00»
 * de una persona que llevaba dos horas trabajando: lo que se fija aquí es que diga que
 * está trabajando, cuánto lleva, y que la salida olvidada de verdad siga en rojo.
 */

const TZ = 'America/Lima';
const AHORA = '2026-09-29T17:10:00.000Z'; // 12:10 en Lima

function sesion(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 's1',
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: 'turno-1',
    starts_at: '2026-09-29T14:55:00.000Z', // 09:55 en Lima
    ends_at: null,
    gross_minutes: null,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: null,
    status: 'open',
    flags: [],
    departure_reason: null,
    departure_note: null,
    source: null,
    avisos_vistos: [],
    updated_at: '2026-09-29T14:55:01.000Z',
    ...overrides,
  };
}

function pintar(props: Partial<Parameters<typeof SessionRow>[0]> = {}) {
  const onPress = jest.fn();
  return {
    onPress,
    render: () =>
      renderWithProviders(
        <SessionRow
          session={sesion()}
          employeeName="Ana Prueba"
          alerts={[]}
          nowISO={AHORA}
          timezone={TZ}
          timeFormat="24h"
          language="es-PE"
          onPress={onPress}
          testID="fila"
          {...props}
        />,
      ),
  };
}

describe('SessionRow con la jornada abierta', () => {
  it('quien entró a su hora sale «Trabajando», desde cuándo y cuánto lleva', async () => {
    await pintar({ enCurso: { estado: 'trabajando', descansoDesde: null } }).render();

    expect(screen.getByText('Trabajando')).toBeTruthy();
    expect(screen.getByText('desde 09:55 · a tiempo')).toBeTruthy();
    expect(screen.getByTestId('fila-en-curso')).toHaveTextContent('02:15');
    expect(screen.getByText('en curso')).toBeTruthy();
    // Lo que decía antes, y ya no:
    expect(screen.queryByText('Sin salida')).toBeNull();
    expect(screen.queryByText('00:00')).toBeNull();
  });

  it('si llegó tarde no dice «a tiempo», y la alerta de tardanza se ve', async () => {
    await pintar({ alerts: ['lateArrival'] }).render();

    expect(screen.getByText('Trabajando')).toBeTruthy();
    expect(screen.getByText('desde 09:55')).toBeTruthy();
    expect(screen.queryByText(/a tiempo/)).toBeNull();
    expect(screen.getByText('Entrada tardía')).toBeTruthy();
  });

  it('sin turno contra el que medir no promete «a tiempo»', async () => {
    await pintar({ session: sesion({ shift_id: null }) }).render();
    expect(screen.getByText('desde 09:55')).toBeTruthy();
  });

  it('en su refrigerio sale «En descanso» y el contador se para', async () => {
    await pintar({
      enCurso: { estado: 'descanso', descansoDesde: '2026-09-29T16:55:00.000Z' },
    }).render();

    expect(screen.getByText('En descanso')).toBeTruthy();
    // «desde» a secas: la insignia ya dice «En descanso».
    expect(screen.getByText('desde 11:55 · a tiempo')).toBeTruthy();
    expect(screen.getByTestId('fila-en-curso')).toHaveTextContent('02:00');
    expect(screen.getByText('en pausa')).toBeTruthy();
  });

  it('si su pausa es la comida, dice «Almorzando»', async () => {
    await pintar({
      enCurso: {
        estado: 'descanso',
        descansoDesde: '2026-09-29T16:55:00.000Z',
        motivo: 'meal',
      },
    }).render();
    expect(screen.getByText('Almorzando')).toBeTruthy();
    expect(screen.queryByText('En descanso')).toBeNull();
    expect(screen.getByTestId('fila').props.accessibilityLabel).toMatch(/Almorzando/);
  });

  it('la salida olvidada de verdad sigue diciendo «Sin salida», en rojo y sin cifra', async () => {
    await pintar({
      session: sesion({ starts_at: '2026-09-28T14:55:00.000Z' }),
      alerts: ['missingClockOut'],
      enCurso: { estado: 'trabajando', descansoDesde: null },
    }).render();

    expect(screen.getByText('09:55 – Sin salida')).toBeTruthy();
    // Una raya en horas netas y otra en pausas: ninguna cifra inventada.
    expect(screen.getAllByText('–', { exact: true })).toHaveLength(2);
    expect(screen.queryByText('Trabajando')).toBeNull();
    expect(screen.queryByTestId('fila-en-curso')).toBeNull();
  });

  it('el nombre accesible dice el estado, no solo el color', async () => {
    await pintar().render();
    expect(screen.getByTestId('fila').props.accessibilityLabel).toMatch(/Trabajando/);
    expect(screen.getByTestId('fila').props.accessibilityLabel).toMatch(/en curso/);
  });

  it('una jornada cerrada no cambia', async () => {
    const { onPress, render } = pintar({
      session: sesion({
        ends_at: '2026-09-29T23:00:00.000Z',
        status: 'complete',
        net_minutes: 425,
        unpaid_break_minutes: 60,
      }),
    });
    await render();

    expect(screen.getByText('09:55 – 18:00')).toBeTruthy();
    expect(screen.getByText('07:05')).toBeTruthy();
    expect(screen.queryByText('Trabajando')).toBeNull();

    await fireEvent.press(screen.getByTestId('fila'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SessionRow de una jornada registrada desde el horario', () => {
  const cerrada = {
    ends_at: '2026-09-29T23:55:00.000Z', // 18:55 en Lima
    gross_minutes: 540,
    unpaid_break_minutes: 60,
    net_minutes: 480,
    status: 'complete' as const,
  };

  it('dice «Según horario»: nadie la fichó y tiene que notarse', async () => {
    await pintar({ session: sesion({ ...cerrada, source: 'import' }) }).render();
    expect(screen.getByText('09:55 – 18:55 · Según horario')).toBeTruthy();
    expect(screen.getByText('08:00')).toBeTruthy();
  });

  it('una fichada en el reloj no lo dice', async () => {
    await pintar({ session: sesion({ ...cerrada, source: 'kiosk' }) }).render();
    expect(screen.getByText('09:55 – 18:55')).toBeTruthy();
    expect(screen.queryByText(/Según horario/)).toBeNull();
  });
});
