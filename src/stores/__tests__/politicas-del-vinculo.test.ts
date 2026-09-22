import {
  DEFAULT_KIOSK_POLICIES,
  politicasDelVinculo,
  type KioskBinding,
} from '@/stores/kiosk-store';

/**
 * Lo que vigila esta prueba es un modo de fallo, no una función.
 *
 * Un reloj se activa una vez y se queda montado en la pared meses. Su vínculo guarda las
 * políticas del día de la activación, así que CADA política nueva que se añada después
 * vale `undefined` en los aparatos que ya están en la tienda —que son todos los que
 * importan— y la función que dependa de ella no se ejecuta nunca. Sin error, sin aviso,
 * y funcionando perfectamente en un aparato recién activado, que es donde se prueba.
 *
 * Paso exactamente eso con el umbral de salida anticipada.
 */

const VINCULO_VIEJO = {
  deviceId: 'd1',
  devicePublicId: 'p1',
  displayName: 'iPad de la tienda',
  organizationId: 'o1',
  organizationName: 'Org',
  organizationLogoPath: null,
  locationId: 'l1',
  locationName: 'Sede',
  timezone: 'America/Lima',
  activatedAt: '2026-01-01T00:00:00.000Z',
  // Las políticas tal como se guardaban ANTES de que existiera el umbral.
  policies: {
    pinLength: 6,
    photoEnabled: false,
    earlyClockInMinutes: 10,
    lateGraceMinutes: 5,
    allowUnscheduledShifts: true,
    timeFormat: '24h',
    requiredBreakMinutes: 0,
  },
} as unknown as KioskBinding;

describe('politicasDelVinculo', () => {
  it('sin vínculo devuelve los valores de fábrica', () => {
    expect(politicasDelVinculo(null)).toEqual(DEFAULT_KIOSK_POLICIES);
  });

  it('a un vínculo viejo le completa la política que no existía cuando se activó', () => {
    expect(politicasDelVinculo(VINCULO_VIEJO).earlyDepartureReasonMinutes).toBe(
      DEFAULT_KIOSK_POLICIES.earlyDepartureReasonMinutes,
    );
  });

  it('el `??` que había antes NO lo arreglaba, y por eso hizo falta esto', () => {
    const comoEstabaAntes = VINCULO_VIEJO.policies ?? DEFAULT_KIOSK_POLICIES;
    expect(comoEstabaAntes.earlyDepartureReasonMinutes).toBeUndefined();
  });

  it('lo que la sede SÍ configuró sigue mandando sobre el valor de fábrica', () => {
    const configurado = {
      ...VINCULO_VIEJO,
      policies: { ...VINCULO_VIEJO.policies, earlyClockInMinutes: 45 },
    } as unknown as KioskBinding;

    expect(politicasDelVinculo(configurado).earlyClockInMinutes).toBe(45);
    expect(DEFAULT_KIOSK_POLICIES.earlyClockInMinutes).not.toBe(45);
  });

  it('no pierde ninguna clave: el resultado trae todas las de fábrica', () => {
    const resultado = politicasDelVinculo(VINCULO_VIEJO);
    for (const clave of Object.keys(DEFAULT_KIOSK_POLICIES)) {
      expect(resultado).toHaveProperty(clave);
    }
  });
});
