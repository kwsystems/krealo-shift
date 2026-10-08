import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import type { ShiftRow } from '@/features/schedules/api';
import { dateKeyOf } from '@/features/schedules/week';
import { ADMIN_LIST_STALE_MS, execute, selectRows } from '@/hooks/use-admin-query';
import { TABLES } from '@/lib/firebase/tables';
import { useSessionStore } from '@/stores/session-store';
import { minutosEscritos } from '@/domain/duracion-escrita';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';

/**
 * LAS HORAS EXTRA LAS DECIDE QUIEN GESTIONA, NO UN UMBRAL (30-sep).
 *
 * Hasta hoy, «horas extra» era todo lo que pasaba de 8 h netas al día. Andree, mirando
 * Reportes: «entrar 10 minutos antes es normal en un trabajo, hasta 15; eso no es hora
 * extra. Contarlo sí, pero no como extra. La hora extra es cuando yo veo que esa persona
 * marcó dos horas de más, y ahí el que gestiona dice: esto cuenta como extra». Y el
 * umbral fallaba también al revés: un turno PROGRAMADO de 10:00 a 22:00 son 11 h, y
 * salían 3 h de extra cada día a quien solo había cumplido su horario.
 *
 * AHORA:
 *   · Todo lo trabajado cuenta en las horas netas, como siempre.
 *   · Es EXTRA solo lo que alguien que gestiona la sede aprobó para esa persona ese día.
 *   · La app avisa de lo que podría serlo: el día en que alguien trabajó bastante más
 *     que su turno —una hora, por defecto, ajustable en Ajustes—. Unos minutos antes o
 *     después no avisan: son lo normal.
 *
 * Una aprobación es por persona y día, con su id sacado de esos tres datos: aprobar dos
 * veces cambia la misma fila, no suma dos.
 */

export const horaExtraSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  location_id: z.string(),
  work_date: z.string(),
  minutes: z.number().int().min(0),
  approved_by: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
});

export type HoraExtraAprobada = z.infer<typeof horaExtraSchema>;

/** La clave de un día de una persona: la misma en aprobaciones, resúmenes y turnos. */
export function claveDelDia(employeeId: string, workDate: string): string {
  return `${employeeId}_${workDate}`;
}

/**
 * Minutos aprobados por persona y día. Un día con 0 ESTÁ en el mapa: es «decidido, no es
 * extra», y `has` lo distingue de un día que nadie ha mirado.
 */
export function aprobadasPorDia(filas: readonly HoraExtraAprobada[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const fila of filas) {
    mapa.set(claveDelDia(fila.employee_id, fila.work_date), Math.max(0, fila.minutes));
  }
  return mapa;
}

/**
 * Lo planificado de cada persona cada día: la duración de sus turnos PUBLICADOS menos el
 * refrigerio planificado. Es contra lo que se mide si trabajó «de más»: un turno largo
 * que se cumple no es extra, por largo que sea.
 */
export function planificadoPorDia(turnos: readonly ShiftRow[], zona: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const turno of turnos) {
    if (turno.status !== 'published') continue;
    const brutos = Math.floor((Date.parse(turno.ends_at) - Date.parse(turno.starts_at)) / 60000);
    const netos = Math.max(0, brutos - Math.max(0, turno.planned_unpaid_break_minutes));
    const clave = claveDelDia(turno.employee_id, dateKeyOf(turno.starts_at, zona));
    mapa.set(clave, (mapa.get(clave) ?? 0) + netos);
  }
  return mapa;
}

/**
 * Cuánto trabajó de más sobre lo planificado ese día, en minutos (0 si no pasó). Sin
 * turno ese día, todo lo trabajado es «de más»: venir en tu día libre es justo el caso
 * que quien gestiona tiene que mirar.
 */
export function minutosDeMas(netos: number, planificados: number | undefined): number {
  return Math.max(0, netos - (planificados ?? 0));
}

/** ¿Merece el aviso de «posible hora extra»? Solo pasado el umbral de la sede. */
export function esPosibleHoraExtra(deMas: number, umbralMinutos: number): boolean {
  return deMas > 0 && deMas >= Math.max(1, umbralMinutos);
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

export function idDeLaAprobacion(params: {
  locationId: string;
  employeeId: string;
  workDate: string;
}): string {
  return `${params.locationId}_${params.employeeId}_${params.workDate}`;
}

export async function fetchHorasExtra(params: {
  organizationId: string;
  locationId: string;
  from: string;
  to: string;
}): Promise<HoraExtraAprobada[]> {
  return selectRows(z.array(horaExtraSchema), (db) =>
    db
      .from(TABLES.overtimeApprovals)
      .select('id, employee_id, location_id, work_date, minutes, approved_by, updated_at')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .gte('work_date', params.from)
      .lte('work_date', params.to)
      .order('work_date', { ascending: true }),
  );
}

export async function guardarHoraExtra(params: {
  organizationId: string;
  locationId: string;
  employeeId: string;
  workDate: string;
  /**
   * 0 ES UNA DECISIÓN (6-oct): «ese día no es hora extra». Antes 0 borraba la aprobación —o
   * no hacía nada si no había—, así que no quedaba decidido y la «posible hora extra» seguía
   * pidiendo una respuesta para siempre, en Horas y en Horario. Ahora se guarda como 0.
   */
  minutes: number;
}): Promise<void> {
  const id = idDeLaAprobacion(params);
  const quien = useSessionStore.getState().user?.userId ?? null;
  await execute((db) =>
    db.from(TABLES.overtimeApprovals).upsert(
      {
        id,
        organization_id: params.organizationId,
        location_id: params.locationId,
        employee_id: params.employeeId,
        work_date: params.workDate,
        minutes: Math.max(0, Math.round(params.minutes)),
        approved_by: quien,
        approved_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    ),
  );
}

export function useHorasExtra(params: {
  organizationId: string | null;
  locationId: string | null;
  from: string;
  to: string;
}) {
  const { organizationId, locationId, from, to } = params;
  return useQuery({
    queryKey: ['timesheet', 'horas-extra', locationId ?? 'none', from, to],
    queryFn: () =>
      fetchHorasExtra({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        from,
        to,
      }),
    enabled: organizationId !== null && locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useGuardarHoraExtra(params: {
  organizationId: string | null;
  locationId: string | null;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { employeeId: string; workDate: string; minutes: number }) =>
      guardarHoraExtra({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
        ...variables,
      }),
    // Horas, Reportes e Inicio leen lo mismo: se refrescan todas.
    onSuccess: () => refrescarVistasDeHoras(queryClient),
  });
}

/**
 * Lo que se escribe en el campo: «1:30», «90» o «1,5» son 90 minutos, «1» es una hora (8-oct:
 * antes era un minuto); «0» o vacío, nada de extra. `null` si no se entiende. Como esto decide
 * horas que se pagan, la hoja dice debajo cómo lo va a guardar.
 */
export function leerHorasYMinutos(texto: string): number | null {
  // Vacío es «nada de extra»; lo demás, el lector común (8-oct: «1» es una hora, no un minuto).
  return texto.trim() === '' ? 0 : minutosEscritos(texto);
}
