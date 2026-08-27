import type { PostgrestError } from '@supabase/supabase-js';
import type { ZodType } from 'zod';

import { getSupabase } from '@/lib/supabase/client';

/**
 * Capa compartida de acceso a datos del panel administrativo (§11, §20, §22).
 *
 * Tres reglas que impone este archivo:
 *   1. el usuario nunca ve un error crudo de Supabase: cada fallo se traduce a un
 *      `AdminErrorKind` que la pantalla sabe explicar con microcopy propio (§20);
 *   2. toda respuesta se valida con Zod al recibir, no solo al enviar (§22): si el
 *      backend cambia de forma, la pantalla muestra un error honesto en lugar de
 *      pintar `undefined`;
 *   3. nada de `any`: el cliente viene sin tipos generados, así que el tipo real
 *      de cada fila lo define su esquema Zod.
 */

export type AdminClient = NonNullable<ReturnType<typeof getSupabase>>;

export type AdminErrorKind =
  /** Falta configuración de entorno: no hay backend al que preguntar. */
  | 'notConfigured'
  /** Fallo de red. Se puede reintentar. */
  | 'offline'
  /** RLS o el rol rechazaron la operación. */
  | 'forbidden'
  /** Alguien más cambió el dato primero. */
  | 'conflict'
  | 'notFound'
  /** Datos inválidos: lo dice una restricción de la base. */
  | 'invalid'
  /** La respuesta no tiene la forma esperada. */
  | 'unexpectedShape'
  | 'server';

export class AdminError extends Error {
  readonly kind: AdminErrorKind;

  constructor(kind: AdminErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'AdminError';
    this.kind = kind;
  }
}

export function adminErrorKind(error: unknown): AdminErrorKind {
  return error instanceof AdminError ? error.kind : 'server';
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/** Códigos de Postgres y de PostgREST que la interfaz sí sabe explicar. */
function kindFromCode(code: string, message: string): AdminErrorKind {
  switch (code) {
    case '42501': // insufficient_privilege
    case 'PGRST301': // JWT ausente o expirado
    case '42P01': // relación inexistente: para el cliente es acceso denegado
      return 'forbidden';
    case '40001': // serialization_failure: lo usa manager_adjust_time
      return 'conflict';
    case '02000': // no_data_found
    case 'PGRST116': // single() sin filas
      return 'notFound';
    case '23514': // check_violation
    case '23505': // unique_violation
    case '23503': // foreign_key_violation
    case '23001': // restrict_violation
      return 'invalid';
    default:
      break;
  }
  if (/network|fetch|timeout/i.test(message)) return 'offline';
  return 'server';
}

/** Traduce cualquier fallo a un caso que la interfaz sabe explicar (§20). */
export function toAdminError(error: unknown): AdminError {
  if (error instanceof AdminError) return error;

  if (typeof error === 'object' && error !== null) {
    const source = error as Record<string, unknown>;
    const message = readString(source, 'message');
    const code = readString(source, 'code');
    return new AdminError(kindFromCode(code, message), message);
  }

  if (error instanceof Error) {
    return new AdminError(/network|fetch/i.test(error.message) ? 'offline' : 'server', error.message);
  }

  return new AdminError('server');
}

/**
 * Cliente listo para usar. Lanza `notConfigured` en lugar de devolver `null`:
 * así el estado de "falta configuración" llega a la pantalla por el mismo camino
 * que cualquier otro error, y ninguna pantalla revienta (§20).
 */
export function requireClient(): AdminClient {
  const db = getSupabase();
  if (db === null) throw new AdminError('notConfigured');
  return db;
}

type QueryOutcome = { data: unknown; error: PostgrestError | null };
type MutationOutcome = { error: PostgrestError | null };

/** Consulta con validación de forma. Devuelve ya tipado por el esquema. */
export async function selectRows<T>(
  schema: ZodType<T>,
  run: (db: AdminClient) => PromiseLike<QueryOutcome>,
): Promise<T> {
  const db = requireClient();

  let outcome: QueryOutcome;
  try {
    outcome = await run(db);
  } catch (error) {
    throw toAdminError(error);
  }

  if (outcome.error !== null) throw toAdminError(outcome.error);

  const parsed = schema.safeParse(outcome.data);
  if (!parsed.success) throw new AdminError('unexpectedShape', parsed.error.message);
  return parsed.data;
}

/** Escritura sin respuesta útil: insert, update, delete o rpc sin retorno. */
export async function execute(
  run: (db: AdminClient) => PromiseLike<MutationOutcome>,
): Promise<void> {
  const db = requireClient();

  let outcome: MutationOutcome;
  try {
    outcome = await run(db);
  } catch (error) {
    throw toAdminError(error);
  }

  if (outcome.error !== null) throw toAdminError(outcome.error);
}

/** Opciones por defecto de las listas del panel: cortas, porque cambian a cada minuto. */
export const ADMIN_LIST_STALE_MS = 30_000;

/**
 * Intervalo de sondeo del inicio administrativo (§11.1).
 *
 * Realtime puede acelerar la actualización, pero la vista debe funcionar con
 * polling y caché si Realtime falla, así que el sondeo no es opcional.
 */
export const DASHBOARD_POLL_MS = 60_000;
