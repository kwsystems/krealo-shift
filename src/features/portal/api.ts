import { z } from 'zod';

import { callFunction } from '@/lib/firebase/functions';

import { shiftRowSchema, type ShiftRow } from '@/features/schedules/api';
import { workSessionSchema, type WorkSession } from '@/features/timesheets/api';
import type { DateKey } from '@/features/schedules/week';
import { AdminError, requireClient, selectRows, toAdminError } from '@/hooks/use-admin-query';
import { locationSchema, type ManagerLocation } from '@/hooks/use-manager-scope';
import { docId } from '@/lib/firebase/ids';
import { getDataClient } from '@/lib/firebase/query';
import { RPC, TABLES } from '@/lib/firebase/tables';
import { estaPorConfirmar } from './resumen';

/**
 * LO QUE LEE LA VISTA DEL VENDEDOR, y nada más.
 *
 * TODA CONSULTA VA ACOTADA POR EMPRESA Y POR SU FICHA. No es cortesía: las reglas dejan a
 * un `employee` leer solo lo suyo (`isSelfEmployee`), y Firestore deniega ENTERA una
 * consulta que no pueda demostrar que todo lo que devuelve es suyo. Una consulta por sede
 * —como las del panel— fallaría con «falta un permiso» aunque el vendedor tuviera turnos
 * en esa sede.
 */

const miMembresiaSchema = z.object({
  organization_id: docId(),
  role: z.enum(['owner', 'admin', 'manager', 'employee']),
  employee_id: docId().nullable().default(null),
});

const organizacionSchema = z.object({
  id: docId(),
  name: z.string(),
  default_timezone: z.string(),
  week_starts_on: z.number().int().nullable().default(null),
});

const fichaSchema = z.object({
  id: docId(),
  full_name: z.string(),
  preferred_name: z.string().nullable().default(null),
  status: z.string(),
});

const asignacionSchema = z.object({
  location_id: docId(),
  is_primary: z.boolean().nullable().default(null),
});

export type MiFicha = {
  organizationId: string;
  organizacion: string;
  employeeId: string;
  nombre: string;
  nombreCompleto: string;
  activo: boolean;
  sede: ManagerLocation | null;
  /** La de la sede, o la de la empresa si no tiene sede. */
  timezone: string;
  weekStartsOn: number;
};

/**
 * La ficha de quien entró. `null` si su cuenta no está ligada a ninguna —tiene membresía
 * de empleado pero sin ficha, p. ej. invitado a mano como `employee` en Ajustes—: la
 * pantalla lo explica en vez de enseñar un horario vacío.
 */
export async function fetchMiFicha(): Promise<MiFicha | null> {
  const db = getDataClient();
  const userId = db === null ? null : ((await db.auth.getUser()).data.user?.id ?? null);
  if (userId === null) throw new AdminError('forbidden', 'NO_SESSION');

  const membresias = await selectRows(z.array(miMembresiaSchema), (client) =>
    client
      .from(TABLES.organizationMemberships)
      .select('organization_id, role, employee_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
  );
  let mia = membresias.find((m) => m.role === 'employee' && m.employee_id !== null);
  /*
   * SIN FICHA LIGADA, SE INTENTA LIGAR UNA VEZ (4-oct): si su correo ya está en una ficha
   * —se puso después de invitarla, o cambió de cuenta—, el servidor la liga ahora. Antes
   * solo se intentaba al entrar sin ninguna membresía, así que quien ya tenía una de
   * empleado sin ficha se quedaba con «pide que pongan este correo en tu ficha» para siempre.
   */
  if (mia === undefined) {
    const { data } = await callFunction<{ claimed: boolean }>('claimInvitation');
    if (data?.claimed === true) {
      const otraVez = await selectRows(z.array(miMembresiaSchema), (client) =>
        client
          .from(TABLES.organizationMemberships)
          .select('organization_id, role, employee_id')
          .eq('user_id', userId)
          .eq('status', 'active'),
      );
      mia = otraVez.find((m) => m.role === 'employee' && m.employee_id !== null);
    }
  }
  if (mia === undefined || mia.employee_id === null) return null;
  const organizationId = mia.organization_id;
  const employeeId = mia.employee_id;

  const [organizacion] = await selectRows(z.array(organizacionSchema), (client) =>
    client
      .from(TABLES.organizations)
      .select('id, name, default_timezone, week_starts_on')
      .eq('id', organizationId),
  );
  const [ficha] = await selectRows(z.array(fichaSchema), (client) =>
    client
      .from(TABLES.employees)
      .select('id, full_name, preferred_name, status')
      .eq('id', employeeId),
  );
  if (organizacion === undefined || ficha === undefined) return null;

  const asignaciones = await selectRows(z.array(asignacionSchema), (client) =>
    client
      .from(TABLES.employeeLocationAssignments)
      .select('location_id, is_primary')
      .eq('organization_id', organizationId)
      .eq('employee_id', employeeId),
  );
  const principal = asignaciones.find((a) => a.is_primary === true) ?? asignaciones[0];
  const [sede] =
    principal === undefined
      ? []
      : await selectRows(z.array(locationSchema), (client) =>
          client
            .from(TABLES.locations)
            .select('id, name, address, timezone, is_active, settings')
            .eq('id', principal.location_id),
        );

  const nombre =
    ficha.preferred_name !== null && ficha.preferred_name.trim() !== ''
      ? ficha.preferred_name
      : ficha.full_name;

  return {
    organizationId,
    organizacion: organizacion.name,
    employeeId,
    nombre,
    nombreCompleto: ficha.full_name,
    activo: ficha.status === 'active',
    sede: sede ?? null,
    timezone: sede?.timezone ?? organizacion.default_timezone,
    weekStartsOn: sede?.settings.weekStartsOn ?? organizacion.week_starts_on ?? 1,
  };
}

/**
 * Sus turnos PUBLICADOS: un borrador no existe para nadie más que quien lo prepara.
 *
 * Con UNA excepción (4-oct): el que ya se le publicó y quien gestiona está cambiando —el
 * «Cambiado» de Horario—. Ese turno existía para la persona; si se dejara fuera, su día
 * pasaría a decir «Libre» mientras se edita. Vuelve marcado como lo que es y la pantalla lo
 * dice «por confirmar» (ver `estaPorConfirmar`). Un borrador NUNCA publicado sigue sin
 * salir: esa semana todavía no existe para ella.
 */
export async function fetchMisTurnos(params: {
  organizationId: string;
  employeeId: string;
  fromISO: string;
  toISO: string;
}): Promise<ShiftRow[]> {
  return selectRows(z.array(shiftRowSchema), (db) =>
    db
      .from(TABLES.shifts)
      .select(
        'id, employee_id, location_id, job_role_id, starts_at, ends_at, timezone, planned_unpaid_break_minutes, employee_note, manager_note, status, publication_version, published_at, updated_at',
      )
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId)
      .in('status', ['published', 'draft'])
      .gte('starts_at', params.fromISO)
      .lt('starts_at', params.toISO)
      .order('starts_at', { ascending: true }),
  ).then((filas) =>
    filas
      .filter((fila) => fila.status === 'published' || estaPorConfirmar(fila))
      // La nota privada de quien gestiona no es para la persona: ni en memoria. Las nuevas ya
      // no viven en el turno (`schedules/notas-privadas.ts`); esto cubre las de antes.
      .map((fila) => ({ ...fila, manager_note: null })),
  );
}

/** Sus jornadas: lo que marcó, ya convertido en horas por el servidor. */
export async function fetchMisJornadas(params: {
  organizationId: string;
  employeeId: string;
  fromISO: string;
  toISO: string;
}): Promise<WorkSession[]> {
  return selectRows(z.array(workSessionSchema), (db) =>
    db
      .from(TABLES.workSessions)
      .select(
        'id, employee_id, location_id, shift_id, starts_at, ends_at, gross_minutes, paid_break_minutes, unpaid_break_minutes, net_minutes, status, flags, departure_reason, departure_note, source, credit_reason, credit_note, updated_at',
      )
      .eq('organization_id', params.organizationId)
      .eq('employee_id', params.employeeId)
      .gte('starts_at', params.fromISO)
      .lt('starts_at', params.toISO)
      .order('starts_at', { ascending: true }),
  );
}

const relojDesdeSchema = z.array(
  z.object({ location_id: docId(), clock_since: z.string().nullable() }),
);

/**
 * Desde qué día usa el reloj cada una de sus sedes (1-oct): desde ese día, un turno sin
 * ninguna marca es una falta. Lo da el servidor porque la persona solo puede leer sus
 * propios fichajes. Ver `viewClockStart` en `functions/src/horario-cumplido.ts`.
 */
export async function fetchRelojDesdeDeMisSedes(
  locationIds: readonly string[],
): Promise<Map<string, DateKey | null>> {
  if (locationIds.length === 0) return new Map();
  const db = requireClient();
  try {
    const { data, error } = await db.rpc(RPC.viewClockStart, {
      p_location_ids: [...locationIds],
    });
    if (error !== null) throw toAdminError(error);
    const leido = relojDesdeSchema.safeParse(data);
    if (!leido.success) throw toAdminError({ code: 'shape', message: 'UNEXPECTED_SHAPE' });
    return new Map(leido.data.map((fila) => [fila.location_id, fila.clock_since]));
  } catch (error) {
    throw toAdminError(error);
  }
}
