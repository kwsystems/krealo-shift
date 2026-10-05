import type { TFunction } from 'i18next';
import { z } from 'zod';

import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import { requireClient, toAdminError } from '@/hooks/use-admin-query';
import { docId } from '@/lib/firebase/ids';
import { RPC } from '@/lib/firebase/tables';

/**
 * EL HORARIO DE TODA LA TIENDA EN EL CELULAR (5-oct). Andree: «que también puedan ver el
 * horario general donde salen todas, aparte de solo el de uno, para que sepan con quién
 * estarán en horario».
 *
 * Lo da el servidor (`viewStoreSchedule`): las reglas no dejan a una persona leer turnos
 * ajenos, y está bien. Llega lo publicado de sus sedes con nombre, puesto y horas; ni notas
 * ni borradores.
 *
 * DE AQUÍ SALEN LAS DOS COSAS QUE LO DICEN: la vista «Toda la tienda» y la línea «Con Bruno
 * y Carla» debajo de cada turno suyo. Las dos cuentan con la misma regla de «coincidir», así
 * que no pueden decir cosas distintas del mismo día.
 */
export const turnoDeLaTiendaSchema = z.object({
  id: docId(),
  employee_id: docId(),
  nombre: z.string(),
  puesto: z.string().nullable(),
  color: z.string().nullable(),
  location_id: docId(),
  starts_at: z.string(),
  ends_at: z.string(),
  por_confirmar: z.boolean(),
  es_mio: z.boolean(),
});

const respuestaSchema = z.object({
  turnos: z.array(turnoDeLaTiendaSchema),
  sedes: z.array(z.object({ id: docId(), name: z.string() })),
});

export type TurnoDeLaTienda = z.infer<typeof turnoDeLaTiendaSchema>;
export type HorarioDeLaTienda = z.infer<typeof respuestaSchema>;

export async function fetchHorarioDeLaTienda(params: {
  organizationId: string;
  fromISO: string;
  toISO: string;
}): Promise<HorarioDeLaTienda> {
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.viewStoreSchedule, {
      p_organization_id: params.organizationId,
      p_from: params.fromISO,
      p_to: params.toISO,
    });
    if (error !== null) throw toAdminError(error);
    const leido = respuestaSchema.safeParse(data);
    if (!leido.success) throw toAdminError({ code: 'shape', message: 'UNEXPECTED_SHAPE' });
    return leido.data;
  } catch (error) {
    throw toAdminError(error);
  }
}

/** Los turnos que EMPIEZAN ese día en la zona de la sede, como cuenta Horario. */
export function turnosDelDia(
  turnos: readonly TurnoDeLaTienda[],
  dia: DateKey,
  zona: string,
): TurnoDeLaTienda[] {
  return turnos.filter((turno) => dateKeyOf(turno.starts_at, zona) === dia);
}

type Franja = { location_id: string; starts_at: string; ends_at: string };

/**
 * CON QUIÉN COINCIDE en esos turnos suyos: misma sede y horas que se pisan, aunque sea un
 * rato. Por orden de entrada y sin repetir a nadie. Se mira contra TODOS los turnos de la
 * tienda y no solo los del mismo día: quien entró anoche a las 22:00 sigue ahí a las 05:00.
 */
export function companerosDe(
  misTurnos: readonly Franja[],
  tienda: readonly TurnoDeLaTienda[],
): string[] {
  const nombres: string[] = [];
  const ordenados = [...tienda].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (const otro of ordenados) {
    if (otro.es_mio || nombres.includes(otro.nombre)) continue;
    const coincide = misTurnos.some(
      (mio) =>
        mio.location_id === otro.location_id &&
        Date.parse(otro.starts_at) < Date.parse(mio.ends_at) &&
        Date.parse(otro.ends_at) > Date.parse(mio.starts_at),
    );
    if (coincide) nombres.push(otro.nombre);
  }
  return nombres;
}

/**
 * EL NOMBRE CORTO, para la línea «Con…»: el primero. Con dos que empiezan igual —dos Ana—
 * van completos esos dos, porque «Con Ana y Ana» no sirve para saber con quién.
 */
export function nombresCortos(nombres: readonly string[]): string[] {
  const primero = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? nombre;
  const veces = new Map<string, number>();
  for (const nombre of nombres) veces.set(primero(nombre), (veces.get(primero(nombre)) ?? 0) + 1);
  return nombres.map((nombre) =>
    (veces.get(primero(nombre)) ?? 0) > 1 ? nombre : primero(nombre),
  );
}

/** «Con Bruno», «Con Bruno y Carla», «Con Bruno, Carla, Diego y 2 más». */
export function textoDeCompaneros(t: TFunction, nombres: readonly string[]): string {
  const [a, b, c] = nombresCortos(nombres);
  if (a === undefined) return t('portal.withNobody');
  if (b === undefined) return t('portal.withOne', { a });
  if (c === undefined) return t('portal.withTwo', { a, b });
  if (nombres.length === 3) return t('portal.withThree', { a, b, c });
  return t('portal.withMore', { a, b, c, count: nombres.length - 3 });
}
