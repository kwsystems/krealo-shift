import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  MOTIVOS_JUSTIFICADOS,
  MOTIVOS_SIN_JUSTIFICAR,
  TIPOS_DE_FALTA,
  type MotivoDeFalta,
  type TipoDeFalta,
} from '@/domain/motivos-de-falta';
import type { MotivoDeCumplido } from '@/domain/motivos-de-cumplido';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';
import {
  ADMIN_LIST_STALE_MS,
  requireClient,
  selectRows,
  toAdminError,
} from '@/hooks/use-admin-query';
import { docId } from '@/lib/firebase/ids';
import { RPC, TABLES } from '@/lib/firebase/tables';

/**
 * POR QUÉ FALTÓ (2-oct): leer y guardar lo que quien gestiona dice de cada falta. Lo
 * escribe SOLO el servidor (`functions/src/faltas.ts`); aquí se pide y se refresca.
 *
 * UNA CLAVE PARA TODAS LAS PANTALLAS —`['faltas', …]`—, y por eso se ve en todas a la vez:
 * se justifica en Horas y la tarjeta de Horario, la fila de Equipo, Reportes y el bono
 * cambian sin recargar. Es el fallo que Andree ya encontró una vez con las salidas.
 */

const MOTIVOS = [...new Set([...MOTIVOS_JUSTIFICADOS, ...MOTIVOS_SIN_JUSTIFICAR])] as [
  MotivoDeFalta,
  ...MotivoDeFalta[],
];

export const resolucionSchema = z.object({
  id: docId(),
  organization_id: docId(),
  location_id: docId(),
  employee_id: docId(),
  shift_id: docId(),
  work_date: z.string(),
  kind: z.enum(TIPOS_DE_FALTA),
  reason: z.enum(MOTIVOS),
  note: z.string().nullable().default(null),
  decided_at: z.string().nullable().default(null),
});

export type ResolucionDeFalta = z.infer<typeof resolucionSchema>;

export const CLAVE_DE_FALTAS = 'faltas';

/** Las de una sede: lo que ve quien gestiona. Pocas filas: se filtran por fecha aquí. */
export async function fetchJustificaciones(params: {
  organizationId: string;
  locationId: string;
}): Promise<ResolucionDeFalta[]> {
  return selectRows(z.array(resolucionSchema), (db) =>
    db
      .from(TABLES.absenceResolutions)
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId),
  );
}

/** Las suyas, en su celular. */
export async function fetchMisJustificaciones(params: {
  organizationId: string;
  employeeId: string;
}): Promise<ResolucionDeFalta[]> {
  return selectRows(z.array(resolucionSchema), (db) =>
    db
      .from(TABLES.absenceResolutions)
      .select('*')
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId),
  );
}

export function useJustificaciones(organizationId: string | null, locationId: string | null) {
  return useQuery({
    queryKey: [CLAVE_DE_FALTAS, 'sede', locationId ?? 'none'],
    queryFn: () =>
      fetchJustificaciones({ organizationId: organizationId ?? '', locationId: locationId ?? '' }),
    enabled: organizationId !== null && locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useMisJustificaciones(params: { organizationId: string; employeeId: string }) {
  return useQuery({
    queryKey: [CLAVE_DE_FALTAS, 'mias', params.employeeId],
    queryFn: () => fetchMisJustificaciones(params),
  });
}

/** El servidor dijo que no y por qué (`MOTIVO`, `NOTA`, `NO_TERMINO`). */
export class JustificacionRechazada extends Error {
  constructor(
    readonly motivo: string,
    message: string,
  ) {
    super(message);
    this.name = 'JustificacionRechazada';
  }
}

async function llamar(nombre: string, argumentos: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await requireClient().rpc(nombre, argumentos);
    if (error !== null) {
      const detalles = ((error as { details?: unknown }).details ?? {}) as Record<string, unknown>;
      if (typeof detalles.motivo === 'string') {
        throw new JustificacionRechazada(detalles.motivo, error.message);
      }
      throw toAdminError(error);
    }
    return data;
  } catch (error) {
    if (error instanceof JustificacionRechazada) throw error;
    throw toAdminError(error);
  }
}

export function useMutacionesDeFaltas() {
  const queryClient = useQueryClient();
  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: [CLAVE_DE_FALTAS] });
  };
  return {
    justificar: useMutation({
      mutationFn: (params: {
        shiftId: string;
        kind: TipoDeFalta;
        reason: MotivoDeFalta;
        note: string | null;
      }) =>
        llamar(RPC.resolveAbsence, {
          p_shift_id: params.shiftId,
          p_kind: params.kind,
          p_reason: params.reason,
          p_note: params.note,
        }),
      onSuccess: refrescar,
    }),
    quitar: useMutation({
      mutationFn: (shiftId: string) => llamar(RPC.clearAbsenceResolution, { p_shift_id: shiftId }),
      onSuccess: refrescar,
    }),
    /*
     * CUMPLIÓ SU HORARIO, POR UN MOTIVO ESPECIAL (4-oct): crea su jornada a la hora del turno.
     * Cambia horas, así que refresca TODAS las vistas que las enseñan, no solo las faltas:
     * Horas, Horario, Inicio, Reportes, Equipo. Ver `creditShiftAsWorked`.
     */
    darPorCumplido: useMutation({
      mutationFn: (params: { shiftId: string; reason: MotivoDeCumplido; note: string | null }) =>
        llamar(RPC.creditShiftAsWorked, {
          p_shift_id: params.shiftId,
          p_reason: params.reason,
          p_note: params.note,
        }),
      onSuccess: () => {
        refrescar();
        refrescarVistasDeHoras(queryClient);
      },
    }),
    deshacerCumplido: useMutation({
      mutationFn: (shiftId: string) => llamar(RPC.undoShiftCredit, { p_shift_id: shiftId }),
      onSuccess: () => {
        refrescar();
        refrescarVistasDeHoras(queryClient);
      },
    }),
  };
}
