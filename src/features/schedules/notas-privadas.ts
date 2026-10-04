import { z } from 'zod';

import { execute, selectRows } from '@/hooks/use-admin-query';
import { enTrozos } from '@/lib/firebase/en-trozos';
import { docId } from '@/lib/firebase/ids';
import { TABLES } from '@/lib/firebase/tables';

/**
 * LA NOTA PRIVADA DE QUIEN GESTIONA, FUERA DEL TURNO (auditoría, 4-oct).
 *
 * Vivía en el propio turno (`manager_note`), y las reglas dejan a cada vendedor leer sus
 * turnos enteros: su celular descargaba la «Nota privada del gerente» y solo la escondía
 * al pintar. Una regla de Firestore da o quita el documento entero, no un campo, así que
 * la única forma de que el vendedor no la lea es que no esté en su turno.
 *
 * Ahora va en `shift_private_notes`, con el id del turno, y la leen solo quienes gestionan.
 * Las notas que ya estaban en el turno se siguen viendo en Horario (si no hay una aquí, se
 * usa la del turno), y la primera vez que alguien edita ese turno se mudan aquí y el turno
 * queda sin ella. Mover de golpe las que nadie toque es decisión de Andree: ver la tarea.
 */
const notaPrivadaSchema = z.object({
  shift_id: docId(),
  note: z.string().nullable(),
});

/** Las notas de estos turnos, por id. Un turno sin documento aquí no sale en el mapa. */
export async function fetchNotasPrivadas(params: {
  organizationId: string;
  shiftIds: readonly string[];
}): Promise<Map<string, string | null>> {
  const ids = [...new Set(params.shiftIds)];
  if (ids.length === 0) return new Map();
  const partes = await Promise.all(
    enTrozos(ids).map((trozo) =>
      selectRows(z.array(notaPrivadaSchema), (db) =>
        db
          .from(TABLES.shiftPrivateNotes)
          .select('shift_id, note')
          // La regla mira la empresa: sin este filtro Firestore deniega la consulta entera.
          .eq('organization_id', params.organizationId)
          .in('shift_id', trozo),
      ),
    ),
  );
  return new Map(partes.flat().map((fila) => [fila.shift_id, fila.note]));
}

/**
 * Guarda la nota de un turno, vacía incluida: una nota borrada se guarda como `null` para
 * que no vuelva a salir la vieja que pudiera quedar en el turno.
 */
export async function guardarNotasPrivadas(
  notas: readonly {
    organizationId: string;
    locationId: string;
    employeeId: string;
    shiftId: string;
    note: string | null;
  }[],
): Promise<void> {
  if (notas.length === 0) return;
  await execute((db) =>
    db.from(TABLES.shiftPrivateNotes).upsert(
      notas.map((nota) => ({
        organization_id: nota.organizationId,
        location_id: nota.locationId,
        // Para borrarla con la ficha: ver `functions/src/eliminar-empleado.ts`.
        employee_id: nota.employeeId,
        shift_id: nota.shiftId,
        note: nota.note === null || nota.note.trim() === '' ? null : nota.note.trim(),
      })),
    ),
  );
}

/** La nota que se enseña: la de aquí si existe, si no la que quedara en el turno. */
export function conNotaPrivada<T extends { id: string; manager_note: string | null }>(
  turno: T,
  notas: ReadonlyMap<string, string | null>,
): T {
  return notas.has(turno.id) ? { ...turno, manager_note: notas.get(turno.id) ?? null } : turno;
}
