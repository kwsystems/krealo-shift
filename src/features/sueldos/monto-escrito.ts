/** «1500», «1,500», «1 500.50», «S/ 1500»: el monto en soles, o `null`. */
export function montoEscrito(texto: string): number | null {
  const limpio = texto.replace(/s\/|\s/gi, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(limpio)) return null;
  const monto = Number(limpio.replace(',', '.'));
  return Number.isFinite(monto) && monto > 0 ? monto : null;
}
