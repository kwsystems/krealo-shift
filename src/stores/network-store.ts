import * as Network from 'expo-network';
import { create } from 'zustand';

/**
 * Estado de red y sincronización (§17).
 *
 * Sirve para pintar el indicador del kiosco y el aviso de pendientes. La cola real
 * de eventos vive en SQLite, no aquí: este store solo refleja lo que hay.
 */

type NetworkState = {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  /** Eventos que el servidor devolvió como `needs_review` y esperan al gerente. */
  needsReviewCount: number;

  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (count: number) => void;
  setNeedsReviewCount: (count: number) => void;
  markSynced: (at?: Date) => void;
  /** Lee el estado real de la red y se suscribe a los cambios. */
  start: () => Promise<() => void>;
};

export const useNetworkStore = create<NetworkState>((set) => ({
  // Asumimos conexión hasta comprobar lo contrario: bloquear la interfaz por un
  // falso negativo de red sería peor que un aviso que aparece medio segundo tarde.
  online: true,
  syncing: false,
  pendingCount: 0,
  lastSyncAt: null,
  needsReviewCount: 0,

  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  setPendingCount: (pendingCount) => set({ pendingCount: Math.max(0, pendingCount) }),
  setNeedsReviewCount: (needsReviewCount) =>
    set({ needsReviewCount: Math.max(0, needsReviewCount) }),
  markSynced: (at) => set({ lastSyncAt: (at ?? new Date()).toISOString(), syncing: false }),

  start: async () => {
    const initial = await Network.getNetworkStateAsync();
    set({ online: initial.isConnected === true && initial.isInternetReachable !== false });

    const subscription = Network.addNetworkStateListener((state) => {
      set({ online: state.isConnected === true && state.isInternetReachable !== false });
    });

    return () => subscription.remove();
  },
}));
