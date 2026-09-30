import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { ADMIN_LIST_STALE_MS, requireClient, toAdminError } from '@/hooks/use-admin-query';
import { RPC } from '@/lib/firebase/tables';

/**
 * LAS CORRECCIONES DE HORA DEL PERIODO, para la casilla de Reportes (30-sep).
 *
 * La lista de la semana de prueba pide «cuántas correcciones hubo y de qué tipo», y la app
 * no lo contaba: cada una es un fichaje que el reloj no recogió bien. El servidor
 * (`functions/src/correcciones.ts`) devuelve una fila por corrección, contada en el día
 * que corrige; aquí se resumen, filtradas por persona igual que el resto de Reportes.
 */

export const TIPOS_DE_CORRECCION = [
  'fichaje_anadido',
  'hora_corregida',
  'salida_a_pausa',
  'solicitud_aprobada',
  'segun_horario',
] as const;
export type TipoDeCorreccion = (typeof TIPOS_DE_CORRECCION)[number];

const filaSchema = z.object({
  // Un tipo nuevo del servidor no puede tumbar la casilla entera: cuenta como corrección.
  tipo: z.enum(TIPOS_DE_CORRECCION).catch('hora_corregida'),
  employee_id: z.string().nullable(),
  work_date: z.string(),
  author_name: z.string().nullable(),
});
export type FilaDeCorreccion = z.infer<typeof filaSchema>;

const respuestaSchema = z.object({ filas: z.array(filaSchema) });

export async function fetchCorrecciones(params: {
  locationId: string;
  from: string;
  to: string;
}): Promise<FilaDeCorreccion[]> {
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.viewCorrectionsSummary, {
      p_location_id: params.locationId,
      p_from: params.from,
      p_to: params.to,
    });
    if (error !== null) throw toAdminError(error);
    const leido = respuestaSchema.safeParse(data);
    // El servidor respondió con otra forma: no se inventa un resultado (§20).
    if (!leido.success) throw toAdminError({ code: 'shape', message: 'UNEXPECTED_SHAPE' });
    return leido.data.filas;
  } catch (error) {
    throw toAdminError(error);
  }
}

export function useCorrecciones(params: { locationId: string | null; from: string; to: string }) {
  return useQuery({
    queryKey: ['reports', 'correcciones', params.locationId ?? 'none', params.from, params.to],
    queryFn: () =>
      fetchCorrecciones({ locationId: params.locationId ?? '', from: params.from, to: params.to }),
    enabled: params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export type ResumenDeCorrecciones = {
  /** Las correcciones de verdad: sin lo registrado desde el horario. */
  total: number;
  porTipo: Readonly<Record<Exclude<TipoDeCorreccion, 'segun_horario'>, number>>;
  /**
   * Las jornadas registradas desde el horario, APARTE. No son un fichaje que el reloj no
   * recogió —son días de antes del reloj—, y sumarlas convertiría la cifra en ruido.
   */
  segunHorario: number;
};

export function resumirCorrecciones(
  filas: readonly FilaDeCorreccion[],
  personaId: string | null,
): ResumenDeCorrecciones {
  const porTipo = {
    fichaje_anadido: 0,
    hora_corregida: 0,
    salida_a_pausa: 0,
    solicitud_aprobada: 0,
  };
  let segunHorario = 0;
  for (const fila of filas) {
    if (personaId !== null && fila.employee_id !== personaId) continue;
    if (fila.tipo === 'segun_horario') segunHorario += 1;
    else porTipo[fila.tipo] += 1;
  }
  const total = Object.values(porTipo).reduce((suma, n) => suma + n, 0);
  return { total, porTipo, segunHorario };
}
