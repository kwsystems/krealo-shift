import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';

import { useSesionesAlDiaCon } from '../hooks';

/**
 * Las sesiones se vuelven a pedir cuando cambia quién está dentro. Sin esto, Horas seguía
 * diciendo «Trabajando · en curso» de quien ya había marcado su salida, hasta recargar.
 */

type Filas = { work_session_id: string; attendance_state: string }[];

async function montar(locationId: string, filas: Filas | undefined) {
  const cliente = new QueryClient();
  const invalidar = jest.spyOn(cliente, 'invalidateQueries').mockResolvedValue();
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(
    (props: { locationId: string; filas: Filas | undefined }) =>
      useSesionesAlDiaCon(props.locationId, props.filas),
    { initialProps: { locationId, filas }, wrapper: envoltorio },
  );
  return { invalidar, hook };
}

const dentro = [{ work_session_id: 's1', attendance_state: 'WORKING' }];

describe('sesiones al día con quién está dentro', () => {
  it('la primera foto no dispara nada', async () => {
    const { invalidar } = await montar('l1', dentro);
    expect(invalidar).not.toHaveBeenCalled();
  });

  it('una salida vuelve a pedir las sesiones y los resúmenes de esa sede', async () => {
    const { invalidar, hook } = await montar('l1', dentro);
    await hook.rerender({ locationId: 'l1', filas: [] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['timesheet', 'sessions', 'l1'] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['timesheet', 'summaries', 'l1'] });
  });

  it('empezar el descanso también cuenta como cambio', async () => {
    const { invalidar, hook } = await montar('l1', dentro);
    await hook.rerender({
      locationId: 'l1',
      filas: [{ work_session_id: 's1', attendance_state: 'ON_BREAK' }],
    });
    expect(invalidar).toHaveBeenCalledTimes(2);
  });

  it('la misma foto otra vez, o cambiar de sede, no pide nada', async () => {
    const { invalidar, hook } = await montar('l1', dentro);
    await hook.rerender({ locationId: 'l1', filas: [{ ...dentro[0]! }] });
    await hook.rerender({ locationId: 'l2', filas: [] });
    expect(invalidar).not.toHaveBeenCalled();
  });
});
