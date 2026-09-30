import { QueryClient } from '@tanstack/react-query';

import { refrescarVistasDeHoras, VISTAS_DE_HORAS } from '../refrescar-vistas';

/**
 * Lo que cambia una hora se refresca en TODAS las pantallas que la enseñan (30-sep):
 * publicar el horario dejaba Horas y Reportes con el turno de antes.
 */
it('invalida Horario, Horas, Reportes, Inicio y Bandeja', () => {
  const cliente = new QueryClient();
  const invalidar = jest.spyOn(cliente, 'invalidateQueries').mockResolvedValue();
  refrescarVistasDeHoras(cliente);
  expect(invalidar.mock.calls.map(([filtro]) => filtro?.queryKey?.[0])).toEqual([
    ...VISTAS_DE_HORAS,
  ]);
  expect(VISTAS_DE_HORAS).toEqual(['schedule', 'timesheet', 'reports', 'dashboard', 'requests']);
});
