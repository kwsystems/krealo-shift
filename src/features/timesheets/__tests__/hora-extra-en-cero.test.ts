import { guardarHoraExtra } from '../horas-extra';

const mockFrom = jest.fn();

jest.mock('@/lib/firebase/query', () => ({
  getDataClient: () => ({ from: mockFrom }),
}));

/**
 * CERO HORAS EXTRA SIN NADA APROBADO NO ES UN ERROR (auditoría, 4-oct). Borrar una
 * aprobación que no existe lo niega la regla de Firestore, y la hoja decía «no se pudo
 * guardar» a quien solo confirmaba que ese día no hubo horas extra.
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

  it('sin aprobación previa no toca la base', async () => {
    await expect(guardarHoraExtra({ ...base, yaHabia: false })).resolves.toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('con una aprobación previa, la quita', async () => {
    const eq = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ delete: () => ({ eq }) });
    await guardarHoraExtra({ ...base, yaHabia: true });
    expect(eq).toHaveBeenCalledWith('id', 'sede_e1_2026-10-03');
  });
});
