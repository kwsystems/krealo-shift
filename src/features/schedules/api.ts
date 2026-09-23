import { z } from 'zod';

import { docId } from '@/lib/firebase/ids';

import { addDaysToKey, dateKeyOf, localTimeOf, shiftInstants, weekRangeInstants } from './week';
import {
  AdminError,
  execute,
  requireClient,
  selectRows,
  toAdminError,
} from '@/hooks/use-admin-query';
import { useSessionStore } from '@/stores/session-store';
import { RPC, TABLES } from '@/lib/firebase/tables';

/**
 * Turnos y publicaciones (§11.3).
 *
 * Decisiones que respeta este archivo:
 *   - un turno editado vuelve a `draft`: los cambios sobre un horario publicado
 *     permanecen como borrador hasta una nueva publicación;
 *   - un turno publicado NUNCA se borra, se cancela: si desapareciera, los
 *     fichajes que lo referencian perderían su contexto (la base también lo
 *     impide con un trigger);
 *   - copiar una semana suma siete días de calendario en la zona horaria de la
 *     ubicación, no 168 horas: así un cambio de horario de verano no mueve los
 *     turnos una hora.
 */

export const shiftStatusValues = ['draft', 'published', 'cancelled'] as const;

/**
 * Se exporta para poder COMPROBAR que un turno recién creado se puede volver a leer.
 * `forma-del-turno.test.ts` arma el documento exacto que acaba en Firestore y lo pasa por
 * aquí: hasta el 2026-09-22 no pasaba, y crear un turno tiraba la semana entera.
 */
export const shiftRowSchema = z.object({
  id: docId(),
  employee_id: docId(),
  location_id: docId(),
  job_role_id: docId().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  timezone: z.string(),
  planned_unpaid_break_minutes: z.number().int(),
  employee_note: z.string().nullable(),
  manager_note: z.string().nullable(),
  status: z.enum(shiftStatusValues),
  /*
   * `.default(...)` Y NO SOLO EL TIPO, por el mismo motivo que en `employeeSchema`: allí
   * ya costó la pantalla de Equipo entera y la lección vale igual aquí.
   *
   * Un tipo a secas acepta el valor pero NO acepta que el campo no esté: llega
   * `undefined` y Zod lo rechaza. Y `selectRows` no descarta la fila, lanza, así que un
   * solo turno viejo tira la consulta de la SEMANA COMPLETA.
   *
   * Arreglar el escritor —abajo, en `createShift`— no arregla lo que ya está en la base.
   * Esto sí, y además hace que un campo añadido en el futuro no tumbe la pantalla de
   * quien todavía no lo tiene. Los dos lados, a propósito.
   *
   * `updated_at` cae a cadena vacía y nadie lo lee hoy: es metadato de auditoría. Mentir
   * con una fecha inventada sería peor que admitir que no se sabe.
   */
  publication_version: z.number().int().default(0),
  published_at: z.string().nullable().default(null),
  updated_at: z.string().default(''),
});

export type ShiftRow = z.infer<typeof shiftRowSchema>;

const publicationSchema = z.object({
  id: docId(),
  publication_version: z.number().int(),
  published_at: z.string(),
  changed_shift_ids: z.array(docId()),
});

export type ShiftPublication = z.infer<typeof publicationSchema>;

const SHIFT_COLUMNS =
  'id, employee_id, location_id, job_role_id, starts_at, ends_at, timezone, planned_unpaid_break_minutes, employee_note, manager_note, status, publication_version, published_at, updated_at';

/**
 * TODA CONSULTA ACOTA POR ORGANIZACIÓN, Y NO ES REDUNDANTE.
 *
 * Una regla de Firestore NO es un filtro. Para una consulta, Firestore tiene que poder
 * DEMOSTRAR —solo con los filtros de la consulta— que todos los resultados están
 * permitidos; si la regla mira un campo que la consulta no acota, deniega la consulta
 * ENTERA en vez de devolver menos filas.
 *
 * Estas consultas filtraban solo por `location_id` y la regla mira `organization_id`,
 * así que daban 403 con la membresía correcta. El panel decía «Falta un permiso» en
 * Horario, Horas e Inicio, mientras Equipo y Ajustes funcionaban — porque esas sí
 * filtraban por organización. El discriminador fue lanzar las diez consultas del panel
 * con el token real del usuario: las que acotaban por organización daban 200 y las tres
 * que acotaban solo por sede daban 403.
 */
export async function fetchWeekShifts(params: {
  organizationId: string;
  locationId: string;
  fromISO: string;
  toISO: string;
}): Promise<ShiftRow[]> {
  return selectRows(z.array(shiftRowSchema), (db) =>
    db
      .from(TABLES.shifts)
      .select(SHIFT_COLUMNS)
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .gte('starts_at', params.fromISO)
      .lt('starts_at', params.toISO)
      .order('starts_at', { ascending: true }),
  );
}

export type ShiftInput = {
  employeeId: string;
  jobRoleId: string | null;
  dateKey: string;
  startTime: string;
  endTime: string;
  plannedUnpaidBreakMinutes: number;
  employeeNote: string | null;
  managerNote: string | null;
};

function buildRow(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
  input: ShiftInput;
}) {
  const { organizationId, locationId, timezone, input } = params;

  const instants = shiftInstants({
    dateKey: input.dateKey,
    startTime: input.startTime,
    endTime: input.endTime,
    timezone,
  });
  if (instants === null) throw new AdminError('invalid', 'INVALID_SHIFT_TIMES');

  return {
    organization_id: organizationId,
    location_id: locationId,
    employee_id: input.employeeId,
    job_role_id: input.jobRoleId,
    starts_at: instants.startsAt,
    ends_at: instants.endsAt,
    timezone,
    planned_unpaid_break_minutes: Math.max(0, Math.trunc(input.plannedUnpaidBreakMinutes)),
    employee_note: input.employeeNote,
    manager_note: input.managerNote,
  };
}

function actorId(): string | null {
  return useSessionStore.getState().user?.userId ?? null;
}

/*
 * `publication_version` y `published_at` SE ESCRIBEN AQUI, y antes no los escribía
 * nadie. En Postgres los ponía un trigger de la base; el trigger se fue con la
 * migración y no lo reemplazó nada, así que un turno creado por la app nacía sin dos
 * campos que su propio esquema declara obligatorios. `selectRows` no descarta la fila
 * mala: lanza. O sea que crear un turno tiraba la consulta de la SEMANA ENTERA.
 *
 * Cero es el valor correcto al nacer: significa «todavía no se ha publicado nunca», y
 * es lo que distingue un borrador nuevo de uno que ya estuvo publicado y se editó
 * después. Quién sella la versión al PUBLICAR es otra cosa, y sigue pendiente: el
 * comentario de `publishShifts` explica por qué no debería decidirlo el cliente.
 */
export async function createShift(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
  input: ShiftInput;
}): Promise<void> {
  const row = buildRow(params);
  const createdBy = actorId();

  await execute((db) =>
    db.from(TABLES.shifts).insert({
      ...row,
      status: 'draft',
      publication_version: 0,
      published_at: null,
      created_by: createdBy,
      updated_by: createdBy,
    }),
  );
}

/**
 * Editar deja el turno en borrador, incluso si estaba publicado (§11.3 paso 8).
 * Se conserva `publication_version` para saber que ya existió publicado antes.
 */
export async function updateShift(params: {
  shiftId: string;
  organizationId: string;
  locationId: string;
  timezone: string;
  input: ShiftInput;
}): Promise<void> {
  const row = buildRow(params);

  await execute((db) =>
    db
      .from(TABLES.shifts)
      .update({ ...row, status: 'draft', updated_by: actorId() })
      .eq('id', params.shiftId),
  );
}

export async function duplicateShift(params: {
  organizationId: string;
  shift: ShiftRow;
  timezone: string;
  /** Día destino de la copia. Por defecto, el mismo día del turno original. */
  dateKey?: string;
}): Promise<void> {
  const { shift, timezone } = params;
  const dateKey = params.dateKey ?? dateKeyOf(shift.starts_at, timezone);

  await createShift({
    organizationId: params.organizationId,
    locationId: shift.location_id,
    timezone,
    input: {
      employeeId: shift.employee_id,
      jobRoleId: shift.job_role_id,
      dateKey,
      startTime: localTimeOf(shift.starts_at, timezone),
      endTime: localTimeOf(shift.ends_at, timezone),
      plannedUnpaidBreakMinutes: shift.planned_unpaid_break_minutes,
      employeeNote: shift.employee_note,
      managerNote: shift.manager_note,
    },
  });
}

/** Borrador: se elimina. Publicado: se cancela, para conservar el historial. */
export async function removeShift(params: { shiftId: string; status: string }): Promise<void> {
  if (params.status === 'published') {
    await execute((db) =>
      db
        .from(TABLES.shifts)
        .update({ status: 'cancelled', updated_by: actorId() })
        .eq('id', params.shiftId),
    );
    return;
  }

  await execute((db) => db.from(TABLES.shifts).delete().eq('id', params.shiftId));
}

/**
 * Copia la semana anterior como borradores (§11.3).
 * Con `employeeId` copia solo los turnos de una persona.
 */
export async function copyPreviousWeek(params: {
  organizationId: string;
  locationId: string;
  timezone: string;
  targetWeekStart: string;
  employeeId?: string | null;
}): Promise<number> {
  const { organizationId, locationId, timezone, targetWeekStart, employeeId } = params;

  const previousWeekStart = addDaysToKey(targetWeekStart, -7);
  const range = weekRangeInstants(previousWeekStart, timezone);

  const source = (
    await fetchWeekShifts({
      organizationId,
      locationId,
      fromISO: range.fromISO,
      toISO: range.toISO,
    })
  ).filter(
    (shift) =>
      shift.status !== 'cancelled' &&
      (employeeId === undefined || employeeId === null || shift.employee_id === employeeId),
  );

  if (source.length === 0) return 0;

  const createdBy = actorId();
  const rows = source.map((shift) => {
    const dateKey = addDaysToKey(dateKeyOf(shift.starts_at, timezone), 7);
    const instants = shiftInstants({
      dateKey,
      startTime: localTimeOf(shift.starts_at, timezone),
      endTime: localTimeOf(shift.ends_at, timezone),
      timezone,
    });
    if (instants === null) throw new AdminError('invalid', 'INVALID_SHIFT_TIMES');

    return {
      organization_id: organizationId,
      location_id: locationId,
      employee_id: shift.employee_id,
      job_role_id: shift.job_role_id,
      starts_at: instants.startsAt,
      ends_at: instants.endsAt,
      timezone,
      planned_unpaid_break_minutes: shift.planned_unpaid_break_minutes,
      employee_note: shift.employee_note,
      manager_note: shift.manager_note,
      status: 'draft' as const,
      publication_version: 0,
      published_at: null,
      created_by: createdBy,
      updated_by: createdBy,
    };
  });

  await execute((db) => db.from(TABLES.shifts).insert(rows));
  return rows.length;
}

/**
 * Publica los turnos indicados y deja constancia de qué cambió (§11.3 pasos 6-7).
 *
 * LO HACE TODO EL SERVIDOR, en una transacción. Antes se hacía aquí: se ponían los
 * turnos en `published` y se insertaba la fila de publicación con la versión siguiente.
 * Faltaba lo importante —sellar `publication_version` EN EL TURNO— y de eso depende la
 * etiqueta «Cambiado», que por tanto no salía nunca en producción.
 *
 * No se arregló añadiendo un `update` más aquí, y esa fue la decisión: el comentario que
 * había en esta misma función decía que la versión «la pone un trigger de la base, no el
 * cliente: las tardanzas se miden contra el turno publicado vigente y esa versión no
 * puede depender de lo que envíe una app». Tenía razón. Ese trigger era de Postgres y se
 * fue con la migración a Firebase sin que nada lo reemplazara; `publishShiftsForWeek` es
 * el reemplazo.
 *
 * Y de paso arregla una carrera que había: la versión siguiente se calculaba leyendo la
 * última, sin transacción. Dos gerentes publicando la misma semana a la vez leían las dos
 * la misma y escribían las dos la misma.
 */
export async function publishShifts(params: {
  organizationId: string;
  locationId: string;
  weekStart: string;
  shiftIds: string[];
}): Promise<void> {
  if (params.shiftIds.length === 0) return;

  const db = requireClient();
  try {
    const { error } = await db.rpc(RPC.publishShiftsForWeek, {
      p_location_id: params.locationId,
      p_week_start: params.weekStart,
      p_shift_ids: params.shiftIds,
    });
    if (error !== null) throw toAdminError(error);
  } catch (error) {
    throw toAdminError(error);
  }
}

export async function fetchPublications(params: {
  organizationId: string;
  locationId: string;
  weekStart: string;
}): Promise<ShiftPublication[]> {
  return selectRows(z.array(publicationSchema), (db) =>
    db
      .from(TABLES.shiftPublications)
      .select('id, publication_version, published_at, changed_shift_ids')
      .eq('organization_id', params.organizationId)
      .eq('location_id', params.locationId)
      .eq('week_starts_on', params.weekStart)
      .order('publication_version', { ascending: false }),
  );
}
