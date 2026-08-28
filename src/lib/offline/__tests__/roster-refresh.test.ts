/**
 * El refresco periódico del kiosco guarda las CUATRO cosas (§17).
 *
 * ESTA PRUEBA EXISTE POR UN FALLO CONCRETO. `refreshOfflinePackage` decía en su
 * comentario "refresca el equipo, los turnos, las políticas y los verificadores de
 * PIN", y de las cuatro solo guardaba los verificadores: `mockCacheRosterAndShifts` se
 * llamaba únicamente al ACTIVAR el dispositivo.
 *
 * Todas las consecuencias eran silenciosas. Un empleado contratado después de
 * instalar el iPad sí podía fichar con red, así que el fallo solo se veía el día que
 * se caía la red —el día que importa—. Y los verificadores SÍ se actualizaban, o sea
 * que un PIN nuevo funcionaba sin red y el mecanismo parecía vivo.
 *
 * Lo que se fija es la llamada, no el contenido de SQLite: lo que faltaba era la
 * llamada.
 */

// El import de `sync` va arriba aunque los `jest.mock` estén debajo: Babel IZA las
// llamadas a `jest.mock` por encima de los imports, así que el módulo bajo prueba ve
// las versiones simuladas de todas formas. Import estático y no `await import()`, que
// en este preset necesita --experimental-vm-modules.
import { refreshOfflinePackage } from '../sync';

const mockRefreshKioskRoster = jest.fn();
const mockCacheRosterAndShifts = jest.fn();
const mockStoreOfflineVerifiers = jest.fn();
const mockSetSyncMetadata = jest.fn();
const mockUpdatePolicies = jest.fn();
const mockUpdateOrganization = jest.fn();

jest.mock('@/features/kiosk/api', () => ({
  refreshKioskRoster: (...args: unknown[]) => mockRefreshKioskRoster(...args),
  syncOfflineEvents: jest.fn(),
  attachPhoto: jest.fn(),
}));

jest.mock('@/features/kiosk/offline-session', () => ({
  cacheRosterAndShifts: (...args: unknown[]) => mockCacheRosterAndShifts(...args),
}));

jest.mock('../pin', () => ({
  storeOfflineVerifiers: (...args: unknown[]) => mockStoreOfflineVerifiers(...args),
}));

jest.mock('../database', () => ({
  SYNC_KEYS: { lastRosterRefreshAt: 'lastRosterRefreshAt', lastSyncAt: 'lastSyncAt' },
  setSyncMetadata: (...args: unknown[]) => mockSetSyncMetadata(...args),
  getSyncMetadata: jest.fn(),
}));

jest.mock('../outbox', () => ({
  applyServerResult: jest.fn(),
  markAttemptFailed: jest.fn(),
  markSending: jest.fn(),
  needsReviewCount: jest.fn(),
  pendingCount: jest.fn(),
  pendingEvents: jest.fn(),
  markPhotoFailed: jest.fn(),
  markPhotoUploaded: jest.fn(),
  pendingPhotos: jest.fn(),
}));

jest.mock('@/stores/kiosk-store', () => ({
  useKioskStore: {
    getState: () => ({
      updatePolicies: (...args: unknown[]) => mockUpdatePolicies(...args),
      updateOrganization: (...args: unknown[]) => mockUpdateOrganization(...args),
    }),
  },
}));

jest.mock('@/stores/network-store', () => ({
  useNetworkStore: { getState: () => ({ online: true, setOnline: jest.fn() }) },
}));

const POLITICAS = {
  pinLength: 4,
  photoEnabled: true,
  earlyClockInMinutes: 15,
  lateGraceMinutes: 3,
  allowUnscheduledShifts: false,
  timeFormat: '12h' as const,
  requiredBreakMinutes: 30,
};

const RESPUESTA = {
  ok: true as const,
  data: {
    location: { id: 'loc', name: 'Sede', timezone: 'America/Lima' },
    organization: { name: 'Krealo Media Demo', logoPath: 'org/logo.png' },
    policies: POLITICAS,
    roster: [{ opaqueId: 'abc', displayName: 'Sofía', jobRoleName: null }],
    shifts: [],
    verifiers: [
      {
        employeeOpaqueId: 'abc',
        pinSalt: '$2b$10$abcdefghijklmnopqrstuv',
        pinVerifier: 'f'.repeat(64),
        pinLength: 4,
        pinVersion: 2,
      },
    ],
  },
};

describe('refreshOfflinePackage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('guarda el equipo, los turnos y las políticas, no solo los verificadores', async () => {
    mockRefreshKioskRoster.mockResolvedValue(RESPUESTA);

    await expect(refreshOfflinePackage()).resolves.toEqual({ ok: true });

    // LA LLAMADA QUE FALTABA.
    expect(mockCacheRosterAndShifts).toHaveBeenCalledTimes(1);
    expect(mockCacheRosterAndShifts).toHaveBeenCalledWith({
      roster: RESPUESTA.data.roster,
      shifts: RESPUESTA.data.shifts,
      policies: POLITICAS,
    });

    expect(mockStoreOfflineVerifiers).toHaveBeenCalledTimes(1);
  });

  it('aplica las políticas también al store del kiosco', async () => {
    // A SQLite no basta: la interfaz lee del binding si pide foto y cuántos dígitos
    // tiene el teclado del PIN. Sin esto, activar la foto en el panel no llegaba
    // nunca a un iPad ya instalado.
    mockRefreshKioskRoster.mockResolvedValue(RESPUESTA);

    await refreshOfflinePackage();

    expect(mockUpdatePolicies).toHaveBeenCalledWith(POLITICAS);
  });

  it('actualiza el logotipo y el nombre de la organización', async () => {
    mockRefreshKioskRoster.mockResolvedValue(RESPUESTA);

    await refreshOfflinePackage();

    expect(mockUpdateOrganization).toHaveBeenCalledWith({
      name: 'Krealo Media Demo',
      logoPath: 'org/logo.png',
    });
  });

  it('no guarda nada si la petición falla', async () => {
    // Guardar a medias es peor que no guardar: dejaría el equipo actualizado y los
    // verificadores viejos, o al revés, y el iPad rechazaría PIN correctos.
    mockRefreshKioskRoster.mockResolvedValue({ ok: false, error: { kind: 'offline' } });

    await expect(refreshOfflinePackage()).resolves.toEqual({ ok: false });

    expect(mockCacheRosterAndShifts).not.toHaveBeenCalled();
    expect(mockStoreOfflineVerifiers).not.toHaveBeenCalled();
    expect(mockUpdatePolicies).not.toHaveBeenCalled();
    expect(mockSetSyncMetadata).not.toHaveBeenCalled();
  });

  it('deja constancia de cuándo fue el último refresco', async () => {
    // Es lo que muestra el diagnóstico del kiosco: sin marca de tiempo, "sincronizó"
    // no se distingue de "nunca sincronizó".
    mockRefreshKioskRoster.mockResolvedValue(RESPUESTA);

    await refreshOfflinePackage();

    expect(mockSetSyncMetadata).toHaveBeenCalledWith('lastRosterRefreshAt', expect.any(String));
  });
});
