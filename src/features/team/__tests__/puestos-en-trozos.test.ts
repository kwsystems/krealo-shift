import { enTrozos, fetchEmployeeJobRoles, MAXIMO_DE_UN_IN } from '../api';

const mockIn = jest.fn();

jest.mock('@/lib/firebase/query', () => ({
  getDataClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (campo: string, valores: string[]) => {
            mockIn(campo, valores);
            return Promise.resolve({
              data: valores.map((id) => ({ employee_id: id, job_role_id: 'p1', is_primary: true })),
              error: null,
            });
          },
        }),
      }),
    }),
  }),
}));

/**
 * Con más de 30 fichas los puestos salían vacíos en producción (auditoría, 4-oct):
 * Firestore no acepta más de 30 valores en un `in`, y el emulador sí.
 */
describe('los puestos de más de 30 fichas', () => {
  it('se piden en trozos de 30 y se juntan', async () => {
    const ids = Array.from({ length: 65 }, (_, i) => `e${i}`);
    const filas = await fetchEmployeeJobRoles({ organizationId: 'org', employeeIds: ids });

    expect(filas).toHaveLength(65);
    expect(mockIn).toHaveBeenCalledTimes(3);
    for (const [, valores] of mockIn.mock.calls) {
      expect((valores as string[]).length).toBeLessThanOrEqual(MAXIMO_DE_UN_IN);
    }
  });

  it('enTrozos parte sin perder ni repetir', () => {
    expect(enTrozos([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enTrozos([], 30)).toEqual([]);
  });
});
