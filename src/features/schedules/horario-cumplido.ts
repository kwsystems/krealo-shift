import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { RPC, TABLES } from '@/lib/firebase/tables';

import { dateKeyOf, type DateKey } from './week';

/**
 * REGISTRAR COMO CUMPLIDO EL HORARIO DE ANTES DEL RELOJ (30-sep).
 *
 * El trabajo lo hace el servidor (`functions/src/horario-cumplido.ts`): escribe los
 * fichajes de cada turno publicado de los días elegidos y se niega a tocar un día desde
 * que la sede ficha con el reloj, un turno con marcas o un borrador. Aquí solo se pide,
 * primero en simulacro —para enseñar qué va a hacer— y luego de verdad.
 */

const saltadosSchema = z.object({
  sinPublicar: z.number().int(),
  noTermino: z.number().int(),
  conReloj: z.number().int(),
  yaTieneMarcas: z.number().int(),
  jornadaAbierta: z.number().int(),
});

export type Saltados = z.infer<typeof saltadosSchema>;

const simulacionSchema = z.object({
  relojDesde: z.string().nullable(),
  porDia: z.record(z.string(), z.object({ turnos: z.number().int(), minutos: z.number().int() })),
  saltados: saltadosSchema,
  turnos: z.number().int(),
  minutos: z.number().int(),
});

export type Simulacion = z.infer<typeof simulacionSchema>;

const resultadoSchema = z.object({
  relojDesde: z.string().nullable(),
  registrados: z.number().int(),
  minutos: z.number().int(),
  saltados: saltadosSchema,
});

export type ResultadoCumplido = z.infer<typeof resultadoSchema>;

async function llamar<T>(schema: z.ZodType<T>, args: Record<string, unknown>): Promise<T> {
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.registerScheduleAsWorked, args);
    if (error !== null) throw toAdminError(error);
    const leido = schema.safeParse(data);
    // El servidor respondió con otra forma: no se inventa un resultado (§20).
    if (!leido.success) throw toAdminError({ code: 'shape', message: 'UNEXPECTED_SHAPE' });
    return leido.data;
  } catch (error) {
    throw toAdminError(error);
  }
}

export function simularHorarioCumplido(params: {
  locationId: string;
  dias: DateKey[];
}): Promise<Simulacion> {
  return llamar(simulacionSchema, {
    p_location_id: params.locationId,
    p_dias: params.dias,
    p_simular: true,
  });
}

export function registrarHorarioCumplido(params: {
  locationId: string;
  dias: DateKey[];
}): Promise<ResultadoCumplido> {
  return llamar(resultadoSchema, { p_location_id: params.locationId, p_dias: params.dias });
}

const primerFichajeSchema = z.array(z.object({ occurred_at: z.string() }));

/**
 * El día en que la sede empezó a fichar con el reloj, o `null` si todavía no.
 *
 * Es lo que decide si Horario ofrece registrar una semana: antes de ese día, un turno sin
 * marcas es un día de antes de la app; desde ese día, es alguien que no vino o no marcó.
 * El servidor hace la misma cuenta y es el que manda; esto solo evita ofrecer un botón
 * que no haría nada.
 */
export async function fetchInicioDelReloj(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
}): Promise<DateKey | null> {
  const filas = await selectRows(primerFichajeSchema, (db) =>
    db
      .from(TABLES.timeEvents)
      .select('occurred_at')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('source', 'kiosk')
      .order('occurred_at', { ascending: true })
      .limit(1),
  );
  const primero = filas[0];
  return primero === undefined ? null : dateKeyOf(primero.occurred_at, params.timezone);
}

export function useInicioDelReloj(params: {
  organizationId: string | null;
  locationId: string | null;
  timezone: string;
  enabled: boolean;
}) {
  const { organizationId, locationId, timezone, enabled } = params;
  return useQuery({
    queryKey: ['schedule', 'inicio-del-reloj', organizationId, locationId, timezone],
    queryFn: () =>
      fetchInicioDelReloj({
        organizationId: organizationId ?? '',
        locationId: locationId ?? '',
        timezone,
      }),
    enabled: enabled && organizationId !== null && locationId !== null,
    staleTime: 10 * 60 * 1000,
  });
}

export function useSimulacionCumplido(params: {
  locationId: string | null;
  dias: DateKey[];
  enabled: boolean;
}) {
  const { locationId, dias, enabled } = params;
  return useQuery({
    queryKey: ['schedule', 'cumplido', locationId, dias],
    queryFn: () => simularHorarioCumplido({ locationId: locationId ?? '', dias }),
    enabled: enabled && locationId !== null && dias.length > 0,
    staleTime: 0,
  });
}

export function useRegistrarCumplido(locationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dias: DateKey[]) =>
      registrarHorarioCumplido({ locationId: locationId ?? '', dias }),
    /*
     * TODO, NO UNA LISTA DE CLAVES: lo registrado sale en Horas, en Reportes, en el bono,
     * en Inicio y en la vista de cada vendedor, cada una con su clave. Una lista se queda
     * corta el día que aparece una pantalla nueva, y esa enseñaría la semana vacía hasta
     * recargar, como si no hubiera funcionado. Es algo que se hace pocas veces.
     */
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
