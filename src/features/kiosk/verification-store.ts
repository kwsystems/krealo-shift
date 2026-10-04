import { create } from 'zustand';

import type { EligibleShift, RequestUpdate, VerifyPinResponse } from './api';
import type { OfflineSessionResult } from './offline-session';
import { permisoVigenteHasta, turnoInicial } from './turnos-del-reloj';
import type { AttendanceState, TimeEventType } from '@/domain/attendance-state-machine';

/**
 * Estado temporal tras validar un PIN en el kiosco (§9.2, §9.5, §9.7).
 *
 * Vive el mínimo tiempo necesario. Al volver a reposo se limpia inmediatamente
 * nombre, selección y token: el iPad es compartido y el siguiente empleado no
 * debe ver ni un rastro del anterior.
 *
 * Nunca se guarda el PIN, y nada de esto se persiste en disco.
 *
 * `mode` distingue los dos caminos de validación, y no es un detalle cosmético:
 * una sesión offline NO tiene token de acción del servidor —el token vive 90
 * segundos y el iPad pudo estar horas sin red— así que su fichaje va a la cola
 * local y se marca como validado por el dispositivo.
 *
 * (El token vive 5 minutos desde el 4-oct; antes 90 segundos. Ver `ACTION_TOKEN_TTL_SECONDS`
 * en el servidor.)
 */

export type KioskSession = {
  mode: 'online' | 'offline';
  /** `null` en modo offline: no hay token del servidor que consumir. */
  actionToken: string | null;
  /**
   * Hasta cuándo vale `actionToken`, en milisegundos de ESTE aparato. `null` sin conexión.
   * Pasada esta hora el reloj pide el PIN otra vez en vez de mandar algo que va a fallar.
   */
  vigenteHasta: number | null;
  /** Versión del PIN con la que se validó. Viaja con el evento offline. */
  pinVersion: number;
  employee: {
    opaqueId: string;
    displayName: string;
    initials: string;
    jobRoleName: string | null;
    canManageLocation: boolean;
  };
  attendanceState: AttendanceState;
  allowedActions: TimeEventType[];
  eligibleShifts: EligibleShift[];
  openSession: {
    startedAt: string;
    /** El turno de la jornada en curso, si tiene. Con jornada abierta no se elige turno. */
    shiftId: string | null;
    shiftStartsAt: string | null;
    shiftEndsAt: string | null;
    takenBreakMinutes: number;
    requiredBreakMinutes: number;
    openBreak: { startedAt: string; breakType: string } | null;
  } | null;
  earliestClockInAt: string | null;
  /**
   * Resultado de sus solicitudes de corrección resueltas hace poco (§19).
   *
   * SIEMPRE UN ARREGLO, vacío en modo offline y nunca `undefined`: la pantalla
   * decide si pintar la tarjeta con `.length`, y un opcional obligaría a un
   * `?? []` en cada uso, que es donde se olvida uno.
   *
   * Vacío sin conexión a propósito: el resultado de una solicitud lo resuelve un
   * encargado en el panel, así que es información que solo existe en el servidor.
   * Guardarla en el iPad para mostrarla sin red significaría replicar en SQLite
   * datos de decisiones ajenas en un dispositivo compartido, para un aviso que la
   * persona verá la próxima vez que el kiosco tenga red.
   */
  requestUpdates: RequestUpdate[];
};

type VerificationState = {
  verification: KioskSession | null;
  /** Turno elegido cuando hay más de uno elegible (§9.3). */
  selectedShiftId: string | null;

  setFromOnline: (response: VerifyPinResponse, pinVersion?: number, timezone?: string) => void;
  setFromOffline: (params: {
    employeeOpaqueId: string;
    pinVersion: number;
    session: Extract<OfflineSessionResult, { status: 'ready' }>;
    timezone?: string;
  }) => void;
  selectShift: (shiftId: string | null) => void;
  clear: () => void;
};

/** Iniciales a partir del nombre para mostrar, cuando el servidor no las manda. */
function initialsFrom(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? '';
  const second = parts[1]?.charAt(0) ?? '';
  return (first + second).toUpperCase() || '?';
}

/**
 * El turno que queda elegido al abrir el reloj. Antes era «el único, si hay uno», y ese
 * único podía ser el de MAÑANA: una entrada de hoy quedaba atada a él. Ver
 * `turnos-del-reloj.ts`.
 */
function turnoElegidoAlEntrar(
  shifts: readonly EligibleShift[],
  turnoDeLaJornada: string | null,
  zona: string,
): string | null {
  return turnoInicial({ turnos: shifts, turnoDeLaJornada, ahora: new Date(), zona });
}

export const useKioskVerificationStore = create<VerificationState>((set) => ({
  verification: null,
  selectedShiftId: null,

  setFromOnline: (response, pinVersion = 1, timezone = 'America/Lima') =>
    set({
      verification: {
        mode: 'online',
        actionToken: response.actionToken,
        vigenteHasta: permisoVigenteHasta({
          recibidoEn: Date.now(),
          expiresInSeconds: response.expiresInSeconds,
          expiresAt: response.expiresAt,
        }),
        pinVersion,
        employee: response.employee,
        attendanceState: response.attendanceState,
        allowedActions: response.allowedActions,
        eligibleShifts: response.eligibleShifts,
        openSession: response.openSession,
        earliestClockInAt: response.earliestClockInAt,
        requestUpdates: response.requestUpdates,
      },
      selectedShiftId: turnoElegidoAlEntrar(
        response.eligibleShifts,
        response.openSession?.shiftId ?? null,
        timezone,
      ),
    }),

  setFromOffline: ({ employeeOpaqueId, pinVersion, session, timezone = 'America/Lima' }) => {
    const shifts: EligibleShift[] =
      session.shift === null
        ? []
        : [
            {
              id: session.shift.id,
              startsAt: session.shift.startsAt,
              endsAt: session.shift.endsAt,
              jobRoleName: session.shift.jobRoleName,
              employeeNote: session.shift.employeeNote,
              plannedUnpaidBreakMinutes: session.shift.plannedUnpaidBreakMinutes,
              changedSinceLastPublication: session.shift.changedSinceLastPublication,
            },
          ];

    set({
      verification: {
        mode: 'offline',
        actionToken: null,
        vigenteHasta: null,
        pinVersion,
        employee: {
          opaqueId: employeeOpaqueId,
          displayName: session.displayName,
          initials: initialsFrom(session.displayName),
          jobRoleName: session.jobRoleName,
          // Sin conexión no se puede comprobar quién es gerente contra el
          // servidor, así que NO se concede: una autorización que no se puede
          // verificar no es una autorización.
          canManageLocation: false,
        },
        attendanceState: session.attendanceState,
        allowedActions: session.allowedActions,
        eligibleShifts: shifts,
        openSession:
          session.sessionStartedAt === null
            ? null
            : {
                startedAt: session.sessionStartedAt,
                shiftId: session.shift?.id ?? null,
                shiftStartsAt: session.shift?.startsAt ?? null,
                shiftEndsAt: session.shift?.endsAt ?? null,
                takenBreakMinutes: session.takenBreakMinutes,
                requiredBreakMinutes: session.requiredBreakMinutes,
                openBreak: null,
              },
        earliestClockInAt: null,
        // Sin conexión no hay resultados de solicitudes: los resuelve un encargado
        // en el panel, así que solo existen en el servidor. Ver la nota en
        // `KioskSession.requestUpdates`.
        requestUpdates: [],
      },
      selectedShiftId: turnoElegidoAlEntrar(
        shifts,
        session.sessionStartedAt === null ? null : (session.shift?.id ?? null),
        timezone,
      ),
    });
  },

  selectShift: (selectedShiftId) => set({ selectedShiftId }),

  clear: () => set({ verification: null, selectedShiftId: null }),
}));
