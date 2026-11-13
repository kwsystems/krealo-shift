/**
 * Lo puro de las órdenes de Shopify por hora (13-nov), aparte de Firebase para poder
 * probarlo solo. Lo usa `functions/src/shopify.ts`.
 */

export type OrdenMinima = {
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  total: number;
};
export type Hora = { orders: number; sales: number };

/** `mitienda`, `mitienda.myshopify.com` o la URL del panel: todo da el mismo dominio. */
export function tiendaNormalizada(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const conDominio = limpio.endsWith('.myshopify.com') ? limpio : `${limpio}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(conDominio) ? conDominio : null;
}

/** Día (`YYYY-MM-DD`) y hora (0–23) de pared de un instante en la zona de la tienda. */
export function diaYHora(iso: string, zona: string): { dia: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return { dia: `${valor('year')}-${valor('month')}-${valor('day')}`, hora: Number(valor('hour')) };
}

/**
 * Las órdenes, sumadas por día y hora local. Las de prueba y las anuladas no cuentan: no
 * hubo cliente al que atender.
 */
export function sumarPorHora(
  ordenes: readonly OrdenMinima[],
  zona: string,
): Map<string, Record<string, Hora>> {
  const porDia = new Map<string, Record<string, Hora>>();
  for (const orden of ordenes) {
    if (orden.test || orden.cancelledAt !== null) continue;
    const { dia, hora } = diaYHora(orden.createdAt, zona);
    const horas = porDia.get(dia) ?? {};
    const actual = horas[String(hora)] ?? { orders: 0, sales: 0 };
    horas[String(hora)] = {
      orders: actual.orders + 1,
      sales: Math.round((actual.sales + orden.total) * 100) / 100,
    };
    porDia.set(dia, horas);
  }
  return porDia;
}

/** Los días de `desde` a `hasta`, ambos incluidos. */
export function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (
    let t = Date.parse(`${desde}T00:00:00Z`);
    t <= Date.parse(`${hasta}T00:00:00Z`);
    t += 864e5
  ) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}
