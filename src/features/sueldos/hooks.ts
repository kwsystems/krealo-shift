import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { periodoDePago, type PeriodoDePago } from '@/domain/periodo-de-pago';
import { sueldoEstimado, type SueldoEstimado } from '@/domain/sueldo-estimado';
import { fetchMisJornadas, fetchMisTurnos, fetchRelojDesdeDeMisSedes } from '@/features/portal/api';
import { addDaysToKey, dateKeyOf, localDateTimeToInstant } from '@/features/schedules/week';
import { fetchMisHorasDebidas } from '@/features/timesheets/horas-debidas';
import { useMisJustificaciones } from '@/features/timesheets/justificaciones';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';

import {
  CLAVE_DE_SUELDOS,
  fetchExtrasDeLaPersona,
  fetchSueldo,
  guardarSueldo,
  type Sueldo,
} from './api';
import { hechosDelMes, type HechosDelMes } from './hechos-del-mes';

export function useSueldo(organizationId: string | null, employeeId: string | null) {
  return useQuery({
    queryKey: [CLAVE_DE_SUELDOS, employeeId ?? 'none'],
    queryFn: () =>
      fetchSueldo({ organizationId: organizationId ?? '', employeeId: employeeId ?? '' }),
    enabled: organizationId !== null && employeeId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useGuardarSueldo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: guardarSueldo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [CLAVE_DE_SUELDOS] });
    },
  });
}

export type SueldoDelMes =
  | { estado: 'cargando' }
  | { estado: 'sinSueldo' }
  | { estado: 'error'; reintentar: () => void }
  | {
      estado: 'listo';
      sueldo: Sueldo;
      /** El periodo de pago que se cuenta: del 1 al último día, que es cuando se paga. */
      mes: PeriodoDePago;
      hechos: HechosDelMes;
      cuenta: SueldoEstimado;
    };

/**
 * EL SUELDO APROXIMADO DE ESTE MES DE UNA PERSONA (13-oct), el mismo en su celular y en su
 * ficha de Equipo: los mismos datos —pedidos por persona, que es lo que ella misma puede
 * leer— y la misma cuenta (`sueldo-estimado.ts`).
 *
 * Las jornadas y las horas que debe cuelgan de `timesheet`: corregir algo en Horas lo
 * refresca aquí también (`refrescarVistasDeHoras`). Lo que se dijo de las faltas, de
 * `faltas`, como en todas las pantallas.
 */
export function useSueldoDelMes(params: {
  organizationId: string | null;
  employeeId: string | null;
  timezone: string;
  nowISO: string;
  ingreso?: string | null;
  baja?: string | null;
  /** 0 = el mes en curso; 1 = el que ya se pagó, para compararlo con la boleta. */
  mesesAtras?: number;
}): SueldoDelMes {
  const { organizationId, employeeId, timezone, nowISO } = params;
  const mes = periodoDePago(dateKeyOf(nowISO, timezone), params.mesesAtras ?? 0);
  const sueldo = useSueldo(organizationId, employeeId);
  const resoluciones = useMisJustificaciones({
    organizationId: organizationId ?? '',
    employeeId: employeeId ?? '',
  });
  const datos = useQuery({
    queryKey: ['timesheet', 'sueldo-del-mes', employeeId ?? 'none', mes.desde],
    queryFn: async () => {
      const org = organizationId ?? '';
      const emp = employeeId ?? '';
      const fromISO =
        localDateTimeToInstant(mes.desde, '00:00', timezone) ?? `${mes.desde}T00:00:00Z`;
      const siguiente = addDaysToKey(mes.hasta, 1);
      const toISO =
        localDateTimeToInstant(siguiente, '00:00', timezone) ?? `${siguiente}T00:00:00Z`;
      const [turnos, jornadas, aprobadas, debidas] = await Promise.all([
        fetchMisTurnos({ organizationId: org, employeeId: emp, fromISO, toISO }),
        fetchMisJornadas({ organizationId: org, employeeId: emp, fromISO, toISO }),
        fetchExtrasDeLaPersona({
          organizationId: org,
          employeeId: emp,
          desde: mes.desde,
          hasta: mes.hasta,
        }),
        fetchMisHorasDebidas({ organizationId: org, employeeId: emp }),
      ]);
      const sedes = [...new Set(turnos.map((turno) => turno.location_id))];
      const relojDesde = await fetchRelojDesdeDeMisSedes(sedes);
      return { turnos, jornadas, aprobadas, debidas, relojDesde };
    },
    // Sin sueldo guardado no hay nada que calcular: no se pide lo demás.
    enabled:
      organizationId !== null &&
      employeeId !== null &&
      sueldo.data !== null &&
      sueldo.data !== undefined,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  if (sueldo.isError || datos.isError || resoluciones.isError) {
    return {
      estado: 'error',
      reintentar: () => {
        void sueldo.refetch();
        void datos.refetch();
        void resoluciones.refetch();
      },
    };
  }
  if (sueldo.data === null) return { estado: 'sinSueldo' };
  if (sueldo.data === undefined || datos.data === undefined || resoluciones.data === undefined) {
    return { estado: 'cargando' };
  }

  const hechos = hechosDelMes({
    employeeId: employeeId ?? '',
    mes,
    turnos: datos.data.turnos.filter((turno) => turno.status === 'published'),
    jornadas: datos.data.jornadas,
    resoluciones: resoluciones.data,
    relojDesde: (sede) => datos.data.relojDesde.get(sede),
    aprobadas: datos.data.aprobadas,
    debidas: datos.data.debidas,
    timezone,
    nowISO,
  });
  const cuenta = sueldoEstimado({
    datos: {
      sueldoMensual: sueldo.data.monthly_salary,
      asignacionFamiliar: sueldo.data.family_allowance,
      pension: sueldo.data.pension,
    },
    mes,
    ingreso: params.ingreso ?? null,
    baja: params.baja ?? null,
    faltas: hechos.faltas,
    extrasPorDia: hechos.extrasPorDia,
    feriadosTrabajados: hechos.feriadosTrabajados.length,
    minutosQueDebe: hechos.minutosQueDebe,
  });
  return { estado: 'listo', sueldo: sueldo.data, mes, hechos, cuenta };
}
