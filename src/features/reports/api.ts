import { z } from 'zod';

import { selectRows } from '@/hooks/use-admin-query';
import { VIEWS } from '@/lib/supabase/types';

/**
 * La ÚNICA consulta propia de Reportes (§11.4).
 *
 * Todo lo demás —minutos trabajados, sesiones, banderas— lo leen los hooks de Horas
 * sin tocarlos. Es deliberado: si Reportes tuviera sus propias consultas de horas, en
 * cuanto una de las dos cambiara un filtro las dos pantallas empezarían a contestar
 * cosas distintas sobre la misma semana, y nadie se enteraría hasta que alguien las
 * comparara. Con una sola fuente, no pueden discrepar.
 */

const breakRowSchema = z.object({
  employee_id: z.string().uuid(),
  work_date: z.string(),
  break_reason: z.string(),
  break_type: z.string().nullable(),
  minutes: z.coerce.number().int(),
  pauses: z.coerce.number().int(),
});

export type BreakByReasonRow = z.infer<typeof breakRowSchema>;

export async function fetchBreakTimeByReason(params: {
  locationId: string;
  from: string;
  to: string;
}): Promise<BreakByReasonRow[]> {
  return selectRows(z.array(breakRowSchema), (db) =>
    db
      .from(VIEWS.breakTimeByReason)
      .select('employee_id, work_date, break_reason, break_type, minutes, pauses')
      .eq('location_id', params.locationId)
      .gte('work_date', params.from)
      .lte('work_date', params.to),
  );
}
