/**
 * Por qué alguien se va antes de que acabe su turno (pedido de Andree, 2026-09-22).
 *
 * «Su horario es hasta las 10 p.m. y quiere salir a las 5 p.m., ahí le sale por qué
 * está saliendo antes.»
 *
 * SE PREGUNTA SOLO SI SE PASA DE UN UMBRAL, que es la opción que eligió Andree de las
 * tres que había. Preguntar siempre convierte cada salida de cinco minutos antes en un
 * trámite, y lo que se consigue con eso no es información: es que la gente aprenda a
 * elegir lo primero de la lista para quitárselo de encima. El umbral lo pone cada
 * ubicación, como el resto de las tolerancias.
 *
 * NO ES LO MISMO QUE LA MARCA `early_departure`. La marca la calcula el servidor contra
 * `lateGraceMinutes` y aparece SIEMPRE que la salida es temprana, aunque sean diez
 * minutos: es lo que el gerente ve en Horas. La pregunta del reloj usa un número
 * distinto y más grande porque su coste lo paga el empleado delante de una cola, no el
 * gerente mirando una tabla. Que una salida quede marcada y no se haya preguntado nada
 * es el caso normal, no una incoherencia.
 *
 * EL MOTIVO NO DECIDE NÓMINA, Y ESO ES DELIBERADO.
 * En las pausas el motivo sí se traduce a pagado o no pagado, porque la empresa lo
 * configuró una vez para todos. Aquí no: una salida anticipada resta horas de verdad, y
 * dejar que quien se va elija de una lista si esas horas se le pagan es pedirle que
 * firme su propia planilla. El motivo es INFORMACIÓN para el gerente. Si resulta que la
 * ausencia era trabajo —el caso de «me mandaron al almacén»— lo correcto no es pagar la
 * salida, es que el gerente la reclasifique como pausa, que ya sabe si cuenta como
 * trabajado y deja la corrección auditada con su autor y su motivo.
 */
export const EARLY_DEPARTURE_REASONS = [
  'agreed_end',
  'errand',
  'medical',
  'permit',
  'emergency',
  'other',
] as const;

export type EarlyDepartureReason = (typeof EARLY_DEPARTURE_REASONS)[number];

/**
 * El orden de la lista es el orden en que se usan, y «Otro» va el último.
 *
 * `agreed_end` primero porque es el caso masivo —el gerente te dijo que te fueras— y
 * `errand` segundo porque es el que Andree describió y el que más cuesta si se pierde:
 * es la única respuesta que significa «esto era trabajo».
 */

/**
 * Motivos que obligan a escribir una línea.
 *
 * Solo «Otro», igual que en las pausas y por lo mismo: es el que menos cuesta elegir,
 * así que sin nada que lo frene acaba siendo el cajón donde cae todo.
 *
 * Y `errand` NO la pide a propósito, aunque saber a qué almacén fue sería útil. Es el
 * motivo que más queremos que la gente diga de verdad, y cobrarle una pantalla extra
 * frente a la cola enseña exactamente lo contrario: elegir «fin de jornada acordado»,
 * que no pregunta nada. La explicación de un mandado la puede añadir el gerente después
 * al reclasificarlo; una respuesta falsa no la arregla nadie.
 */
export function requiresDepartureNote(reason: EarlyDepartureReason): boolean {
  return reason === 'other';
}

/**
 * Si el reloj tiene que preguntar por qué se va.
 *
 * Tres razones para NO preguntar, y las tres importan:
 *  - `umbralMinutos <= 0`: la ubicación lo tiene apagado. Cero es apagado en todo el
 *    proyecto (`requiredBreakMinutes`, `photoRetentionDays`), y para «preguntar
 *    siempre» está el 1.
 *  - sin turno: no hay hora de fin contra la que ser temprano. Salir sin turno ya se
 *    registra solo, con la marca `unscheduled`.
 *  - la salida no se adelanta más que el umbral.
 */
export function pideMotivoDeSalida(datos: {
  ahora: Date;
  finDelTurno: Date | null;
  umbralMinutos: number;
}): boolean {
  const { ahora, finDelTurno, umbralMinutos } = datos;
  if (!Number.isFinite(umbralMinutos) || umbralMinutos <= 0) return false;
  if (finDelTurno === null) return false;

  const faltan = finDelTurno.getTime() - ahora.getTime();
  return faltan > umbralMinutos * 60_000;
}
