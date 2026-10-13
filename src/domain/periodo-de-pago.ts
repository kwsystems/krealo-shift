/**
 * EL PERIODO DE PAGO (13-oct). Andree: «el cálculo que hacemos en Universo Tutu es del 1 al
 * 31, el mismo 31 pagamos». Se cuenta del día 1 al último día del mes, y se paga ese último
 * día: el 31, el 30 o el 28/29 de febrero.
 *
 * Un solo sitio para esto: lo usan la cuenta del sueldo, su tarjeta en el celular y la de
 * Equipo. Si otra tienda paga distinto —quincenas, un día fijo—, se cambia aquí.
 */
export type PeriodoDePago = {
  /** Primer día del periodo, `AAAA-MM-DD`. */
  desde: string;
  /** Último día del periodo. */
  hasta: string;
  /** El día en que se paga: el último del periodo. */
  diaDePago: string;
};

const dos = (n: number) => String(n).padStart(2, '0');

/** El periodo en que cae `hoy`, o el de `mesesAtras` meses antes. */
export function periodoDePago(hoy: string, mesesAtras = 0): PeriodoDePago {
  const [anio, mes] = hoy.split('-').map(Number) as [number, number];
  // Date.UTC normaliza el mes: el mes 0 de 2027 es diciembre de 2026.
  const primero = new Date(Date.UTC(anio, mes - 1 - mesesAtras, 1));
  const a = primero.getUTCFullYear();
  const m = primero.getUTCMonth() + 1;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const hasta = `${a}-${dos(m)}-${dos(ultimo)}`;
  return { desde: `${a}-${dos(m)}-01`, hasta, diaDePago: hasta };
}

/** Cuántos días faltan para el pago: 0 el mismo día; negativo si ya se pagó. */
export function diasHastaElPago(hoy: string, periodo: PeriodoDePago): number {
  return Math.round(
    (Date.parse(`${periodo.diaDePago}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000,
  );
}
