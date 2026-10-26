import { guardarHoraExtra, reabrirHoraExtra } from '../horas-extra';

const mockFrom = jest.fn();

jest.mock('@/lib/firebase/query', () => ({
  getDataClient: () => ({ from: mockFrom }),
}));

jest.mock('@/stores/session-store', () => ({
  useSessionStore: { getState: () => ({ user: { userId: 'gerente' } }) },
}));

/**
 * CERO HORAS EXTRA ES UNA DECISIÓN (6-oct): «ese día no es hora extra». Antes 0 borraba la
 * aprobación —o no hacía nada—, así que no quedaba decidido y la «posible hora extra» seguía
 * pidiendo respuesta para siempre. Ahora se guarda la fila con 0 minutos.
 *
 * Y no da error sin aprobación previa (auditoría, 4-oct): guardar es un `upsert`, no un
 * borrado de algo que quizá no existe.
 */
describe('guardar horas extra en cero', () => {
  const base = {
    organizationId: 'org',
    locationId: 'sede',
    employeeId: 'e1',
    workDate: '2026-10-03',
    minutes: 0,
  };

  beforeEach(() => mockFrom.mockReset());

  it('guarda la decisión con 0 minutos, nunca borra', async () => {
    const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    const borrar = jest.fn();
    mockFrom.mockReturnValue({ upsert, delete: borrar });
    await expect(guardarHoraExtra(base)).resolves.toBeUndefined();
    expect(borrar).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sede_e1_2026-10-03', minutes: 0, approved_by: 'gerente' }),
      { onConflict: 'id' },
    );
  });

  it('apunta lo que trabajó de más al decidir; sin dato, null (26-oct)', async () => {
    const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ upsert });
    await guardarHoraExtra({ ...base, minutes: 60, deMas: 95.4 });
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ minutes: 60, de_mas_al_decidir: 95 }),
      { onConflict: 'id' },
    );
    await guardarHoraExtra(base);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ de_mas_al_decidir: null }), {
      onConflict: 'id',
    });
  });

  it('«Revisar» borra la decisión de ese día y nada más (26-oct)', async () => {
    const eq = jest.fn().mockResolvedValue({ data: null, error: null });
    const borrar = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ delete: borrar });
    await reabrirHoraExtra({ locationId: 'sede', employeeId: 'e1', workDate: '2026-10-03' });
    expect(borrar).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('id', 'sede_e1_2026-10-03');
  });

  it('un número negativo se guarda como 0', async () => {
    const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ upsert });
    await guardarHoraExtra({ ...base, minutes: -20 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ minutes: 0 }), {
      onConflict: 'id',
    });
  });
});
