import { screen } from '@testing-library/react-native';

import type { ResultadoDelBono } from '../bono';
import { BonoCard } from '../bono-card';
import { renderWithProviders } from '@/test-utils/render';

/**
 * El apartado del bono: cada persona con su estado y el PORQUÉ en palabras.
 */

const base = {
  turnosContados: 0,
  cumplidos: 0,
  faltas: [],
  tardanzas: [],
  motivoNoAplica: null,
  ingreso: null,
} satisfies Omit<ResultadoDelBono, 'employeeId' | 'estado'>;

const resultados: ResultadoDelBono[] = [
  { ...base, employeeId: 'a', estado: 'gana', turnosContados: 22, cumplidos: 22 },
  {
    ...base,
    employeeId: 'b',
    estado: 'pierde',
    turnosContados: 20,
    faltas: ['2026-09-12'],
    tardanzas: ['2026-09-03', '2026-09-15'],
  },
  {
    ...base,
    employeeId: 'c',
    estado: 'noAplica',
    motivoNoAplica: 'ingresoEnElMes',
    ingreso: '2026-09-10',
  },
];

const nombres: Record<string, string> = { a: 'Ana Prueba', b: 'Bea Prueba', c: 'Cris Prueba' };

describe('apartado del bono de asistencia', () => {
  it('con el mes cerrado: quién lo gana, quién no y por qué', async () => {
    await renderWithProviders(
      <BonoCard
        resultados={resultados}
        mesTerminado
        nombre={(id) => nombres[id] ?? id}
        language="es-PE"
      />,
    );
    expect(screen.getByText('Bono de asistencia')).toBeTruthy();
    expect(screen.getByText('Gana el bono · 1 persona')).toBeTruthy();
    expect(screen.getByText('22 turnos, todos a tiempo')).toBeTruthy();
    expect(screen.getByText('Faltó el 12 sep · Llegó tarde el 3 sep y 15 sep')).toBeTruthy();
    expect(screen.getByText('Entró el 10 sep: mes incompleto')).toBeTruthy();
    // Con el mes cerrado no hay aviso de provisional.
    expect(screen.queryByText(/esto es provisional/)).toBeNull();
  });

  it('con el mes en curso, lo dice', async () => {
    await renderWithProviders(
      <BonoCard resultados={[]} mesTerminado={false} nombre={(id) => id} language="es-PE" />,
    );
    expect(screen.getByText(/esto es provisional/)).toBeTruthy();
    expect(screen.getByText('Nadie tuvo turnos publicados en este mes.')).toBeTruthy();
  });
});
