import {
  FECHAS_POR_TIPO,
  diasDeLaFecha,
  esTipoDeTienda,
  fechaComercialDe,
  fechasDelAnio,
} from '../fechas-comerciales';

/**
 * Las fechas con más clientes de cada tipo de tienda (4-oct). Las que se mueven se comprueban
 * contra el calendario: un «segundo domingo» mal contado pondría el Día del Niño una semana
 * tarde y nadie lo notaría hasta ese día.
 */
describe('fechas comerciales del Perú', () => {
  it('las que se mueven caen donde dice el calendario de 2025 y 2026', () => {
    // Ley 27666: segundo domingo de abril.
    expect(diasDeLaFecha('diaDelNinoPeruano', 2026)).toEqual(['2026-04-12']);
    expect(diasDeLaFecha('diaDelNinoPeruano', 2025)).toEqual(['2025-04-13']);
    expect(diasDeLaFecha('diaDeLaMadre', 2026)).toEqual(['2026-05-10']);
    expect(diasDeLaFecha('diaDelPadre', 2026)).toEqual(['2026-06-21']);
    expect(diasDeLaFecha('polloALaBrasa', 2026)).toEqual(['2026-07-19']);
    expect(diasDeLaFecha('diaDelNino', 2026)).toEqual(['2026-08-16']);
    expect(diasDeLaFecha('blackFriday', 2025)).toEqual(['2025-11-28']);
    expect(diasDeLaFecha('blackFriday', 2026)).toEqual(['2026-11-27']);
  });

  it('una temporada ocupa todos sus días, y un día suelto dentro dice su nombre', () => {
    const navidad = diasDeLaFecha('campanaNavidad', 2026);
    expect(navidad[0]).toBe('2026-12-15');
    expect(navidad.at(-1)).toBe('2026-12-24');
    expect(navidad).toHaveLength(10);
    // Para ropa, la campaña llega hasta Nochebuena y Nochevieja es otro día.
    const ropa = fechasDelAnio('ropa', 2026);
    expect(ropa.get('2026-12-20')).toBe('campanaNavidad');
    expect(ropa.get('2026-12-31')).toBe('nochevieja');
  });

  it('una juguetería ve sus fechas y no las de un restaurante', () => {
    expect(fechaComercialDe('2026-10-31', 'America/Lima', 'jugueteria')).toBe('halloween');
    expect(fechaComercialDe('2026-01-06', 'America/Lima', 'jugueteria')).toBe('reyes');
    expect(fechaComercialDe('2026-07-19', 'America/Lima', 'jugueteria')).toBeNull();
    expect(fechaComercialDe('2026-07-19', 'America/Lima', 'restaurante')).toBe('polloALaBrasa');
  });

  it('sin tipo de tienda o fuera del Perú no marca nada', () => {
    expect(fechaComercialDe('2026-10-31', 'America/Lima', null)).toBeNull();
    expect(fechaComercialDe('2026-10-31', 'America/Bogota', 'jugueteria')).toBeNull();
  });

  it('cada tipo tiene fechas, y lo que llega de la base se comprueba', () => {
    for (const fechas of Object.values(FECHAS_POR_TIPO)) expect(fechas.length).toBeGreaterThan(0);
    expect(esTipoDeTienda('jugueteria')).toBe(true);
    expect(esTipoDeTienda('ferreteria')).toBe(false);
    expect(esTipoDeTienda(null)).toBe(false);
  });
});
