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
  /** Media de personas DISTINTAS en turno cada día de la semana (no persona-horas). */
  personasPorDia: Map<number, number>;
  /** Horas medias de un turno del periodo: para pasar horas de equipo a personas. */
  turnoMedio: number;
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
  // Quién vino cada fecha (una vez por persona y día) y cuánto duran los turnos: con eso el
  // plan de personal habla en personas por día, no solo en horas.
  const genteDelDia = new Set<string>();
  let horasDeTurnos = 0;
  let turnosContados = 0;
  for (const turno of turnos) {
    if (!turnoEnPie(turno) || turno.employee_id === null) continue;
    let cuenta = false;
    for (const { dia, hora } of horasDelTurno(turno, formato)) {
      if (!diasConDatos.has(dia)) continue;
      cuenta = true;
      genteDelDia.add(`${dia}|${turno.employee_id}`);
      const clave = `${dia}|${hora}|${turno.employee_id}`;
      if (enTurno.has(clave)) continue;
      enTurno.add(clave);
      sumar(diaDeLaSemana(dia), hora, 'personas', 1);
    }
    if (cuenta) {
      horasDeTurnos += (Date.parse(turno.ends_at) - Date.parse(turno.starts_at)) / 3_600_000;
      turnosContados += 1;
    }
  }
  const personasPorDia = new Map<number, number>();
  for (const clave of genteDelDia) {
    const semana = diaDeLaSemana(clave.split('|')[0] as DateKey);
    personasPorDia.set(semana, (personasPorDia.get(semana) ?? 0) + 1);
  }
  for (const [semana, n] of personasPorDia) {
    personasPorDia.set(semana, n / (diasPorSemana.get(semana) ?? 1));
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
    personasPorDia,
    turnoMedio: turnosContados === 0 ? 0 : horasDeTurnos / turnosContados,
  };
}

/**
 * ¿CUÁNTA GENTE PONER CADA DÍA? (Andree, 13-nov: «cuántas personas deberían estar por día
 * según la gente contratada, como para tener una idea»).
 *
 * NO PIDE CONTRATAR: REPARTE LO QUE YA HAY. Toma las horas de equipo que se ponen de media
 * cada semana y las reparte entre los días según las órdenes de cada uno. Así la suma de la
 * semana es la misma y lo único que cambia es dónde caen. Con un mínimo: cada hora que la
 * tienda tiene gente o vende, una persona —una tienda no se queda sola porque una hora venda
 * poco—, y lo que ese mínimo añade a un día se le quita a los que van por encima.
 *
 * PERSONAS = HORAS ÷ TURNO MEDIO, redondeado y con al menos una el día que abre: «3 personas»
 * se entiende mejor que «22 h», y el turno medio sale de los turnos del propio periodo.
 *
 * ES UNA ORIENTACIÓN. Solo ve órdenes de Shopify: no ve la ceremonia que tarda media hora, la
 * reposición ni la limpieza. Por eso la pantalla lo dice y no lo llama «lo correcto».
 */
export type PlanDelDia = {
  diaSemana: number;
  /** Órdenes de media en el día. */
  ordenes: number;
  horasAhora: number;
  personasAhora: number;
  horasSugeridas: number;
  personasSugeridas: number;
  /** Las sugeridas llegan a todo el equipo activo: no se puede poner más gente de la que hay. */
  todoElEquipo: boolean;
  /** Las horas fuertes del día, de la primera a la última: dónde reforzar. */
  refuerzo: { desde: number; hasta: number } | null;
};

export type PlanDePersonal = {
  /** Horas de equipo de media por semana: lo que se reparte. */
  horasSemana: number;
  turnoMedio: number;
  /** Personas activas en el equipo. */
  equipo: number;
  dias: PlanDelDia[];
};

/** Una hora es «fuerte» si llega al 60 % de la hora punta de su día. */
const FUERTE = 0.6;

export function planDePersonal(
  analisis: AnalisisDeOrdenes,
  equipo: number,
): PlanDePersonal | null {
  const diasDelPlan = [...new Set([...analisis.celdas.values()].map((c) => c.diaSemana))].sort(
    (a, b) => a - b,
  );
  const celdasDe = (dia: number) =>
    analisis.horas
      .map((hora) => analisis.celdas.get(claveDeCelda(dia, hora)))
      .filter((celda): celda is Celda => celda !== undefined);

  const horasAhora = new Map(
    diasDelPlan.map((dia) => [dia, celdasDe(dia).reduce((s, c) => s + c.personas, 0)]),
  );
  const horasSemana = [...horasAhora.values()].reduce((s, n) => s + n, 0);
  const ordenesSemana = diasDelPlan.reduce((s, dia) => s + (analisis.porDia.get(dia) ?? 0), 0);
  if (horasSemana <= 0 || ordenesSemana <= 0 || analisis.turnoMedio <= 0) return null;

  // Una persona por cada hora con gente o con órdenes.
  const minimo = new Map(
    diasDelPlan.map((dia) => [
      dia,
      celdasDe(dia).filter((c) => c.personas > 0 || c.ordenes > 0).length,
    ]),
  );
  const sugeridas = new Map(
    diasDelPlan.map((dia) => [
      dia,
      Math.max(
        minimo.get(dia) ?? 0,
        (horasSemana * (analisis.porDia.get(dia) ?? 0)) / ordenesSemana,
      ),
    ]),
  );
  // Lo que el mínimo añadió se quita, en proporción, a los días que van por encima de él.
  const exceso = [...sugeridas.values()].reduce((s, n) => s + n, 0) - horasSemana;
  const holgura = diasDelPlan.map((dia) => (sugeridas.get(dia) ?? 0) - (minimo.get(dia) ?? 0));
  const holguraTotal = holgura.reduce((s, n) => s + n, 0);
  if (exceso > 0 && holguraTotal > 0) {
    diasDelPlan.forEach((dia, i) => {
      const quitar = Math.min(holgura[i] ?? 0, (exceso * (holgura[i] ?? 0)) / holguraTotal);
      sugeridas.set(dia, (sugeridas.get(dia) ?? 0) - quitar);
    });
  }

  const aPersonas = (horas: number) =>
    horas <= 0 ? 0 : Math.max(1, Math.round(horas / analisis.turnoMedio));

  return {
    horasSemana,
    turnoMedio: analisis.turnoMedio,
    equipo,
    dias: diasDelPlan.map((dia) => {
      const celdas = celdasDe(dia);
      // EL TRAMO SEGUIDO ALREDEDOR DE LA PUNTA, no de la primera a la última hora fuerte: con
      // dos horas fuertes separadas, «de 12:00 a 21:00» decía «todo el día» y no ayudaba.
      const punta = celdas.reduce<Celda | null>(
        (mejor, c) => (mejor === null || c.ordenes > mejor.ordenes ? c : mejor),
        null,
      );
      const umbral = Math.max(CASI_NINGUNA, (punta?.ordenes ?? 0) * FUERTE);
      const esFuerte = (hora: number) =>
        (analisis.celdas.get(claveDeCelda(dia, hora))?.ordenes ?? 0) >= umbral;
      const fuertes: number[] = [];
      if (punta !== null && punta.ordenes >= umbral) {
        let desde = punta.hora;
        let hasta = punta.hora;
        while (esFuerte(desde - 1)) desde -= 1;
        while (esFuerte(hasta + 1)) hasta += 1;
        fuertes.push(desde, hasta);
      }
      const horasSug = sugeridas.get(dia) ?? 0;
      // «Según la gente contratada» (Andree): nunca más personas que el equipo activo. Con
      // datos reales el domingo pedía 5 con un equipo de 4; ahí se dice «todo el equipo».
      const personas = aPersonas(horasSug);
      const tope = equipo > 0 && personas >= equipo;
      return {
        diaSemana: dia,
        ordenes: analisis.porDia.get(dia) ?? 0,
        horasAhora: horasAhora.get(dia) ?? 0,
        personasAhora: analisis.personasPorDia.get(dia) ?? 0,
        horasSugeridas: horasSug,
        personasSugeridas: tope ? equipo : personas,
        todoElEquipo: tope,
        refuerzo:
          fuertes.length === 0
            ? null
            : { desde: Math.min(...fuertes), hasta: Math.max(...fuertes) + 1 },
      };
    }),
  };
}
