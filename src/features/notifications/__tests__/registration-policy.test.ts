import {
  pushRegistrationDecision,
  type PushRegistrationBlock,
} from '../registration-policy';

/**
 * La regla que decide si un dispositivo queda registrado para recibir alertas.
 *
 * Lo que de verdad se fija aquí es el caso del kiosco: un iPad de tienda no debe
 * registrarse NUNCA, ni siquiera si alguien inicia sesión en él con una cuenta de
 * gerente. La pantalla está a la vista del público (§19).
 */

type Input = Parameters<typeof pushRegistrationDecision>[0];

const base: Input = {
  platform: 'ios',
  kioskHydrated: true,
  isKioskDevice: false,
  sessionPhase: 'signedIn',
  role: 'manager',
  hasProjectId: true,
};

function reasonOf(overrides: Partial<Input>): PushRegistrationBlock | 'allowed' {
  const decision = pushRegistrationDecision({ ...base, ...overrides });
  return decision.allowed ? 'allowed' : decision.reason;
}

describe('pushRegistrationDecision', () => {
  it('registra a un gerente con sesión en su propio teléfono', () => {
    expect(reasonOf({})).toBe('allowed');
  });

  it('registra también a propietario y administrador', () => {
    expect(reasonOf({ role: 'owner' })).toBe('allowed');
    expect(reasonOf({ role: 'admin' })).toBe('allowed');
  });

  it('NUNCA registra un iPad en modo kiosco, aunque haya sesión de gerente', () => {
    expect(reasonOf({ isKioskDevice: true })).toBe('kiosk');
    expect(reasonOf({ isKioskDevice: true, role: 'owner' })).toBe('kiosk');
  });

  it('no decide nada mientras no se sabe si el dispositivo es kiosco', () => {
    // Importa el orden: si esto devolviera "permitido", se pediría el permiso de
    // notificaciones en el iPad de una tienda antes de saber que es un kiosco, y
    // en iOS ese diálogo no se puede deshacer.
    expect(reasonOf({ kioskHydrated: false })).toBe('resolving');
    expect(reasonOf({ kioskHydrated: false, isKioskDevice: true })).toBe('resolving');
  });

  it('espera a que la sesión esté resuelta', () => {
    expect(reasonOf({ sessionPhase: 'unknown' })).toBe('resolving');
  });

  it('no registra sin sesión', () => {
    expect(reasonOf({ sessionPhase: 'signedOut' })).toBe('noSession');
  });

  it('no registra a un empleado: en P0/P1 no recibe push', () => {
    expect(reasonOf({ role: 'employee' })).toBe('noRole');
    expect(reasonOf({ role: null })).toBe('noRole');
  });

  it('no registra en web: la previsualización no es una superficie de producción', () => {
    expect(reasonOf({ platform: 'web' })).toBe('web');
    // Gana sobre cualquier otra condición, incluso sin resolver el kiosco.
    expect(reasonOf({ platform: 'web', kioskHydrated: false })).toBe('web');
  });

  it('no registra sin projectId de EAS: la llamada fallaría', () => {
    expect(reasonOf({ hasProjectId: false })).toBe('noProjectId');
  });
});
