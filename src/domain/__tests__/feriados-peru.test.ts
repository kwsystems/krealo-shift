import en from '@/i18n/locales/en.json';
import esPE from '@/i18n/locales/es-PE.json';

import { domingoDePascua, FERIADOS_PERU, feriadoDe, feriadosDelAnio } from '../feriados-peru';

/**
 * Los feriados del Perú. La primera prueba es la que manda: el calendario oficial de 2026
 * (D.L. 713, publicado por el Gobierno y recogido por Garrigues, El Comercio y La
 * República), fecha por fecha. Si alguien quita o mueve uno, falla aquí y no en el
 * horario de una tienda un feriado cualquiera.
 */

describe('feriados nacionales del Perú', () => {
  it('2026: los 16 del calendario oficial, ni uno más', () => {
    expect([...feriadosDelAnio(2026).entries()].sort()).toEqual([
      ['2026-01-01', 'anioNuevo'],
      ['2026-04-02', 'juevesSanto'],
      ['2026-04-03', 'viernesSanto'],
      ['2026-05-01', 'trabajo'],
      ['2026-06-07', 'bandera'],
      ['2026-06-29', 'sanPedro'],
      ['2026-07-23', 'fuerzaAerea'],
      ['2026-07-28', 'fiestasPatrias'],
      ['2026-07-29', 'fiestasPatrias'],
      ['2026-08-06', 'junin'],
      ['2026-08-30', 'santaRosa'],
      ['2026-10-08', 'angamos'],
      ['2026-11-01', 'todosLosSantos'],
      ['2026-12-08', 'inmaculada'],
      ['2026-12-09', 'ayacucho'],
      ['2026-12-25', 'navidad'],
    ]);
  });

  it('Semana Santa se mueve con la Pascua, sin tabla que rellenar cada año', () => {
    expect(domingoDePascua(2025)).toEqual({ mes: 4, dia: 20 });
    expect(domingoDePascua(2026)).toEqual({ mes: 4, dia: 5 });
    expect(domingoDePascua(2027)).toEqual({ mes: 3, dia: 28 });
    // 2027: Jueves y Viernes Santo caen en marzo.
    expect(feriadoDe('2027-03-25', 'America/Lima')).toBe('juevesSanto');
    expect(feriadoDe('2027-03-26', 'America/Lima')).toBe('viernesSanto');
  });

  it('solo en sedes del Perú', () => {
    expect(feriadoDe('2026-07-28', 'America/Lima')).toBe('fiestasPatrias');
    expect(feriadoDe('2026-07-28', 'America/Toronto')).toBeNull();
  });

  it('un día normal no es feriado, ni los no laborables del sector público', () => {
    expect(feriadoDe('2026-09-30', 'America/Lima')).toBeNull();
    expect(feriadoDe('2026-01-02', 'America/Lima')).toBeNull();
    expect(feriadoDe('2026-07-27', 'America/Lima')).toBeNull();
  });
});

describe('cada feriado tiene su nombre', () => {
  it('en español y en inglés: un nombre que falta se pintaría como «holidays.pe.junin»', () => {
    for (const feriado of FERIADOS_PERU) {
      expect(esPE.holidays.pe[feriado]).toBeTruthy();
      expect(en.holidays.pe[feriado]).toBeTruthy();
    }
  });
});
