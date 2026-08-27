import { managerAlertTypes, parseAlertData, routeForAlertType } from '../alerts';

/**
 * El `data` de una notificación lo guardó el sistema operativo cuando la entregó,
 * así que puede ser de una versión anterior de la app o de otra app. Se valida al
 * recibir (§22) y, si no cuadra, no se navega a ninguna parte.
 */

describe('parseAlertData', () => {
  it('acepta un tipo conocido con su ubicación', () => {
    const parsed = parseAlertData({
      alertType: 'late',
      locationId: '22222222-2222-4222-8222-222222222221',
    });
    expect(parsed).toEqual({
      alertType: 'late',
      locationId: '22222222-2222-4222-8222-222222222221',
    });
  });

  it('acepta un tipo conocido sin ubicación', () => {
    expect(parseAlertData({ alertType: 'newRequest' })).toEqual({ alertType: 'newRequest' });
  });

  it('descarta los campos que no reconoce en lugar de arrastrarlos', () => {
    const parsed = parseAlertData({ alertType: 'late', employeeName: 'Lucía Demo' });
    expect(parsed).toEqual({ alertType: 'late' });
    // Lo que de verdad se comprueba: un nombre que llegue por error en el `data`
    // no se propaga a la app.
    expect(JSON.stringify(parsed)).not.toContain('Lucía');
  });

  it('rechaza lo que no es una alerta nuestra', () => {
    expect(parseAlertData(null)).toBeNull();
    expect(parseAlertData({})).toBeNull();
    expect(parseAlertData('late')).toBeNull();
    expect(parseAlertData({ alertType: 'inventada' })).toBeNull();
    expect(parseAlertData({ alertType: 'late', locationId: 'no-es-uuid' })).toBeNull();
  });
});

describe('routeForAlertType', () => {
  it('lleva cada tipo a una ruta del panel', () => {
    for (const type of managerAlertTypes) {
      expect(routeForAlertType(type)).toMatch(/^\/\(manager\)/);
    }
  });

  it('manda las horas extra y el fichaje sin salida a la hoja de horas', () => {
    expect(routeForAlertType('nearOvertime')).toBe('/(manager)/hours');
    expect(routeForAlertType('incompleteEntry')).toBe('/(manager)/hours');
  });

  it('manda las solicitudes y los relojes a Más', () => {
    expect(routeForAlertType('newRequest')).toBe('/(manager)/more');
    expect(routeForAlertType('kioskNotSyncing')).toBe('/(manager)/more');
    expect(routeForAlertType('wrongKiosk')).toBe('/(manager)/more');
  });

  it('manda tardanza y ausencia al inicio, que es donde se ve quién falta', () => {
    expect(routeForAlertType('late')).toBe('/(manager)');
    expect(routeForAlertType('noShow')).toBe('/(manager)');
  });
});
