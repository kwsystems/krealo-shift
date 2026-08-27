import { create } from 'zustand';

import { resetOfflineDatabase } from '@/lib/offline/database';
import { SECURE_KEYS, secureStorage } from '@/lib/security/secure-storage';

/**
 * Estado del dispositivo como kiosco (§8, §9).
 *
 * Un kiosco queda vinculado a UNA sola ubicación. Nunca se reutiliza una sesión
 * completa de administrador como credencial permanente del kiosco: lo que se
 * guarda aquí es una credencial limitada emitida por el backend al activar.
 *
 * El secreto de la credencial vive en SecureStore y no se copia a este store; en
 * memoria solo mantenemos lo necesario para pintar la interfaz y decidir rutas.
 */

export type KioskPolicies = {
  pinLength: number;
  photoEnabled: boolean;
  earlyClockInMinutes: number;
  lateGraceMinutes: number;
  allowUnscheduledShifts: boolean;
  timeFormat: '12h' | '24h';
  requiredBreakMinutes: number;
};

export const DEFAULT_KIOSK_POLICIES: KioskPolicies = {
  // PIN configurable entre 4 y 6 dígitos; predeterminado 6 (§8).
  pinLength: 6,
  // La foto está desactivada por defecto en todas las ubicaciones (§9.6).
  photoEnabled: false,
  earlyClockInMinutes: 10,
  lateGraceMinutes: 5,
  allowUnscheduledShifts: true,
  timeFormat: '24h',
  requiredBreakMinutes: 0,
};

export type KioskBinding = {
  deviceId: string;
  devicePublicId: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  locationId: string;
  locationName: string;
  timezone: string;
  policies: KioskPolicies;
  activatedAt: string;
};

type KioskState = {
  hydrated: boolean;
  /** `null` significa que este dispositivo no es un kiosco. */
  binding: KioskBinding | null;
  /** El backend revocó el dispositivo: hay que mostrar la pantalla de revocado. */
  revoked: boolean;

  hydrate: () => Promise<void>;
  activate: (binding: KioskBinding, credential: string, deviceKey: string) => Promise<void>;
  updatePolicies: (policies: Partial<KioskPolicies>) => Promise<void>;
  markRevoked: () => void;
  /** Salir del modo kiosco borra la credencial y la clave del dispositivo. */
  deactivate: () => Promise<void>;
};

export const useKioskStore = create<KioskState>((set, get) => ({
  hydrated: false,
  binding: null,
  revoked: false,

  hydrate: async () => {
    const binding = await secureStorage.getJson<KioskBinding>(SECURE_KEYS.kioskCredential);
    set({ binding, hydrated: true, revoked: false });
  },

  activate: async (binding, credential, deviceKey) => {
    // El secreto y la clave del dispositivo van a SecureStore, separados del binding.
    await secureStorage.set(`${SECURE_KEYS.kioskCredential}.secret`, credential);
    await secureStorage.set(SECURE_KEYS.kioskDeviceKey, deviceKey);
    await secureStorage.setJson(SECURE_KEYS.kioskCredential, binding);
    set({ binding, revoked: false });
  },

  updatePolicies: async (policies) => {
    const current = get().binding;
    if (current === null) return;
    const next: KioskBinding = { ...current, policies: { ...current.policies, ...policies } };
    await secureStorage.setJson(SECURE_KEYS.kioskCredential, next);
    set({ binding: next });
  },

  markRevoked: () => set({ revoked: true }),

  deactivate: async () => {
    await secureStorage.remove(`${SECURE_KEYS.kioskCredential}.secret`);
    await secureStorage.remove(SECURE_KEYS.kioskDeviceKey);
    await secureStorage.remove(SECURE_KEYS.kioskCredential);

    // Se borra tambien la base local. Dejar en un iPad que ya no es kiosco los
    // verificadores de PIN del personal, su nombre y sus turnos seria una fuga:
    // el dispositivo pasa a ser un iPad cualquiera (§22).
    //
    // Si quedaban eventos sin sincronizar se pierden, y eso es a proposito: salir
    // del modo kiosco es una accion deliberada de un gerente, que primero deberia
    // sincronizar. El menu de salida ofrece "Sincronizar ahora" justo antes.
    try {
      await resetOfflineDatabase();
    } catch {
      // Si la base local no se puede abrir, no hay nada que borrar.
    }

    set({ binding: null, revoked: false });
  },
}));

/** Un dispositivo es kiosco cuando tiene una vinculación guardada. */
export function isKioskDevice(state: Pick<KioskState, 'binding'>): boolean {
  return state.binding !== null;
}
