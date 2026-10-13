import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  FaltasDeLaSemana,
  JustificarFaltaSheet,
  RegistrarQueVinoSheet,
} from '../faltas-de-la-semana';
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

  /*
   * CUMPLIÓ SU HORARIO (4-oct): la tercera respuesta. Miembro de mesa en elecciones: el día
   * cuenta como trabajado, con su motivo. Los motivos son otros y la ayuda dice qué pasa.
   */
  it('«Cumplió su horario» ofrece sus propios motivos y guarda como cumplido', async () => {
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
    await fireEvent.press(screen.getByTestId('justificar-falta-tipo-credit'));
    expect(screen.queryByTestId('justificar-falta-medical')).toBeNull();
    expect(screen.getByText('Miembro de mesa')).toBeTruthy();
    expect(screen.getByTestId('justificar-falta-efecto').props.children).toMatch(
      /Cuenta como trabajado/,
    );
    expect(screen.getByText('Dar por cumplido')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('justificar-falta-election_duty'));
    await fireEvent.press(screen.getByTestId('justificar-falta-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith({
        kind: 'credit',
        reason: 'election_duty',
        note: null,
      }),
    );
  });

  it('si el servidor dice que ya marcó ese día, lo explica', async () => {
    const onGuardar = jest.fn(() =>
      Promise.reject(Object.assign(new Error('x'), { motivo: 'CON_MARCAS' })),
    );
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
    await fireEvent.press(screen.getByTestId('justificar-falta-tipo-credit'));
    await fireEvent.press(screen.getByTestId('justificar-falta-training'));
    await fireEvent.press(screen.getByTestId('justificar-falta-guardar'));
    await waitFor(() =>
      expect(screen.getByTestId('justificar-falta-error').props.children).toMatch(
        /ya tiene marcas/,
      ),
    );
  });
});

/**
 * CON EL TURNO TODAVÍA EN CURSO (12-oct): «Vino y no marcó» registra solo la entrada —la
 * salida la marca ella en el reloj— y «¿Por qué faltó?» no ofrece «Cumplió su horario».
 */
describe('resolver mientras el turno dura', () => {
  const DURANTE = '2026-10-01T00:30:00.000Z'; // 19:30 en Lima, turno 18:00–21:00

  it('«Vino y no marcó» pide solo la entrada y guarda sin salida', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await renderWithProviders(
      <RegistrarQueVinoSheet
        falta={falta('a')}
        nombre="Ana Prueba"
        timezone={TZ}
        language="es-PE"
        ahoraISO={DURANTE}
        guardando={false}
        onGuardar={onGuardar}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('falta-vino-salida')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('falta-vino-motivo'), 'Se olvidó de marcar');
    await fireEvent.press(screen.getByTestId('falta-vino-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith({
        entradaISO: '2026-09-30T23:00:00.000Z',
        salidaISO: null,
        refrigerioMinutos: 0,
        motivo: 'Se olvidó de marcar',
      }),
    );
  });

  it('una entrada que todavía no ha pasado no se guarda, y se dice por qué', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await renderWithProviders(
      <RegistrarQueVinoSheet
        falta={falta('a')}
        nombre="Ana Prueba"
        timezone={TZ}
        language="es-PE"
        ahoraISO={DURANTE}
        guardando={false}
        onGuardar={onGuardar}
        onClose={jest.fn()}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('falta-vino-entrada'), '20:30');
    await fireEvent.changeText(screen.getByTestId('falta-vino-motivo'), 'Se olvidó de marcar');
    await fireEvent.press(screen.getByTestId('falta-vino-guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByTestId('falta-vino-por-que-no')).toBeTruthy();
  });

  it('«¿Por qué faltó?» no ofrece «Cumplió su horario» mientras el turno dura', async () => {
    await renderWithProviders(
      <JustificarFaltaSheet
        falta={falta('a')}
        nombre="Ana Prueba"
        timezone={TZ}
        timeFormat="24h"
        language="es-PE"
        enCurso
        guardando={false}
        quitando={false}
        onGuardar={jest.fn(() => Promise.resolve())}
        onQuitar={jest.fn(() => Promise.resolve())}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId('justificar-falta-tipo-unjustified')).toBeTruthy();
    expect(screen.queryByTestId('justificar-falta-tipo-credit')).toBeNull();
  });
});

/**
 * CON EL DÍA ENTERO, SU REFRIGERIO (13-oct): si no marcó nada, tampoco marcó la comida. La
 * hoja trae el de su turno puesto, se puede cambiar, y 0 es «trabajó de corrido».
 */
describe('«Vino y no marcó» con el día entero', () => {
  const DESPUES = '2026-10-01T05:00:00.000Z';
  const conRefrigerio = (minutos: number): Falta => {
    const base = falta('a');
    return { ...base, turno: { ...base.turno, planned_unpaid_break_minutes: minutos } };
  };
  const abrir = async (f: Falta, onGuardar: jest.Mock) =>
    renderWithProviders(
      <RegistrarQueVinoSheet
        falta={f}
        nombre="Ana Prueba"
        timezone={TZ}
        language="es-PE"
        ahoraISO={DESPUES}
        guardando={false}
        onGuardar={onGuardar}
        onClose={jest.fn()}
      />,
    );

  it('trae el refrigerio de su turno y lo guarda con la entrada y la salida', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await abrir(conRefrigerio(60), onGuardar);
    expect(screen.getByTestId('falta-vino-refrigerio').props.value).toBe('1 h');
    expect(screen.getByTestId('falta-vino-refrigerio-se-guarda')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('falta-vino-motivo'), 'Se olvidó de marcar');
    await fireEvent.press(screen.getByTestId('falta-vino-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith({
        entradaISO: '2026-09-30T23:00:00.000Z',
        salidaISO: '2026-10-01T02:00:00.000Z',
        refrigerioMinutos: 60,
        motivo: 'Se olvidó de marcar',
      }),
    );
  });

  it('0 es «trabajó de corrido», y un refrigerio que no cabe no se guarda', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await abrir(conRefrigerio(60), onGuardar);
    await fireEvent.changeText(screen.getByTestId('falta-vino-motivo'), 'Se olvidó de marcar');
    await fireEvent.changeText(screen.getByTestId('falta-vino-refrigerio'), '4 h');
    await fireEvent.press(screen.getByTestId('falta-vino-guardar'));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByTestId('falta-vino-por-que-no')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('falta-vino-refrigerio'), '0');
    await fireEvent.press(screen.getByTestId('falta-vino-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith(expect.objectContaining({ refrigerioMinutos: 0 })),
    );
  });

  it('acepta la hora como se escribe: «18» es las 18:00', async () => {
    const onGuardar = jest.fn(() => Promise.resolve());
    await abrir(conRefrigerio(0), onGuardar);
    await fireEvent.changeText(screen.getByTestId('falta-vino-entrada'), '18');
    await fireEvent.changeText(screen.getByTestId('falta-vino-motivo'), 'Se olvidó de marcar');
    await fireEvent.press(screen.getByTestId('falta-vino-guardar'));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith(
        expect.objectContaining({ entradaISO: '2026-09-30T23:00:00.000Z' }),
      ),
    );
  });
});
