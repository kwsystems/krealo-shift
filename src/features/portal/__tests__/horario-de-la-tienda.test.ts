import type { TFunction } from 'i18next';

import es from '@/i18n/locales/es-PE.json';
import {
  companerosDe,
  nombresCortos,
  textoDeCompaneros,
  turnosDelDia,
  type TurnoDeLaTienda,
} from '../horario-de-la-tienda';

/**
 * El horario de toda la tienda en el celular (5-oct): con quién le toca a cada persona.
 */
const t = ((clave: string, valores: Record<string, unknown> = {}) => {
  const partes = clave.split('.');
  const nodo = partes.reduce<unknown>(
    (n, parte) => (n as Record<string, unknown> | undefined)?.[parte],
    es,
  );
  const plural =
    nodo === undefined && typeof valores.count === 'number'
      ? (
          partes
            .slice(0, -1)
            .reduce<unknown>(
              (n, parte) => (n as Record<string, unknown> | undefined)?.[parte],
              es,
            ) as Record<string, unknown> | undefined
        )?.[`${partes[partes.length - 1]}_${valores.count === 1 ? 'one' : 'other'}`]
      : nodo;
  return String(plural ?? clave).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(valores[k] ?? ''),
  );
}) as unknown as TFunction;

function turno(id: string, desde: string, hasta: string, extra: Partial<TurnoDeLaTienda> = {}) {
  return {
    id,
    employee_id: `emp-${id}`,
    nombre: id,
    puesto: 'Cajero',
    color: '#6D4AFF',
    location_id: 'sede-1',
    starts_at: desde,
    ends_at: hasta,
    por_confirmar: false,
    es_mio: false,
    ...extra,
  } satisfies TurnoDeLaTienda;
}

const MIO = {
  location_id: 'sede-1',
  starts_at: '2026-10-06T14:00:00.000Z',
  ends_at: '2026-10-06T22:00:00.000Z',
};

describe('con quién le toca', () => {
  it('coincide quien se pisa aunque sea un rato, en su sede, por orden de entrada', () => {
    const tienda = [
      turno('Carla Medina', '2026-10-06T20:00:00.000Z', '2026-10-07T02:00:00.000Z'),
      turno('Bruno Salazar', '2026-10-06T10:00:00.000Z', '2026-10-06T15:00:00.000Z'),
      turno('Diego', '2026-10-06T22:00:00.000Z', '2026-10-07T04:00:00.000Z'), // entra cuando ella sale
      turno('Elena', '2026-10-06T14:00:00.000Z', '2026-10-06T22:00:00.000Z', {
        location_id: 'sede-2',
      }),
      turno('Ana', MIO.starts_at, MIO.ends_at, { es_mio: true }),
    ];
    expect(companerosDe([MIO], tienda)).toEqual(['Bruno Salazar', 'Carla Medina']);
  });

  it('quien entró la noche anterior y sigue dentro también cuenta', () => {
    const madrugada = {
      location_id: 'sede-1',
      starts_at: '2026-10-07T09:00:00.000Z',
      ends_at: '2026-10-07T13:00:00.000Z',
    };
    const tienda = [turno('Noche', '2026-10-07T03:00:00.000Z', '2026-10-07T11:00:00.000Z')];
    expect(companerosDe([madrugada], tienda)).toEqual(['Noche']);
  });

  it('la misma persona con dos turnos sale una vez', () => {
    const tienda = [
      turno('Bruno', '2026-10-06T14:00:00.000Z', '2026-10-06T17:00:00.000Z'),
      turno('Bruno', '2026-10-06T18:00:00.000Z', '2026-10-06T21:00:00.000Z'),
    ];
    expect(companerosDe([MIO], tienda)).toEqual(['Bruno']);
  });
});

describe('cómo se dice', () => {
  it('por el nombre, completo solo si dos empiezan igual', () => {
    expect(nombresCortos(['Bruno Salazar Nieto', 'Ana Quispe', 'Ana Torres'])).toEqual([
      'Bruno',
      'Ana Quispe',
      'Ana Torres',
    ]);
  });

  it('una, dos, tres y más', () => {
    expect(textoDeCompaneros(t, [])).toBe('Nadie más tiene turno a esa hora');
    expect(textoDeCompaneros(t, ['Bruno Salazar'])).toBe('Con Bruno');
    expect(textoDeCompaneros(t, ['Bruno Salazar', 'Carla'])).toBe('Con Bruno y Carla');
    expect(textoDeCompaneros(t, ['Bruno', 'Carla', 'Diego'])).toBe('Con Bruno, Carla y Diego');
    expect(textoDeCompaneros(t, ['Bruno', 'Carla', 'Diego', 'Elena', 'Fabián'])).toBe(
      'Con Bruno, Carla, Diego y 2 más',
    );
  });
});

describe('los turnos de cada día', () => {
  it('cuentan por el día en que empiezan, en la zona de la sede', () => {
    const tienda = [
      // 23:00 del 6 en Lima = 04:00 del 7 en UTC.
      turno('Noche', '2026-10-07T04:00:00.000Z', '2026-10-07T10:00:00.000Z'),
      turno('Mañana', '2026-10-07T14:00:00.000Z', '2026-10-07T20:00:00.000Z'),
    ];
    expect(turnosDelDia(tienda, '2026-10-06', 'America/Lima').map((x) => x.id)).toEqual(['Noche']);
    expect(turnosDelDia(tienda, '2026-10-07', 'America/Lima').map((x) => x.id)).toEqual(['Mañana']);
  });
});
