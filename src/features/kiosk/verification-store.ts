import { create } from 'zustand';

import type { VerifyPinResponse } from './api';

/**
 * Estado temporal tras validar un PIN en el kiosco (§9.2, §9.5).
 *
 * Vive el mínimo tiempo necesario. Al volver a reposo se limpia inmediatamente
 * nombre, selección y token de acción: el iPad es compartido y el siguiente
 * empleado no debe ver ni un rastro del anterior.
 *
 * Nunca se guarda el PIN: solo el token de acción de corta duración que devuelve
 * el servidor, y tampoco se persiste en disco.
 */

type VerificationState = {
  verification: VerifyPinResponse | null;
  /** Turno elegido cuando hay más de uno elegible (§9.3). */
  selectedShiftId: string | null;

  set: (verification: VerifyPinResponse) => void;
  selectShift: (shiftId: string | null) => void;
  clear: () => void;
};

export const useKioskVerificationStore = create<VerificationState>((set) => ({
  verification: null,
  selectedShiftId: null,

  set: (verification) =>
    set({
      verification,
      // Si hay un solo turno elegible, queda seleccionado sin que el empleado
      // tenga que elegir (§9.3).
      selectedShiftId:
        verification.eligibleShifts.length === 1
          ? (verification.eligibleShifts[0]?.id ?? null)
          : null,
    }),

  selectShift: (selectedShiftId) => set({ selectedShiftId }),

  clear: () => set({ verification: null, selectedShiftId: null }),
}));
