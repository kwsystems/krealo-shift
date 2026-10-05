import { z } from 'zod';

import { selectRows } from '@/hooks/use-admin-query';
import { docId } from '@/lib/firebase/ids';
import { TABLES } from '@/lib/firebase/tables';

/**
 * LAS MARCAS QUE AVISAN (5-oct): las del reloj de la tienda, de una sede, por orden de
 * LLEGADA al servidor.
 *
 * POR LLEGADA Y NO POR HORA DE LA MARCA, y es la diferencia entre avisar y perder avisos.
 * Un reloj sin conexión guarda las marcas y las manda al volver la red: llegan ahora con
 * la hora de hace veinte minutos. Pidiendo «lo que pasó después de la última que vi» se
 * quedarían fuera para siempre; pidiendo «lo que llegó después» entran todas, una vez.
 *
 * SOLO `source: 'kiosk'`. Lo demás lo escribe una persona del panel —una corrección, un
 * «vino y no marcó», la salida que se cierra sola— y avisar a quien gestiona de lo que
 * acaba de hacer quien gestiona no es un aviso, es un eco.
 *
 * Las reglas dejan leer los fichajes de una sede a quien la gestiona, así que la consulta
 * fija empresa y sede: sin ellas Firestore la rechaza entera. El índice es
 * (organization_id, location_id, source, received_at).
 */
const tipoDeMarca = z.enum(['clock_in', 'break_start', 'break_end', 'clock_out']);

export const marcaDeAvisoSchema = z.object({
  id: docId(),
  employee_id: docId(),
  event_type: tipoDeMarca,
  reclassified_as: tipoDeMarca.nullable().default(null),
  break_type: z.enum(['paid', 'unpaid', 'meal', 'other']).nullable().default(null),
  break_reason: z.string().nullable().default(null),
  occurred_at: z.string(),
  received_at: z.string(),
  is_offline: z.boolean().default(false),
});

export type MarcaDeAviso = z.infer<typeof marcaDeAvisoSchema>;

/** Una tienda no hace doscientas marcas entre dos consultas; si las hiciera, la siguiente sigue. */
export const TOPE_POR_CONSULTA = 200;

export function fetchMarcasRecibidas(params: {
  organizationId: string;
  locationId: string;
  /** Inclusive: la última ya vista vuelve, y el almacén la descarta por id. */
  desde: string;
}): Promise<MarcaDeAviso[]> {
  return selectRows(z.array(marcaDeAvisoSchema), (db) =>
    db
      .from(TABLES.timeEvents)
      .select(
        'id, employee_id, event_type, reclassified_as, break_type, break_reason, occurred_at, received_at, is_offline',
      )
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('source', 'kiosk')
      .gte('received_at', params.desde)
      .order('received_at', { ascending: true })
      .limit(TOPE_POR_CONSULTA),
  );
}
