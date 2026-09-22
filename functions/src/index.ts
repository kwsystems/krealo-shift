/**
 * Las Cloud Functions de Krealo Shift.
 *
 * Cada nombre exportado aqui es el nombre con el que la app la llama. La traduccion
 * de `snake_case` a `camelCase` la hace el cliente (`src/lib/firebase/query.ts`),
 * asi que `db.rpc('set_employee_pin')` llega a `setEmployeePin` y
 * `functions.invoke('verify-pin')` llega a `verifyPin`. Renombrar una de estas
 * exportaciones rompe la llamada del otro lado sin que ningun compilador lo vea: el
 * nombre de una funcion invocable es una cadena.
 *
 * LO QUE TODAVIA NO ESTA AQUI, y se dice en vez de fingirlo: `sendManagerAlerts`. Es
 * el enviador de las nueve alertas al encargado y no se porto — son unas 600 lineas
 * entre el calculo, la deduplicacion y el reclamo por lotes. Su ausencia no rompe la
 * app: nadie la llama desde el cliente, la disparaba un programador externo cada 15
 * minutos. Sin ella las alertas no salen; con una version a medias saldrian mal, que
 * es peor.
 */

export {
  viewEmployeesWorkingNow,
  viewDailyTimeSummary,
  viewTimeAdjustmentsWithAuthor,
  viewBreakTimeByReason,
  viewKioskDevicesAdmin,
} from './views';

export {
  setEmployeePin,
  createKioskActivationCode,
  revokeKioskDevice,
  managerAdjustTime,
  managerAddTimeEvent,
  approveTimesheetPeriod,
  exportTimesheetRows,
  revokeAllSessions,
  syncManagedLocations,
} from './manager';

export { claimInvitation, inviteMember } from './invitations';

/*
 * La unica funcion PROGRAMADA del proyecto: no la llama la app, la dispara Cloud
 * Scheduler. Se exporta igual, porque el desplegador descubre las funciones por lo que
 * se exporta desde aqui y sin esta linea sencillamente no existiria.
 */
export { purgarFotosDeFichaje } from './purga-fotos';

export { listMembers, setMemberRole, revokeMember, cancelInvitation } from './members';

export {
  activateKiosk,
  refreshKioskRoster,
  verifyPin,
  submitTimeEvent,
  syncOfflineEvents,
  submitTimeEditRequest,
  attachPhoto,
  attendancePhotoUrl,
} from './kiosk-api';
