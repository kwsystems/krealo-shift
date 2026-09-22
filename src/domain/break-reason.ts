/**
 * Motivos de una pausa a mitad de jornada (pedido de Andree, 2026-09-15).
 *
 * "Puede haber un permiso en plena jornada por x motivos, ahí tiene que haber una
 * opción: por permiso, charla, reunión, etc. Así controlas tiempos muertos pero usados
 * por otro motivo."
 *
 * DOS EJES, Y ESTABAN CONFUNDIDOS EN UNO
 * Antes el kiosco preguntaba "¿qué descanso vas a tomar?" con las opciones «pagado»,
 * «no pagado», «comida» y «otro». Eso le pedía al EMPLEADO que decidiera si su descanso
 * se paga: no lo sabe, no es asunto suyo y no lo va a resolver con una cola detrás.
 *
 *   - `BreakReason` es el MOTIVO. Lo dice quien se ausenta, porque es el único que lo
 *     sabe, y es una pregunta que cualquiera puede contestar en un segundo.
 *   - `break_type` (paid/unpaid) sigue siendo la decisión de NÓMINA. La pone la empresa
 *     en los ajustes de la ubicación, una vez, y nadie más vuelve a pensarla.
 *
 * No se mapean uno a uno —una reunión es trabajo y se paga, un permiso personal
 * normalmente no— y por eso son dos campos y no un enum con más valores.
 */
export const BREAK_REASONS = [
  'meal',
  'rest',
  'permit',
  'meeting',
  'training',
  'errand',
  'other',
] as const;

export type BreakReason = (typeof BREAK_REASONS)[number];

/**
 * Qué motivos cuentan como tiempo trabajado, de fábrica.
 *
 * ES UN PUNTO DE PARTIDA, NO UNA LEY. Cada ubicación lo cambia en sus ajustes, porque
 * esto es una decisión del negocio y de la legislación de cada sitio, no algo que pueda
 * decidir una aplicación (§13 es explícita en que no se codifica la ley de ningún país
 * como verdad universal).
 *
 * El criterio de los valores de abajo: una reunión, una charla, una capacitación y un
 * mandado SON trabajo —te lo pide la empresa y no puedes irte— así que cuentan. La comida
 * y el permiso personal son tiempo propio, así que no. El descanso corto cuenta, que es lo
 * habitual y además lo que evita que la gente deje de registrarlo.
 *
 * `errand` ES EL QUE FALTABA, y se añadió el 2026-09-22 a pedido de Andree: «si sale para
 * ir al almacén, pero está marcando porque está saliendo de la tienda». Ninguno de los
 * seis anteriores decía eso. Sin él, quien se ausenta por un encargo de la empresa solo
 * tenía «Otro» —que no cuenta como trabajado— o mentir eligiendo «Reunión». Las dos
 * opciones ensucian el reporte de en qué se va el tiempo, y la primera además le quita
 * horas a alguien que estaba trabajando.
 */
export const DEFAULT_PAID_REASONS: Readonly<Record<BreakReason, boolean>> = {
  meal: false,
  rest: true,
  permit: false,
  meeting: true,
  training: true,
  errand: true,
  other: false,
};

/**
 * La decisión de nómina que le toca a un motivo en esta ubicación.
 *
 * El empleado nunca ve esto: elige el motivo y la app traduce. Si una ubicación no ha
 * configurado nada, manda el valor de fábrica.
 */
export function breakTypeForReason(
  reason: BreakReason,
  paidReasons: Partial<Record<BreakReason, boolean>> | undefined,
): 'paid' | 'unpaid' {
  const pagado = paidReasons?.[reason] ?? DEFAULT_PAID_REASONS[reason];
  return pagado ? 'paid' : 'unpaid';
}

/**
 * Motivos que obligan a escribir una nota.
 *
 * Solo «Otro», y no por capricho: sin obligar a explicarlo, «Otro» se convierte en el
 * cajón donde acaba la mitad de los registros —es el que menos piensa cuesta— y un
 * reporte donde el 40% del tiempo perdido es "otro" no responde a ninguna pregunta.
 */
export function requiresNote(reason: BreakReason): boolean {
  return reason === 'other';
}
