import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import type { ShiftRow } from '@/features/schedules/api';
import { turnoEnPie } from '@/features/schedules/turno-en-pie';
import type { DateKey } from '@/features/schedules/week';
import { ADMIN_LIST_STALE_MS, requireClient, selectRows } from '@/hooks/use-admin-query';
import { RPC, TABLES } from '@/lib/firebase/tables';

/**
 * LAS ÓRDENES DE SHOPIFY POR HORA, Y QUIÉN ESTABA EN TURNO (13-nov).
 *
 * Andree: «ver en qué horarios cada día hay más órdenes y luego hacer un análisis total».
 * Es lo que hace Homebase con el punto de venta —las ventas de cada hora al lado de las
 * horas de personal— y lo que hacen Square y Shopify con sus «horas de más movimiento»: un
 * mapa de día de la semana por hora, con la MEDIA de los días del periodo.
 *
 * LA MEDIA Y NO LA SUMA: un mes tiene cuatro o cinco sábados y cuatro lunes. Sumando, el
 * día que se repite una vez más parecería más fuerte sin serlo. Y la media es por día CON
 * DATOS: un día que todavía no se trajo de Shopify no es un día sin órdenes.
 *
 * QUIÉN ESTABA EN TURNO: los turnos en pie del periodo (publicados, o publicados y
 * cambiándose: `turnoEnPie`), contando a cada persona en la hora cuyo minuto 30 cubre su
 * turno. Es la cuenta de Homebase, «órdenes por persona en turno»: donde es alta falta
 * gente, y donde hay gente y casi no hay órdenes, sobra.
 *
 * Los datos los escribe el servidor (`functions/src/shopify.ts`): solo totales por hora.
 */

const horaSchema = z.object({ orders: z.number(), sales: z.number() });

export const filaDeOrdenesSchema = z.object({
  date: z.string(),
  hours: z.record(z.string(), horaSchema).default({}),
  orders: z.number().default(0),
  sales: z.number().default(0),
  currency: z.string().nullable().default(null),
});
export type FilaDeOrdenes = z.infer<typeof filaDeOrdenesSchema>;

export const estadoDeShopifySchema = z.object({
  shop: z.string(),
  shop_name: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  connected_at: z.string().nullable().default(null),
  last_sync_at: z.string().nullable().default(null),
  last_error: z.string().nullable().default(null),
});
export type EstadoDeShopify = z.infer<typeof estadoDeShopifySchema>;

export async function fetchOrdenesPorHora(params: {
  organizationId: string;
  from: DateKey;
  to: DateKey;
}): Promise<FilaDeOrdenes[]> {
  return selectRows(z.array(filaDeOrdenesSchema), (db) =>
    db
      .from(TABLES.ordersByHour)
      .select('date, hours, orders, sales, currency')
      .eq('organization_id', params.organizationId)
      .gte('date', params.from)
      .lte('date', params.to)
      .order('date', { ascending: true }),
  );
}

export async function fetchEstadoDeShopify(
  organizationId: string,
): Promise<EstadoDeShopify | null> {
  const filas = await selectRows(z.array(estadoDeShopifySchema), (db) =>
    db
      .from(TABLES.shopifyStatus)
      .select('shop, shop_name, currency, connected_at, last_sync_at, last_error')
      .eq('organization_id', organizationId),
  );
  return filas[0] ?? null;
}

const CLAVE = 'shopify';

export function useOrdenesPorHora(params: {
  organizationId: string | null;
  from: DateKey;
  to: DateKey;
}) {
  return useQuery({
    queryKey: [CLAVE, 'ordenes', params.organizationId ?? 'none', params.from, params.to],
    queryFn: () =>
      fetchOrdenesPorHora({
        organizationId: params.organizationId ?? '',
        from: params.from,
        to: params.to,
      }),
    enabled: params.organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useEstadoDeShopify(organizationId: string | null) {
  return useQuery({
    queryKey: [CLAVE, 'estado', organizationId ?? 'none'],
    queryFn: () => fetchEstadoDeShopify(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

/** El servidor dice por qué no se pudo conectar: ese texto es el que se enseña. */
async function llamar(nombre: string, argumentos: Record<string, unknown>) {
  const { data, error } = await requireClient().rpc(nombre, argumentos);
  if (error !== null) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

export function useMutacionesDeShopify(organizationId: string) {
  const queryClient = useQueryClient();
  const refrescar = () => void queryClient.invalidateQueries({ queryKey: [CLAVE] });
  return {
    conectar: useMutation({
      mutationFn: (params: { shop: string; clientId: string; clientSecret: string }) =>
        llamar(RPC.connectShopify, {
          p_organization_id: organizationId,
          p_shop: params.shop,
          p_client_id: params.clientId,
          p_client_secret: params.clientSecret,
        }),
      onSuccess: refrescar,
    }),
    desconectar: useMutation({
      mutationFn: () => llamar(RPC.disconnectShopify, { p_organization_id: organizationId }),
      onSuccess: refrescar,
    }),
  };
}

/** Una casilla del mapa: la media por día de ese día de la semana, a esa hora. */
export type Celda = {
  /** 0 = domingo … 6 = sábado, como `Date.getUTCDay`. */
  diaSemana: number;
  hora: number;
  ordenes: number;
  ventas: number;
  personas: number;
  /** Cuántos días de ese día de la semana tienen datos: de cuántos sale la media. */
  dias: number;
};

export type AnalisisDeOrdenes = {
  /** Días del periodo con datos de Shopify. */
  dias: number;
  totalOrdenes: number;
  totalVentas: number;
  moneda: string | null;
  /** Las columnas del mapa: de la primera a la última hora con órdenes o con alguien. */
  horas: number[];
  celdas: Map<string, Celda>;
  /** Media de órdenes de cada día de la semana, el día entero. */
  porDia: Map<number, number>;
  /** Las tres casillas con más órdenes de media. */
  puntas: Celda[];
  diaFuerte: { diaSemana: number; ordenes: number } | null;
  /** Las tres con más órdenes por persona en turno: donde más falta gente. */
  masPorPersona: Celda[];
  /** Con órdenes y nadie en turno. */
  sinNadie: Celda[];
  /** Con gente y casi sin órdenes (menos de media orden por día). */
  conPocas: Celda[];
};

/** Menos de media orden por día en esa hora es «casi ninguna». */
const CASI_NINGUNA = 0.5;

export const claveDeCelda = (diaSemana: number, hora: number) => `${diaSemana}-${hora}`;

const diaDeLaSemana = (dia: DateKey) => new Date(`${dia}T00:00:00Z`).getUTCDay();

const reloj = (zona: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/** Cada día y hora en que el minuto 30 cae dentro del turno. */
function horasDelTurno(
  turno: Pick<ShiftRow, 'starts_at' | 'ends_at'>,
  formato: Intl.DateTimeFormat,
): { dia: DateKey; hora: number }[] {
  const desde = Date.parse(turno.starts_at);
  const hasta = Date.parse(turno.ends_at);
  const media = 30 * 60_000;
  const horas: { dia: DateKey; hora: number }[] = [];
  // Cada media hora de UTC: en zonas de hora entera y de media hora, una de cada dos es el
  // minuto 30 local.
  for (let t = Math.ceil(desde / media) * media; t < hasta; t += media) {
    const partes = formato.formatToParts(new Date(t));
    const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
    if (valor('minute') !== '30') continue;
    horas.push({
      dia: `${valor('year')}-${valor('month')}-${valor('day')}`,
      hora: Number(valor('hour')),
    });
  }
  return horas;
}

export function analizarOrdenes(
  filas: readonly FilaDeOrdenes[],
  turnos: readonly Pick<
    ShiftRow,
    'employee_id' | 'starts_at' | 'ends_at' | 'status' | 'publication_version'
  >[],
  timezone: string,
): AnalisisDeOrdenes {
  const diasConDatos = new Set(filas.map((fila) => fila.date));
  const diasPorSemana = new Map<number, number>();
  for (const dia of diasConDatos) {
    const semana = diaDeLaSemana(dia);
    diasPorSemana.set(semana, (diasPorSemana.get(semana) ?? 0) + 1);
  }

  const sumas = new Map<string, { ordenes: number; ventas: number; personas: number }>();
  const sumar = (
    semana: number,
    hora: number,
    que: 'ordenes' | 'ventas' | 'personas',
    n: number,
  ) => {
    const clave = claveDeCelda(semana, hora);
    const actual = sumas.get(clave) ?? { ordenes: 0, ventas: 0, personas: 0 };
    actual[que] += n;
    sumas.set(clave, actual);
  };

  let totalOrdenes = 0;
  let totalVentas = 0;
  for (const fila of filas) {
    const semana = diaDeLaSemana(fila.date);
    for (const [hora, valor] of Object.entries(fila.hours)) {
      sumar(semana, Number(hora), 'ordenes', valor.orders);
      sumar(semana, Number(hora), 'ventas', valor.sales);
      totalOrdenes += valor.orders;
      totalVentas += valor.sales;
    }
  }

  // Una persona cuenta una vez por hora, aunque tenga dos turnos que se toquen.
  const formato = reloj(timezone);
  const enTurno = new Set<string>();
  for (const turno of turnos) {
    if (!turnoEnPie(turno) || turno.employee_id === null) continue;
    for (const { dia, hora } of horasDelTurno(turno, formato)) {
      if (!diasConDatos.has(dia)) continue;
      const clave = `${dia}|${hora}|${turno.employee_id}`;
      if (enTurno.has(clave)) continue;
      enTurno.add(clave);
      sumar(diaDeLaSemana(dia), hora, 'personas', 1);
    }
  }

  const celdas = new Map<string, Celda>();
  for (const [clave, suma] of sumas) {
    const [semana, hora] = clave.split('-').map(Number) as [number, number];
    const dias = diasPorSemana.get(semana) ?? 0;
    if (dias === 0) continue;
    celdas.set(clave, {
      diaSemana: semana,
      hora,
      ordenes: suma.ordenes / dias,
      ventas: suma.ventas / dias,
      personas: suma.personas / dias,
      dias,
    });
  }

  const conAlgo = [...celdas.values()].filter((celda) => celda.ordenes > 0 || celda.personas > 0);
  const horasUsadas = conAlgo.map((celda) => celda.hora);
  const horas =
    horasUsadas.length === 0
      ? []
      : Array.from(
          { length: Math.max(...horasUsadas) - Math.min(...horasUsadas) + 1 },
          (_, i) => Math.min(...horasUsadas) + i,
        );

  const porDia = new Map<number, number>();
  for (const celda of celdas.values()) {
    porDia.set(celda.diaSemana, (porDia.get(celda.diaSemana) ?? 0) + celda.ordenes);
  }
  const diaFuerte = [...porDia.entries()].reduce<{ diaSemana: number; ordenes: number } | null>(
    (mejor, [diaSemana, ordenes]) =>
      ordenes > 0 && (mejor === null || ordenes > mejor.ordenes) ? { diaSemana, ordenes } : mejor,
    null,
  );

  const lista = [...celdas.values()];
  const porOrdenes = (a: Celda, b: Celda) => b.ordenes - a.ordenes || a.diaSemana - b.diaSemana;
  const moneda = filas.find((fila) => fila.currency !== null)?.currency ?? null;

  return {
    dias: diasConDatos.size,
    totalOrdenes,
    totalVentas: Math.round(totalVentas * 100) / 100,
    moneda,
    horas,
    celdas,
    porDia,
    puntas: lista
      .filter((celda) => celda.ordenes > 0)
      .sort(porOrdenes)
      .slice(0, 3),
    diaFuerte,
    masPorPersona: lista
      .filter((celda) => celda.personas > 0 && celda.ordenes >= CASI_NINGUNA)
      .sort((a, b) => b.ordenes / b.personas - a.ordenes / a.personas)
      .slice(0, 3),
    sinNadie: lista
      .filter((celda) => celda.personas === 0 && celda.ordenes >= CASI_NINGUNA)
      .sort(porOrdenes)
      .slice(0, 3),
    conPocas: lista
      .filter((celda) => celda.personas >= 1 && celda.ordenes < CASI_NINGUNA)
      .sort((a, b) => b.personas - a.personas || a.ordenes - b.ordenes)
      .slice(0, 3),
  };
}
