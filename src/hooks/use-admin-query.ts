import type { ZodType } from 'zod';

import { getDataClient, type DataError } from '@/lib/firebase/query';

/**
 * Capa compartida de acceso a datos del panel administrativo (§11, §20, §22).
 *
 * Tres reglas que impone este archivo:
 *   1. el usuario nunca ve un error crudo de Firestore: cada fallo se traduce a un
 *      `AdminErrorKind` que la pantalla sabe explicar con microcopy propio (§20);
 *   2. toda respuesta se valida con Zod al recibir, no solo al enviar (§22): si el
 *      backend cambia de forma, la pantalla muestra un error honesto en lugar de
 *      pintar `undefined`;
 *   3. nada de `any`: el cliente viene sin tipos generados, así que el tipo real
 *      de cada fila lo define su esquema Zod.
 */

export type AdminClient = NonNullable<ReturnType<typeof getDataClient>>;

export type AdminErrorKind =
  /** Falta configuración de entorno: no hay backend al que preguntar. */
  | 'notConfigured'
  /** Fallo de red. Se puede reintentar. */
  | 'offline'
  /** Las reglas de seguridad o el rol rechazaron la operación. */
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
  /**
   * EL CÓDIGO CRUDO, y se guarda por lo que costó no tenerlo.
   *
   * `kind` sirve para decidir qué microcopy enseñar, pero borra de qué se quejó el
   * backend. Cuando el logo de una empresa no se pudo subir, la pantalla decía
   * «revisa tu conexión» y no había forma —ni mirando la base, ni las reglas, ni el
   * bucket— de saber si era permiso, formato, tamaño o red. Diagnosticarlo se llevó
   * una hora de descartar hipótesis a ciegas.
   *
   * Un código como `storage/unauthorized` NO es un detalle interno del bucket: es
   * una palabra corta que se puede buscar y que dice exactamente qué pasó. Se guarda
   * para poder enseñarlo cuando no haya nada mejor que decir.
   */
  readonly code: string;

  constructor(kind: AdminErrorKind, message?: string, code = '') {
    super(message ?? kind);
    this.name = 'AdminError';
    this.kind = kind;
    this.code = code;
  }
}

/** El código crudo, si lo hay. Vacío cuando el error no traía ninguno. */
export function adminErrorCode(error: unknown): string {
  return error instanceof AdminError ? error.code : '';
}

export function adminErrorKind(error: unknown): AdminErrorKind {
  return error instanceof AdminError ? error.kind : 'server';
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Códigos de Firestore, de Cloud Functions y de Storage que la interfaz sí sabe
 * explicar.
 *
 * LOS DE STORAGE SE AÑADIERON EL 2026-09-28, Y FALTABAN TODOS. Esta tabla cubría
 * Firestore y Functions; Firebase Storage usa un prefijo propio —`storage/…`— así que
 * NINGÚN fallo de subida encajaba en ningún caso y todos caían en `server`. El
 * resultado: subir el logo fallaba y la pantalla decía «revisa tu conexión» aunque la
 * conexión estuviera perfecta. Un error mal clasificado no es un detalle de
 * presentación: manda a mirar donde no está el problema.
 *
 * `failed-precondition` MERECE SU PROPIA LÍNEA y no es un error de servidor
 * cualquiera: en Firestore es, casi siempre, «falta el índice compuesto de esta
 * consulta». Se deja caer en `server` con su mensaje intacto a propósito, porque ese
 * mensaje trae el enlace que crea el índice, y borrarlo obligaría a reproducir el
 * fallo con la consola abierta para recuperarlo.
 */
function kindFromCode(code: string, message: string): AdminErrorKind {
  switch (code) {
    case 'permission-denied':
    case 'functions/permission-denied':
    case 'unauthenticated':
    case 'functions/unauthenticated':
      return 'forbidden';
    case 'aborted':
    case 'functions/aborted':
      return 'conflict';
    case 'not-found':
    case 'functions/not-found':
      return 'notFound';
    case 'invalid-argument':
    case 'functions/invalid-argument':
    case 'already-exists':
    case 'functions/already-exists':
      return 'invalid';
    case 'unavailable':
    case 'functions/unavailable':
    case 'deadline-exceeded':
    case 'functions/deadline-exceeded':
      return 'offline';
    case 'not-configured':
      return 'notConfigured';

    /*
     * STORAGE. `unauthorized` es el que dan las reglas al rechazar, y es el que más
     * importa distinguir: es lo único que significa «tu usuario no puede hacer esto»
     * y lo que mandaba a revisar el cable de red.
     */
    case 'storage/unauthorized':
    case 'storage/unauthenticated':
      return 'forbidden';
    case 'storage/retry-limit-exceeded':
    case 'storage/canceled':
      return 'offline';
    case 'storage/object-not-found':
    case 'storage/bucket-not-found':
      return 'notFound';
    case 'storage/invalid-argument':
    case 'storage/invalid-checksum':
      return 'invalid';
    default:
      break;
  }
  if (/network|fetch|timeout|offline/i.test(message)) return 'offline';
  return 'server';
}

/** Traduce cualquier fallo a un caso que la interfaz sabe explicar (§20). */
export function toAdminError(error: unknown): AdminError {
  if (error instanceof AdminError) return error;

  if (typeof error === 'object' && error !== null) {
    const source = error as Record<string, unknown>;
    const message = readString(source, 'message');
    const code = readString(source, 'code');
    return new AdminError(kindFromCode(code, message), message, code);
  }

  if (error instanceof Error) {
    return new AdminError(
      /network|fetch/i.test(error.message) ? 'offline' : 'server',
      error.message,
    );
  }

  return new AdminError('server');
}

/**
 * Cliente listo para usar. Lanza `notConfigured` en lugar de devolver `null`:
 * así el estado de "falta configuración" llega a la pantalla por el mismo camino
 * que cualquier otro error, y ninguna pantalla revienta (§20).
 */
export function requireClient(): AdminClient {
  const db = getDataClient();
  if (db === null) throw new AdminError('notConfigured');
  return db;
}

type QueryOutcome = { data: unknown; error: DataError | null };
type MutationOutcome = { error: DataError | null };

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
