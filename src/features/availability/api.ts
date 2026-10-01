import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  ADMIN_LIST_STALE_MS,
  requireClient,
  selectRows,
  toAdminError,
} from '@/hooks/use-admin-query';
import { RPC, TABLES } from '@/lib/firebase/tables';

import {
  disponibilidadSchema,
  type Disponibilidad,
  type TipoDeDisponibilidad,
} from './disponibilidad';

/**
 * Leer y escribir la disponibilidad (1-oct). Se escribe SOLO por el servidor
 * (`functions/src/disponibilidad.ts`); aquí se pide y se refresca.
 *
 * SE REFRESCA EN TODAS PARTES A LA VEZ: Equipo → Disponibilidad, el Horario —que la enseña
 * en la rejilla— y el celular de la persona. Cambiarla en un sitio y no verla en otro es el
 * fallo que Andree ya encontró una vez con las salidas.
 */

const ordenar = (filas: Disponibilidad[]) =>
  [...filas].sort(
    (a, b) =>
      (a.kind === 'weekly' ? 0 : 1) - (b.kind === 'weekly' ? 0 : 1) ||
      (a.weekday ?? 0) - (b.weekday ?? 0) ||
      String(a.date).localeCompare(String(b.date)),
  );

/** Toda la de la empresa: lo que ve quien gestiona. */
export async function fetchDisponibilidad(organizationId: string): Promise<Disponibilidad[]> {
  const filas = await selectRows(z.array(disponibilidadSchema), (db) =>
    db.from(TABLES.availability).select('*').eq('organization_id', organizationId),
  );
  return ordenar(filas);
}

/** La suya, en su celular. */
export async function fetchMiDisponibilidad(params: {
  organizationId: string;
  employeeId: string;
}): Promise<Disponibilidad[]> {
  const filas = await selectRows(z.array(disponibilidadSchema), (db) =>
    db
      .from(TABLES.availability)
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
  return ordenar(filas);
}

export const CLAVE_DE_DISPONIBILIDAD = 'disponibilidad';

export function useDisponibilidad(organizationId: string | null) {
  return useQuery({
    queryKey: [CLAVE_DE_DISPONIBILIDAD, 'empresa', organizationId ?? 'none'],
    queryFn: () => fetchDisponibilidad(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useMiDisponibilidad(params: { organizationId: string; employeeId: string }) {
  return useQuery({
    queryKey: [CLAVE_DE_DISPONIBILIDAD, 'mia', params.employeeId],
    queryFn: () => fetchMiDisponibilidad(params),
  });
}

/** El servidor dijo que no y por qué (`HORAS`, `NOTA`): para decir qué arreglar. */
export class DisponibilidadRechazada extends Error {
  constructor(
    readonly motivo: string,
    message: string,
  ) {
    super(message);
    this.name = 'DisponibilidadRechazada';
  }
}

async function llamar(nombre: string, argumentos: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await requireClient().rpc(nombre, argumentos);
    if (error !== null) {
      const detalles = ((error as { details?: unknown }).details ?? {}) as Record<string, unknown>;
      if (typeof detalles.motivo === 'string') {
        throw new DisponibilidadRechazada(detalles.motivo, error.message);
      }
      throw toAdminError(error);
    }
    return data;
  } catch (error) {
    if (error instanceof DisponibilidadRechazada) throw error;
    throw toAdminError(error);
  }
}

export type DisponibilidadNueva = {
  id: string | null;
  organizationId: string;
  /** `null` desde el celular: el servidor sabe quién es. */
  employeeId: string | null;
  kind: 'weekly' | 'date';
  weekday: number | null;
  date: string | null;
  type: TipoDeDisponibilidad;
  from: string | null;
  to: string | null;
  note: string | null;
};

export function guardarDisponibilidad(fila: DisponibilidadNueva) {
  return llamar(RPC.saveAvailability, {
    p_id: fila.id,
    p_organization_id: fila.organizationId,
    p_employee_id: fila.employeeId,
    p_kind: fila.kind,
    p_weekday: fila.weekday,
    p_date: fila.date,
    p_type: fila.type,
    p_from: fila.from,
    p_to: fila.to,
    p_note: fila.note,
  });
}

/** Todo lo que la enseña: Equipo, Horario y el celular. */
export function refrescarDisponibilidad(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: [CLAVE_DE_DISPONIBILIDAD] });
  void queryClient.invalidateQueries({ queryKey: ['schedule'] });
}

export function useMutacionesDeDisponibilidad() {
  const queryClient = useQueryClient();
  const alAcabar = () => refrescarDisponibilidad(queryClient);
  return {
    guardar: useMutation({ mutationFn: guardarDisponibilidad, onSuccess: alAcabar }),
    quitar: useMutation({
      mutationFn: (id: string) => llamar(RPC.deleteAvailability, { p_id: id }),
      onSuccess: alAcabar,
    }),
    marcarVistas: useMutation({
      mutationFn: (ids: string[]) => llamar(RPC.markAvailabilitySeen, { p_ids: ids }),
      onSuccess: alAcabar,
    }),
  };
}
