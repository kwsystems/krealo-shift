import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import { selectRows } from '@/hooks/use-admin-query';
import { VIEWS } from '@/lib/firebase/tables';

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
  employee_id: docId(),
  work_date: z.string(),
  break_reason: z.string(),
  break_type: z.string().nullable(),
  minutes: z.coerce.number().int(),
  pauses: z.coerce.number().int(),
  /*
   * Lo que la persona escribió al pausar por «Otro».
   *
   * OPCIONAL A PROPÓSITO, y no por pereza: la vista la sirve una Cloud Function
   * desplegada aparte, así que entre que esto se publica y que la función nueva está
   * arriba hay un rato en el que la respuesta NO trae `notes`. Con el campo obligatorio,
   * Zod tumbaría el gráfico de motivos ENTERO durante ese rato: una pantalla que
   * funcionaba se quedaría en error por una mejora que aún no ha llegado.
   */
  notes: z
    .array(
      z.object({
        at: z.string(),
        minutes: z.coerce.number().int(),
        note: z.string(),
      }),
    )
    .optional()
    .default([]),
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
      .select('employee_id, work_date, break_reason, break_type, minutes, pauses, notes')
      .eq('location_id', params.locationId)
      .gte('work_date', params.from)
      .lte('work_date', params.to),
  );
}
