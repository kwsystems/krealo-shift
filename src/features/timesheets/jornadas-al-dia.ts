import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { requireClient, toAdminError } from '@/hooks/use-admin-query';
import { refrescarVistasDeHoras } from '@/hooks/refrescar-vistas';
import { RPC } from '@/lib/firebase/tables';

/**
 * LAS JORNADAS DEL PERIODO QUE SE MIRA, AL DÍA CON EL HORARIO DE AHORA (30-sep).
 *
 * POR QUÉ EXISTE. Se arregló que publicar el horario revisara las jornadas, y Andree volvió
 * a Horas y seguía «Sin turno programado»: esa jornada se había guardado antes del arreglo
 * y nada la había vuelto a tocar. Tenía razón al decir que no tenía sentido —«te dije que
 * todo debería estar sincronizado»—: una marca que solo se corrige cuando pasa algo depende
 * de que pase.
 *
 * Así que la pantalla que enseña jornadas le pide al servidor que las ponga al día con el
 * horario publicado ANTES de fiarse de ellas. El servidor solo cambia turno y marcas —nunca
 * horas— y dice cuántas cambió; si cambió alguna, se refrescan todas las vistas. Si no, no
 * pasa nada y no cuesta una segunda carga.
 *
 * Si falla no se enseña error: lo que se ve sigue siendo lo guardado, que es lo que se veía
 * antes de esto. Se registra para que se note.
 */

const respuestaSchema = z.object({ cambiadas: z.number().int() });

async function revisarJornadas(params: {
  locationId: string;
  from: string;
  to: string;
}): Promise<number> {
  const db = requireClient();
  const { data, error } = await db.rpc(RPC.recheckSessionsForPeriod, {
    p_location_id: params.locationId,
    p_from: params.from,
    p_to: params.to,
  });
  if (error !== null) throw toAdminError(error);
  return respuestaSchema.parse(data).cambiadas;
}

export function useJornadasAlDia(params: { locationId: string | null; from: string; to: string }) {
  const queryClient = useQueryClient();
  const revision = useQuery({
    queryKey: ['revision-de-jornadas', params.locationId ?? 'none', params.from, params.to],
    queryFn: () =>
      revisarJornadas({ locationId: params.locationId ?? '', from: params.from, to: params.to }),
    enabled: params.locationId !== null && params.from !== '' && params.to !== '',
    // Cada dos minutos como mucho por periodo: el horario no cambia más rápido que eso, y
    // lo que sí cambia al momento —publicar, cancelar, aprobar— ya revisa por su cuenta.
    staleTime: 2 * 60_000,
    retry: false,
  });

  const cambiadas = revision.data ?? 0;
  const cuando = revision.dataUpdatedAt;
  useEffect(() => {
    // Fuera de la lista que refresca, a propósito: si no, se llamaría a sí misma.
    if (cambiadas > 0) refrescarVistasDeHoras(queryClient);
  }, [cambiadas, cuando, queryClient]);

  useEffect(() => {
    if (revision.error !== null) {
      console.warn('[krealo-shift] no se pudieron revisar las jornadas', revision.error);
    }
  }, [revision.error]);
}
