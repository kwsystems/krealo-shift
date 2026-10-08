import { fireEvent, screen } from '@testing-library/react-native';

import { SessionDetailSheet } from '../session-detail';
import type { WorkSession } from '@/features/timesheets/api';
import { renderWithProviders } from '@/test-utils/render';

/**
 * El detalle de una jornada en Horas (auditoría, 4-oct): la misma cifra que su fila
 * mientras sigue dentro, y una corrección que manda SOLO lo que se tocó.
 */

const TZ = 'America/Lima';
const AHORA = '2026-09-29T17:10:00.000Z'; // 12:10 en Lima
const DE_NOCHE = '2026-09-30T02:00:00.000Z'; // 21:00 en Lima: la jornada ya cerró

function sesion(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 's1',
    employee_id: 'e1',
    location_id: 'l1',
    shift_id: 'turno-1',
    // 09:58:41 en Lima: con segundos, como los fichajes de verdad.
    starts_at: '2026-09-29T14:58:41.000Z',
    ends_at: null,
    gross_minutes: null,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    net_minutes: null,
    status: 'open',
    flags: [],
    departure_reason: null,
    departure_note: null,
    credit_reason: null,
    credit_note: null,
    auto_clock_out: false,
    source: null,
    avisos_vistos: [],
    casos_resueltos: [],
    updated_at: '2026-09-29T14:58:42.000Z',
    ...overrides,
  };
}

async function pintar(session: WorkSession, ahora = AHORA) {
  const onSubmitCorrection = jest.fn();
  await renderWithProviders(
    <SessionDetailSheet
      session={session}
      employeeName="Ana Prueba"
      events={[]}
      adjustments={[]}
      alerts={[]}
      nowISO={ahora}
      timezone={TZ}
      timeFormat="24h"
      language="es-PE"
      saving={false}
      conflict={false}
      onSubmitCorrection={onSubmitCorrection}
      onClose={() => undefined}
    />,
  );
  return onSubmitCorrection;
}

describe('detalle de una jornada', () => {
  it('abierta, dice lo que lleva en vivo, no «00:00»', async () => {
    await pintar(sesion());
    expect(screen.getByTestId('session-detail-net')).toHaveTextContent(/02:11/);
  });

  it('poner solo la salida no reenvía la entrada recortada al minuto', async () => {
    const enviar = await pintar(
      sesion({ ends_at: '2026-09-29T22:00:00.000Z', net_minutes: 421, gross_minutes: 421 }),
      DE_NOCHE,
    );
    await fireEvent.changeText(screen.getByTestId('session-correct-end'), '16:30');
    await fireEvent.changeText(screen.getByTestId('session-correct-reason'), 'Se fue antes');
    await fireEvent.press(screen.getByTestId('session-correct-submit'));
    expect(enviar).toHaveBeenCalledWith({
      newStartsAt: null,
      newEndsAt: '2026-09-29T21:30:00.000Z',
      reason: 'Se fue antes',
    });
  });

  it('sin tocar ninguna hora no manda nada y lo dice', async () => {
    const enviar = await pintar(
      sesion({ ends_at: '2026-09-29T22:00:00.000Z', net_minutes: 421, gross_minutes: 421 }),
      DE_NOCHE,
    );
    await fireEvent.changeText(screen.getByTestId('session-correct-reason'), 'Revisado');
    await fireEvent.press(screen.getByTestId('session-correct-submit'));
    expect(enviar).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-correct-unchanged')).toBeTruthy();
  });

  /*
   * «Le di Corregir fichaje y nunca se cierra» (8-oct): sin motivo el botón se ponía gris y el
   * aviso salía abajo del todo, fuera de la vista. Ahora lo dice en el pie y el botón sigue vivo:
   * se escribe el motivo, se pulsa otra vez y se manda.
   */
  it('sin motivo dice por qué junto al botón, y con el motivo puesto sí manda', async () => {
    const enviar = await pintar(
      sesion({ ends_at: '2026-09-29T22:00:00.000Z', net_minutes: 421, gross_minutes: 421 }),
      DE_NOCHE,
    );
    await fireEvent.changeText(screen.getByTestId('session-correct-end'), '16:30');
    await fireEvent.press(screen.getByTestId('session-correct-submit'));
    expect(enviar).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-correct-why')).toHaveTextContent(/motivo/i);
    expect(screen.getByTestId('session-correct-submit')).not.toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('session-correct-reason'), 'Se fue antes');
    await fireEvent.press(screen.getByTestId('session-correct-submit'));
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('session-correct-why')).toBeNull();
  });

  /* «18.30» es una hora (8-oct): antes no pasaba nada al pulsar; «18:3» dice por qué no. */
  it('acepta «16.30» como hora y dice por qué no cuando no se entiende', async () => {
    const enviar = await pintar(
      sesion({ ends_at: '2026-09-29T22:00:00.000Z', net_minutes: 421, gross_minutes: 421 }),
      DE_NOCHE,
    );
    await fireEvent.changeText(screen.getByTestId('session-correct-reason'), 'Se fue antes');
    await fireEvent.changeText(screen.getByTestId('session-correct-end'), '16:3');
    await fireEvent.press(screen.getByTestId('session-correct-submit'));
    expect(enviar).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-correct-why')).toHaveTextContent(/no se entiende/);

    await fireEvent.changeText(screen.getByTestId('session-correct-end'), '16.30');
    await fireEvent.press(screen.getByTestId('session-correct-submit'));
    expect(enviar).toHaveBeenCalledWith({
      newStartsAt: null,
      newEndsAt: '2026-09-29T21:30:00.000Z',
      reason: 'Se fue antes',
    });
  });
});
