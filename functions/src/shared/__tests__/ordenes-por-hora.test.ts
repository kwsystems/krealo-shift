import { diasEntre, sumarPorHora, tiendaNormalizada } from '../ordenes-por-hora';

describe('órdenes de Shopify por hora', () => {
  it('suma por día y hora de Lima, sin las de prueba ni las anuladas', () => {
    const porDia = sumarPorHora(
      [
        // 22:30 UTC del 13 = 17:30 en Lima.
        { createdAt: '2026-11-13T22:30:00Z', cancelledAt: null, test: false, total: 100.1 },
        { createdAt: '2026-11-13T22:59:00Z', cancelledAt: null, test: false, total: 50.2 },
        // 03:10 UTC del 14 = 22:10 del 13 en Lima: sigue siendo el 13.
        { createdAt: '2026-11-14T03:10:00Z', cancelledAt: null, test: false, total: 20 },
        { createdAt: '2026-11-13T22:40:00Z', cancelledAt: null, test: true, total: 999 },
        {
          createdAt: '2026-11-13T22:45:00Z',
          cancelledAt: '2026-11-13T23:00:00Z',
          test: false,
          total: 999,
        },
      ],
      'America/Lima',
    );
    expect([...porDia.keys()]).toEqual(['2026-11-13']);
    expect(porDia.get('2026-11-13')).toEqual({
      '17': { orders: 2, sales: 150.3 },
      '22': { orders: 1, sales: 20 },
    });
  });

  it('entiende la tienda escrita de cualquier forma', () => {
    expect(tiendaNormalizada('mitienda')).toBe('mitienda.myshopify.com');
    expect(tiendaNormalizada(' https://MiTienda.myshopify.com/admin ')).toBe(
      'mitienda.myshopify.com',
    );
    expect(tiendaNormalizada('mi tienda')).toBeNull();
    expect(tiendaNormalizada(undefined)).toBeNull();
  });

  it('los días de un rango, los dos extremos incluidos', () => {
    expect(diasEntre('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});
