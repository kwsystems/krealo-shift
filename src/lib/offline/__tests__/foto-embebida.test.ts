/**
 * LA FOTO DEL RELOJ WEB NO SE SUBÍA NUNCA, y esta prueba fija por qué.
 *
 * En el navegador `expo-camera` no escribe ningún archivo: devuelve la imagen como
 * `data:image/jpeg;base64,…`, y eso es lo que queda en `pending_media.local_uri`. La
 * subida la leía con `expo-file-system`, que en web no tiene `getInfoAsync` ni
 * `readAsStringAsync` —lanzan «not available»—, así que cada pase daba la foto por
 * fallida y la reintentaba para siempre, en silencio. Y en web la foto es la ÚNICA
 * prueba de presencia (ver `src/lib/kiosk/disponibilidad.ts`).
 *
 * Aquí el sistema de archivos se simula COMO EN WEB —lanzando— para que la prueba
 * falle igual que fallaba la app si alguien vuelve a leer la foto del disco.
 */

// El import va arriba aunque los `jest.mock` estén debajo: Babel los iza.
import { runSync } from '../sync';

const mockPendingPhotos = jest.fn();
const mockAttachPhoto = jest.fn();
const mockMarkPhotoUploaded = jest.fn();
const mockMarkPhotoFailed = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockReadAsStringAsync = jest.fn();
const mockDeleteAsync = jest.fn();

jest.mock('expo-file-system', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('@/features/kiosk/api', () => ({
  attachPhoto: (...args: unknown[]) => mockAttachPhoto(...args),
  syncOfflineEvents: jest.fn(),
  refreshKioskRoster: jest.fn(),
}));

jest.mock('@/features/kiosk/offline-session', () => ({
  cacheRosterAndShifts: jest.fn(),
}));

jest.mock('../pin', () => ({
  storeOfflineVerifiers: jest.fn(),
}));

jest.mock('../database', () => ({
  SYNC_KEYS: (jest.requireActual('../database') as { SYNC_KEYS: unknown }).SYNC_KEYS,
  setSyncMetadata: jest.fn(),
  getSyncMetadata: jest.fn(),
}));

jest.mock('../outbox', () => ({
  applyServerResult: jest.fn(),
  markAttemptFailed: jest.fn(),
  markSending: jest.fn(),
  needsReviewCount: jest.fn(async () => 0),
  pendingCount: jest.fn(async () => 0),
  // Cola de fichajes vacía: el pase va directo a las fotos pendientes.
  pendingEvents: jest.fn(async () => []),
  markPhotoFailed: (...args: unknown[]) => mockMarkPhotoFailed(...args),
  markPhotoUploaded: (...args: unknown[]) => mockMarkPhotoUploaded(...args),
  pendingPhotos: (...args: unknown[]) => mockPendingPhotos(...args),
}));

jest.mock('@/stores/kiosk-store', () => ({
  useKioskStore: { getState: () => ({}) },
}));

jest.mock('@/stores/network-store', () => ({
  useNetworkStore: {
    getState: () => ({
      online: true,
      pendingCount: 0,
      setSyncing: jest.fn(),
      markSynced: jest.fn(),
      setPendingCount: jest.fn(),
      setNeedsReviewCount: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/analytics', () => ({
  track: jest.fn(),
}));

const FOTO_WEB = 'data:image/jpeg;base64,QUJDREVG';
const FOTO_EN_DISCO = 'file:///var/mobile/cache/fichaje.jpg';
const SUBIDA_OK = { ok: true, data: { ok: true, photoPath: 'attendance-photos/org/evt.jpg' } };

/** Lo que hace `expo-file-system` en el navegador: no está. */
const noDisponibleEnWeb = () =>
  new Error('The method or property expo-file-system.getInfoAsync is not available on web');

describe('la subida de una foto que vive embebida en su propia URI (web)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInfoAsync.mockRejectedValue(noDisponibleEnWeb());
    mockReadAsStringAsync.mockRejectedValue(noDisponibleEnWeb());
    mockDeleteAsync.mockRejectedValue(noDisponibleEnWeb());
  });

  it('manda el base64 que ya viene dentro, sin tocar el sistema de archivos', async () => {
    mockPendingPhotos.mockResolvedValue([{ localUri: FOTO_WEB, eventId: 'evt-1', attempts: 0 }]);
    mockAttachPhoto.mockResolvedValue(SUBIDA_OK);

    await runSync();

    expect(mockAttachPhoto).toHaveBeenCalledTimes(1);
    expect(mockAttachPhoto).toHaveBeenCalledWith({
      eventId: 'evt-1',
      imageBase64: 'QUJDREVG',
      contentType: 'image/jpeg',
    });
    expect(mockMarkPhotoUploaded).toHaveBeenCalledWith(FOTO_WEB);
    expect(mockMarkPhotoFailed).not.toHaveBeenCalled();
    // Ni se pregunta al disco ni se intenta borrar un archivo que no existe.
    expect(mockGetInfoAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  it('si el servidor la rechaza, queda como fallida para el siguiente pase', async () => {
    mockPendingPhotos.mockResolvedValue([{ localUri: FOTO_WEB, eventId: 'evt-1', attempts: 0 }]);
    mockAttachPhoto.mockResolvedValue({ ok: false, error: { kind: 'offline' } });

    await runSync();

    expect(mockMarkPhotoFailed).toHaveBeenCalledWith(FOTO_WEB);
    expect(mockMarkPhotoUploaded).not.toHaveBeenCalled();
  });

  it('un archivo de verdad (iPad) sigue leyéndose del disco y borrándose al subir', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockReadAsStringAsync.mockResolvedValue('QUJD');
    mockDeleteAsync.mockResolvedValue(undefined);
    mockPendingPhotos.mockResolvedValue([
      { localUri: FOTO_EN_DISCO, eventId: 'evt-2', attempts: 0 },
    ]);
    mockAttachPhoto.mockResolvedValue(SUBIDA_OK);

    await runSync();

    expect(mockReadAsStringAsync).toHaveBeenCalledWith(FOTO_EN_DISCO, { encoding: 'base64' });
    expect(mockAttachPhoto).toHaveBeenCalledWith({ eventId: 'evt-2', imageBase64: 'QUJD' });
    expect(mockMarkPhotoUploaded).toHaveBeenCalledWith(FOTO_EN_DISCO);
    // Ya está en el servidor y es la cara de una persona: no se guarda dos veces.
    expect(mockDeleteAsync).toHaveBeenCalledWith(FOTO_EN_DISCO, { idempotent: true });
  });
});
