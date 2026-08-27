import { fireEvent } from '@testing-library/react-native';

import { WeekGrid, type EmployeeRow } from '../week-grid';
import type { ShiftRow } from '@/features/schedules/api';
import { renderWithProviders } from '@/test-utils/render';

/**
 * La cuadrícula es la vista principal del editor en iPad. Se comprueba lo que ve
 * y toca una persona: el horario del turno, la marca de que cambió y que tocar
 * una celda vacía ofrezca crear un turno en ese día y para esa persona.
 */

const timezone = 'America/Lima';

function shiftRow(overrides: Partial<ShiftRow> = {}): ShiftRow {
  return {
    id: 's1',
    employee_id: 'e1',
    location_id: 'l1',
    job_role_id: null,
    starts_at: '2026-08-24T14:00:00.000Z',
    ends_at: '2026-08-24T22:00:00.000Z',
    timezone,
    planned_unpaid_break_minutes: 60,
    employee_note: null,
    manager_note: null,
    status: 'draft',
    publication_version: 1,
    published_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

function rows(shift: ShiftRow): EmployeeRow[] {
  return [
    {
      employeeId: 'e1',
      name: 'Ana Torres',
      shifts: [{ ...shift, dateKey: '2026-08-24' }],
      scheduledMinutes: 420,
    },
  ];
}

const baseProps = {
  days: ['2026-08-24', '2026-08-25'],
  todayKey: '2026-08-24',
  timezone,
  timeFormat: '24h' as const,
  language: 'es-PE' as const,
  jobRoleNames: new Map<string, string>(),
  warningsFor: () => [],
};

describe('cuadrícula semanal', () => {
  it('muestra el horario local del turno y el total del empleado', async () => {
    const view = await renderWithProviders(
      <WeekGrid
        {...baseProps}
        rows={rows(shiftRow())}
        onSelectShift={() => undefined}
        onAddShift={() => undefined}
      />,
    );

    expect(view.getByText('Ana Torres')).toBeTruthy();
    // 14:00 UTC son las 09:00 en Lima; 07:00 netas tras el descanso planificado.
    expect(view.getByText('09:00 – 17:00')).toBeTruthy();
    // Aparece dos veces a propósito: en el turno y en el total de la fila.
    expect(view.getAllByText('07:00')).toHaveLength(2);
  });

  it('marca como cambiado un turno que ya estuvo publicado y volvió a borrador', async () => {
    const view = await renderWithProviders(
      <WeekGrid
        {...baseProps}
        rows={rows(shiftRow())}
        onSelectShift={() => undefined}
        onAddShift={() => undefined}
      />,
    );

    expect(view.getByText('Cambiado')).toBeTruthy();
  });

  it('distingue un borrador nuevo de uno cambiado', async () => {
    const view = await renderWithProviders(
      <WeekGrid
        {...baseProps}
        rows={rows(shiftRow({ publication_version: 0, published_at: null }))}
        onSelectShift={() => undefined}
        onAddShift={() => undefined}
      />,
    );

    expect(view.getByText('Borrador')).toBeTruthy();
  });

  it('abre el turno al tocarlo', async () => {
    const onSelectShift = jest.fn();
    const view = await renderWithProviders(
      <WeekGrid
        {...baseProps}
        rows={rows(shiftRow())}
        onSelectShift={onSelectShift}
        onAddShift={() => undefined}
      />,
    );

    await fireEvent.press(view.getByTestId('shift-s1'));
    expect(onSelectShift).toHaveBeenCalledTimes(1);
  });

  it('al tocar una celda vacía propone crear el turno de esa persona ese día', async () => {
    const onAddShift = jest.fn();
    const view = await renderWithProviders(
      <WeekGrid
        {...baseProps}
        rows={rows(shiftRow())}
        onSelectShift={() => undefined}
        onAddShift={onAddShift}
      />,
    );

    await fireEvent.press(view.getByTestId('add-shift-e1-2026-08-25'));
    expect(onAddShift).toHaveBeenCalledWith({ employeeId: 'e1', dateKey: '2026-08-25' });
  });

  it('en una semana pasada sin permiso de edición muestra los turnos pero no deja tocarlos', async () => {
    const onSelectShift = jest.fn();
    const view = await renderWithProviders(
      <WeekGrid
        {...baseProps}
        rows={rows(shiftRow())}
        onSelectShift={onSelectShift}
        onAddShift={() => undefined}
        readOnly
      />,
    );

    // El horario pasado se conserva y se lee; lo que desaparece es la edición.
    expect(view.getByText('09:00 – 17:00')).toBeTruthy();
    expect(view.queryByTestId('add-shift-e1-2026-08-25')).toBeNull();

    await fireEvent.press(view.getByTestId('shift-s1'));
    expect(onSelectShift).not.toHaveBeenCalled();
  });
});
