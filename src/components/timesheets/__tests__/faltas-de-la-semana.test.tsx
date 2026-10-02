import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { FaltasDeLaSemana, JustificarFaltaSheet } from '../faltas-de-la-semana';
import type { ShiftRow } from '@/features/schedules/api';
import type { Falta } from '@/features/timesheets/faltas';
import type { ResolucionDeFalta } from '@/features/timesheets/justificaciones';
import { renderWithProviders } from '@/test-utils/render';

/**
 * «¿Por qué faltó?» en Horas (2-oct): cada falta dice si está sin revisar, justificada o
 * no y por qué; la hoja no deja guardar un motivo que no va con el tipo, ni «Otro motivo»
 * sin contar qué pasó.
 */

const TZ = 'America/Lima';

function turno(id: string): ShiftRow {
  return {
    id,
    employee_id: 'e1',
    location_id: 'l1',
    job_role_id: null,
    starts_at: '2026-09-30T23:00:00.000Z', // 18:00 en Lima
    ends_at: '2026-10-01T02:00:00.000Z', // 21:00
    timezone: TZ,
    planned_unpaid_break_minutes: 0,
    employee_note: null,
    manager_note: null,
    status: 'published',
    publication_version: 1,
    published_at: null,
    updated_at: '',
  };
}

function falta(id: string, resolucion: Partial<ResolucionDeFalta> | null = null): Falta {
  return {
    id,
    turno: turno(id),
    employeeId: 'e1',
    dia: '2026-09-30',
    resolucion:
      resolucion === null
        ? null
        : {
            id,
            organization_id: 'o',
            location_id: 'l1',
            employee_id: 'e1',
            shift_id: id,
            work_date: '2026-09-30',
            kind: 'justified',
            reason: 'medical',
            note: null,
            decided_at: null,
            ...resolucion,
          },
  };
}

describe('las faltas de la semana en Horas', () => {
  it('cada fila dice su estado, el motivo y el comentario', async () => {
    await renderWithProviders(
      <FaltasDeLaSemana
        faltas={[
          falta('a', { note: 'Trajo su certificado' }),
          falta('b', { kind: 'unjustified', reason: 'no_notice' }),
          falta('c'),
        ]}
        nombres={new Map([['e1', 'Ana Prueba']])}
        timezone={TZ}
        timeFormat="24h"
        language="es-PE"
        onVino={jest.fn()}
        onPorQue={jest.fn()}
      />,
    );
    expect(screen.getByText('Justificada · Descanso médico')).toBeTruthy();
    expect(screen.getByText('Sin justificar · No avisó')).toBeTruthy();
    expect(screen.getByText('Sin revisar')).toBeTruthy();
    expect(screen.getByText('«Trajo su certificado»')).toBeTruthy();
    // El título cuenta lo que queda por hacer: una sin revisar, una justificada.
    expect(screen.getByText('1 sin revisar')).toBeTruthy();
    expect(screen.getByText('1 justificada')).toBeTruthy();
    // Sin revisar, la acción pregunta; revisada, deja cambiarlo.
    expect(screen.getByTestId('falta-c-porque')).toHaveTextContent('¿Por qué faltó?');
    expect(screen.getByTestId('falta-a-porque')).toHaveTextContent('Cambiar');
  });

  it('«Otro motivo» pide contar qué pasó antes de guardar', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await renderWithProviders(
      <JustificarFaltaSheet
        falta={falta('c')}
        nombre="Ana Prueba"
        timezone={TZ}
        timeFormat="24h"
        language="es-PE"
        guardando={false}
        quitando={false}
        onGuardar={onGuardar}
        onQuitar={jest.fn(() => Promise.resolve())}
        onClose={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByTestId('justificar-falta-other'));
    await fireEvent.press(screen.getByTestId('justificar-falta-guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByText('Con «Otro motivo», escribe qué pasó.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('justificar-falta-nota'), 'Se le inundó la casa');
    await fireEvent.press(screen.getByTestId('justificar-falta-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith({
        kind: 'justified',
        reason: 'other',
        note: 'Se le inundó la casa',
      }),
    );
  });

  it('al pasar a «Sin justificar» se borra un motivo que solo vale justificado', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await renderWithProviders(
      <JustificarFaltaSheet
        falta={falta('a', {})}
        nombre="Ana Prueba"
        timezone={TZ}
        timeFormat="24h"
        language="es-PE"
        guardando={false}
        quitando={false}
        onGuardar={onGuardar}
        onQuitar={jest.fn(() => Promise.resolve())}
        onClose={jest.fn()}
      />,
    );
    // Venía justificada por médico: al cambiar el tipo, «Descanso médico» ya no está.
    await fireEvent.press(screen.getByTestId('justificar-falta-tipo-unjustified'));
    expect(screen.queryByTestId('justificar-falta-medical')).toBeNull();
    await fireEvent.press(screen.getByTestId('justificar-falta-guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByTestId('justificar-falta-sin-motivo')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('justificar-falta-late_notice'));
    await fireEvent.press(screen.getByTestId('justificar-falta-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith({
        kind: 'unjustified',
        reason: 'late_notice',
        note: null,
      }),
    );
    // Ya revisada, se puede volver a «sin revisar».
    expect(screen.getByTestId('justificar-falta-quitar')).toBeTruthy();
  });
});
