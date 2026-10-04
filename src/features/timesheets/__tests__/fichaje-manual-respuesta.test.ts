import { RPC } from '@/lib/firebase/tables';

import { addManualTimeEvent } from '../api';

const mockRpc = jest.fn();

jest.mock('@/lib/firebase/query', () => ({
  getDataClient: () => ({ rpc: mockRpc }),
}));

/**
 * LA RESPUESTA DE `managerAddTimeEvent`, CON LA FORMA QUE DE VERDAD MANDA (4-oct).
 *
 * El servidor devuelve `{ eventId, workSessionId }` y aquí se esperaba la forma de la base
 * de antes, `[{ event_id, work_session_id }]`. El fichaje se guardaba y la app lo daba por
 * fallido: la hoja de «Agregar fichaje manual» no se cerraba, «Marcar salida» de «Por
 * resolver» parecía no hacer nada, y «Vino y no marcó» se quedaba con la entrada sin la
 * salida. La demostración contestaba con la forma vieja, así que solo se vio en producción.
 */

const base = {
  employeeId: 'emp-1',
  locationId: 'sede-1',
  occurredAt: '2026-10-04T15:00:00.000Z',
  reason: 'La tienda abrió a las 2 pm',
};

describe('fichaje manual: la respuesta del servidor', () => {
  beforeEach(() => mockRpc.mockReset());

  it('una entrada devuelve su fichaje y la jornada que abre', async () => {
    mockRpc.mockResolvedValue({
      data: { eventId: 'evento-1', workSessionId: 'jornada-1' },
      error: null,
    });
    await expect(addManualTimeEvent({ ...base, eventType: 'clock_in' })).resolves.toEqual({
      eventId: 'evento-1',
      workSessionId: 'jornada-1',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      RPC.managerAddTimeEvent,
      expect.objectContaining({ p_employee_id: 'emp-1', p_event_type: 'clock_in' }),
    );
  });

  it('un descanso no abre jornada: vuelve sin ella y no es un error', async () => {
    mockRpc.mockResolvedValue({ data: { eventId: 'evento-2', workSessionId: null }, error: null });
    await expect(addManualTimeEvent({ ...base, eventType: 'break_start' })).resolves.toEqual({
      eventId: 'evento-2',
      workSessionId: null,
    });
  });

  it('el motivo vacío no llega al servidor', async () => {
    await expect(
      addManualTimeEvent({ ...base, eventType: 'clock_in', reason: '  ' }),
    ).rejects.toBeDefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
