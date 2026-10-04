import { createManualEntryRequest } from '@/features/timesheets/api';

import { requestSchema } from '../api';

let escrito: Record<string, unknown> | null = null;

jest.mock('@/lib/firebase/query', () => ({
  getDataClient: () => ({
    from: () => ({
      insert: (fila: Record<string, unknown>) => {
        escrito = fila;
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

/**
 * LO QUE DE VERDAD ESCRIBE una «Corrección de hora» hecha desde Horas, leído con el esquema
 * de la Bandeja (4-oct). La prueba de al lado comprobaba un ejemplo escrito a mano que sí
 * traía `status`, y el código real no lo escribía: la Bandeja entera caía en cuanto había
 * una. Aquí se lee lo que sale de la función.
 */
describe('una corrección creada desde Horas', () => {
  it('se puede leer en la Bandeja, pendiente y sin revisar', async () => {
    await createManualEntryRequest({
      organizationId: 'org-1',
      locationId: 'sede-1',
      employeeId: 'alguien',
      kind: 'correction',
      targetDate: '2026-10-04',
      proposedAt: '2026-10-04T15:00:00.000Z',
      proposedEndAt: null,
      reason: 'Llegó a las 10',
    });
    expect(escrito).toMatchObject({ status: 'pending', reviewer_comment: null, reviewed_at: null });
    // Lo que añade el adaptador a todo insert.
    const leida = requestSchema.safeParse({
      ...escrito,
      id: 'solicitud-1',
      created_at: '2026-10-04T16:00:00.000Z',
    });
    expect(leida.success).toBe(true);
  });

  it('una de antes, sin estado, se lee como pendiente y no tumba la Bandeja', () => {
    const leida = requestSchema.safeParse({
      id: 'vieja',
      employee_id: 'alguien',
      location_id: 'sede-1',
      work_session_id: null,
      target_date: '2026-10-01',
      kind: 'correction',
      proposed_value: { startsAt: '2026-10-01T15:00:00.000Z', endsAt: null },
      reason: 'Llegó a las 10',
      created_at: '2026-10-01T16:00:00.000Z',
    });
    expect(leida.success && leida.data.status).toBe('pending');
  });
});
