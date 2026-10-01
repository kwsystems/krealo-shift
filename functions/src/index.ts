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
  setOrganizationLogo,
  clearOrganizationLogo,
  createKioskActivationCode,
  revokeKioskDevice,
  managerAdjustTime,
  managerAddTimeEvent,
  managerReclassifyDeparture,
  publishShiftsForWeek,
  recheckSessionsForShift,
  acknowledgeUnusualClock,
  recheckSessionsForPeriod,
  createOrganization,
  approveTimesheetPeriod,
  reopenTimesheetPeriod,
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

/*
 * Eliminar a un empleado de PRUEBA con todo su historial. A quien se va se le desactiva;
 * esto es para quien no debió existir. Ver sus tres seguros en el propio archivo.
 */
export { deleteEmployee } from './eliminar-empleado';

/*
 * Resolver una solicitud de la Bandeja (30-sep). Aprobar un «olvidé marcar» registra el
 * fichaje que faltaba; antes la aprobación ni siquiera se guardaba.
 */
export { reviewTimeEditRequest } from './solicitudes';

/*
 * Las correcciones de hora de un periodo, para Reportes (30-sep): la semana de prueba pide
 * contarlas y la app no sabía.
 */
export { viewCorrectionsSummary } from './correcciones';

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

/*
 * Registrar como cumplido el horario de las semanas de ANTES del reloj (30-sep). Solo
 * esos días: después, un turno sin marcas se corrige persona por persona, con motivo.
 */
export { registerScheduleAsWorked } from './horario-cumplido';
export { applyPlannedBreak, resolveSessionCase, settleOwedHours } from './casos';
