import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type WhereFilterOp,
} from 'firebase/firestore';

import { deleteObject, ref as storageRef, uploadBytes } from 'firebase/storage';

import { getDemoClient } from '@/lib/demo/client';
import { isDemoMode } from '@/lib/demo/config';
import { env } from '@/lib/env';

import { getDb, getFirebaseAuth, getFirebaseStorage } from './client';
import { callFunction } from './functions';

/**
 * Capa de consultas sobre Firestore, con la misma forma que usaba el panel con
 * PostgREST: `db.from(t).select().eq().order()` devolviendo `{data, error}`.
 *
 * POR QUE SE CONSERVA ESA FORMA Y NO SE REESCRIBIERON LOS 14 `api.ts`
 *
 * Las consultas de esta app son planas: filtros de igualdad, un rango de fechas y
 * un orden. Ni un solo `select` anidado de PostgREST en todo el repositorio —se
 * comprobo antes de decidir—, asi que no hay nada que traducir salvo el motor.
 * Conservar la forma deja intactos los esquemas Zod, las pruebas y los 62 puntos
 * de llamada, y concentra el riesgo del cambio de backend en este archivo.
 *
 * LO QUE ESTA CAPA NO HACE, Y NO VA A HACER EN SILENCIO
 *
 * Si falta el indice compuesto de una consulta, Firestore devuelve
 * `failed-precondition` y aqui se propaga tal cual, con el enlace que crea el
 * indice. NO se reordena en memoria para «salvar» la llamada: esa amabilidad ya
 * costo cara en otro proyecto, porque una lista ordenada a mano sobre la primera
 * pagina parece correcta y no lo es. Fallar es lo util.
 */

export type DataError = { code: string; message: string };

type Outcome<T> = { data: T; error: DataError | null };

function toDataError(error: unknown): DataError {
  if (typeof error === 'object' && error !== null) {
    const source = error as { code?: unknown; message?: unknown };
    return {
      code: typeof source.code === 'string' ? source.code : 'unknown',
      message: typeof source.message === 'string' ? source.message : String(error),
    };
  }
  return { code: 'unknown', message: String(error) };
}

/**
 * Identidad de cada documento.
 *
 * Las tablas que en Postgres tenian clave primaria compuesta la conservan aqui como
 * id determinista. No es cosmetico: es lo que permite que las reglas de seguridad
 * hagan UN `get()` en vez de una consulta —una regla no puede consultar— y lo que
 * hace que `upsert` sea realmente idempotente sin leer antes.
 */
const COMPOSITE_IDS: Record<string, readonly string[]> = {
  organization_memberships: ['organization_id', 'user_id'],
  employee_location_assignments: ['employee_id', 'location_id'],
  employee_job_roles: ['employee_id', 'job_role_id'],
  notification_preferences: ['user_id', 'organization_id'],
  employee_pin_credentials: ['employee_id'],
  push_tokens: ['expo_token'],
};

export function documentId(table: string, row: DocumentData): string | null {
  const parts = COMPOSITE_IDS[table];
  if (parts === undefined) {
    return typeof row.id === 'string' ? row.id : null;
  }
  const values = parts.map((part) => row[part]);
  if (values.some((value) => typeof value !== 'string' || value === '')) return null;
  return values.join('_');
}

/**
 * LAS VISTAS DE SQL NO TIENEN EQUIVALENTE EN FIRESTORE y no se puede fingir que si.
 *
 * Las cinco eran uniones o agregaciones: «quien esta trabajando ahora» cruza sesiones
 * con empleados y turnos, «resumen diario» suma minutos por dia, «correcciones con
 * autor» traduce un uid a un nombre que el cliente no puede leer. Firestore no une ni
 * agrupa, asi que cada una es ahora una Cloud Function que devuelve EXACTAMENTE las
 * mismas filas.
 *
 * Se enrutan aqui, y no en los cinco puntos de llamada, para que las pantallas y sus
 * esquemas Zod no se enteren del cambio.
 */
const VIEW_FUNCTIONS: Record<string, string> = {
  employees_working_now: 'viewEmployeesWorkingNow',
  daily_time_summary: 'viewDailyTimeSummary',
  time_adjustments_with_author: 'viewTimeAdjustmentsWithAuthor',
  break_time_by_reason: 'viewBreakTimeByReason',
  kiosk_devices_admin: 'viewKioskDevicesAdmin',
};

/** Filtros y orden recogidos para mandarselos a la funcion que sirve la vista. */
type ViewRequest = {
  filters: { field: string; op: string; value: unknown }[];
  order: { field: string; ascending: boolean }[];
};

class ViewBuilder implements PromiseLike<Outcome<DocumentData[]>> {
  private readonly request: ViewRequest = { filters: [], order: [] };

  constructor(private readonly functionName: string) {}

  private add(op: string, field: string, value: unknown): this {
    this.request.filters.push({ field, op, value });
    return this;
  }

  select(_columns?: string): this {
    return this;
  }
  eq(field: string, value: unknown): this {
    return this.add('eq', field, value);
  }
  gte(field: string, value: unknown): this {
    return this.add('gte', field, value);
  }
  gt(field: string, value: unknown): this {
    return this.add('gt', field, value);
  }
  lte(field: string, value: unknown): this {
    return this.add('lte', field, value);
  }
  lt(field: string, value: unknown): this {
    return this.add('lt', field, value);
  }
  in(field: string, values: readonly unknown[]): this {
    return this.add('in', field, values);
  }
  order(field: string, options?: { ascending?: boolean }): this {
    this.request.order.push({ field, ascending: options?.ascending !== false });
    return this;
  }

  then<R1 = Outcome<DocumentData[]>, R2 = never>(
    onFulfilled?: ((value: Outcome<DocumentData[]>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return callFunction<DocumentData[]>(this.functionName, this.request)
      .then((outcome) => ({ data: outcome.data ?? [], error: outcome.error }))
      .then(onFulfilled, onRejected);
  }
}

const OPERATORS: Record<string, WhereFilterOp> = {
  eq: '==',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'in',
  contains: 'array-contains',
};

class SelectBuilder<T = DocumentData[]> implements PromiseLike<Outcome<T>> {
  private readonly constraints: QueryConstraint[] = [];
  /** Los mismos filtros en claro: un `QueryConstraint` ya montado no se puede leer. */
  private readonly filtros: { field: string; op: string; value: unknown }[] = [];
  private singleRow = false;
  private requireRow = false;
  /** `in` con lista vacia: no hay nada que consultar y no se toca la red. */
  private matchesNothing = false;

  constructor(
    private readonly db: Firestore,
    private readonly table: string,
  ) {}

  private add(op: keyof typeof OPERATORS, field: string, value: unknown): this {
    const operator = OPERATORS[op];
    if (operator === undefined) throw new Error(`Operador no soportado: ${op}`);
    this.constraints.push(where(field, operator, value));
    this.filtros.push({ field, op, value });
    return this;
  }

  eq(field: string, value: unknown): this {
    return this.add('eq', field, value);
  }
  neq(field: string, value: unknown): this {
    return this.add('neq', field, value);
  }
  gt(field: string, value: unknown): this {
    return this.add('gt', field, value);
  }
  gte(field: string, value: unknown): this {
    return this.add('gte', field, value);
  }
  lt(field: string, value: unknown): this {
    return this.add('lt', field, value);
  }
  lte(field: string, value: unknown): this {
    return this.add('lte', field, value);
  }
  in(field: string, values: readonly unknown[]): this {
    /**
     * `in` con lista vacia NO es «todo»: en Postgres devolvia cero filas y aqui
     * Firestore lanza un error de argumento. Se marca para devolver la lista vacia
     * sin tocar la red, que es la semantica que espera quien llama.
     */
    if (values.length === 0) {
      this.matchesNothing = true;
      return this;
    }
    return this.add('in', field, values);
  }
  contains(field: string, value: unknown): this {
    return this.add('contains', field, value);
  }

  order(field: string, options?: { ascending?: boolean }): this {
    this.constraints.push(orderBy(field, options?.ascending === false ? 'desc' : 'asc'));
    return this;
  }

  limit(count: number): this {
    this.constraints.push(limitTo(count));
    return this;
  }

  /** Proyeccion de columnas: la valida Zod al recibir, aqui no hace falta recortar. */
  select(_columns?: string): this {
    return this;
  }

  single(): SelectBuilder<DocumentData> {
    this.singleRow = true;
    this.requireRow = true;
    return this as unknown as SelectBuilder<DocumentData>;
  }

  maybeSingle(): SelectBuilder<DocumentData | null> {
    this.singleRow = true;
    return this as unknown as SelectBuilder<DocumentData | null>;
  }

  /**
   * `.eq('id', X)` a secas es UNA LECTURA DE DOCUMENTO, no una consulta.
   *
   * ESTO NO ES UNA OPTIMIZACION, ERA UN FALLO. La regla de `organizations` dice
   * `allow read: if isMember(orgId)`, donde `orgId` es el id del DOCUMENTO. Pedirlo
   * con `where('id', '==', ...)` convierte la lectura en una consulta sobre un campo,
   * y ahi esa regla no se resuelve igual: Firestore devolvia
   * `PERMISSION_DENIED` sobre un documento que el mismo usuario si podia leer
   * directamente. El panel entero decia «Falta un permiso» con la membresia correcta
   * en la base.
   *
   * Se encontro pidiendo las tres consultas del arranque con el token real del
   * usuario: membresias 200, ubicaciones 200, organizacion 403. Las otras dos filtran
   * por un CAMPO (`user_id`, `organization_id`) y por eso nunca fallaron.
   *
   * Ademas sale mas barato: una lectura en vez de una consulta, y sin indice.
   */
  private idDirecto(): string | null {
    if (this.filtros.length !== 1) return null;
    const unico = this.filtros[0];
    if (unico === undefined || unico.field !== 'id' || unico.op !== 'eq') return null;
    return typeof unico.value === 'string' && unico.value !== '' ? unico.value : null;
  }

  private async run(): Promise<Outcome<T>> {
    if (this.matchesNothing) {
      return { data: (this.singleRow ? null : []) as T, error: null };
    }

    const porId = this.idDirecto();
    if (porId !== null) {
      const snapshot = await getDoc(doc(this.db, this.table, porId));
      const fila = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;

      if (!this.singleRow) return { data: (fila === null ? [] : [fila]) as T, error: null };
      if (fila === null && this.requireRow) {
        return {
          data: null as T,
          error: { code: 'not-found', message: 'No se encontro ninguna fila.' },
        };
      }
      return { data: fila as T, error: null };
    }

    const snapshot = await getDocs(query(collection(this.db, this.table), ...this.constraints));
    const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!this.singleRow) return { data: rows as T, error: null };

    if (rows.length === 0) {
      if (this.requireRow) {
        return {
          data: null as T,
          error: { code: 'not-found', message: 'No se encontro ninguna fila.' },
        };
      }
      return { data: null as T, error: null };
    }
    return { data: rows[0] as T, error: null };
  }

  then<R1 = Outcome<T>, R2 = never>(
    onFulfilled?: ((value: Outcome<T>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run()
      .then((outcome) => outcome)
      .catch((error: unknown) => ({ data: null as T, error: toDataError(error) }))
      .then(onFulfilled, onRejected);
  }
}

class MutationBuilder implements PromiseLike<{ error: DataError | null }> {
  private readonly filters: { field: string; op: WhereFilterOp; value: unknown }[] = [];

  constructor(
    private readonly db: Firestore,
    private readonly table: string,
    private readonly kind: 'update' | 'delete',
    private readonly patch: DocumentData = {},
  ) {}

  eq(field: string, value: unknown): this {
    this.filters.push({ field, op: '==', value });
    return this;
  }

  in(field: string, values: readonly unknown[]): this {
    this.filters.push({ field, op: 'in', value: values });
    return this;
  }

  private async run(): Promise<{ error: DataError | null }> {
    /**
     * Firestore no tiene «update ... where»: hay que leer que documentos casan y
     * escribirlos. Por un solo filtro `eq('id', x)` se va directo al documento y se
     * ahorra la lectura; en los demas casos el lote es la unica forma, y va en lote
     * para que no queden mitades aplicadas.
     */
    const soloFiltro = this.filters.length === 1 ? this.filters[0] : undefined;
    const porId = soloFiltro !== undefined && soloFiltro.field === 'id' && soloFiltro.op === '==';

    if (porId && soloFiltro !== undefined) {
      const ref = doc(this.db, this.table, String(soloFiltro.value));
      if (this.kind === 'delete') await deleteDoc(ref);
      else await updateDoc(ref, { ...this.patch, updated_at: serverTimestamp() });
      return { error: null };
    }

    const snapshot = await getDocs(
      query(
        collection(this.db, this.table),
        ...this.filters.map((f) => where(f.field, f.op, f.value)),
      ),
    );

    const batch = writeBatch(this.db);
    snapshot.docs.forEach((found) => {
      if (this.kind === 'delete') batch.delete(found.ref);
      else batch.update(found.ref, { ...this.patch, updated_at: serverTimestamp() });
    });
    await batch.commit();
    return { error: null };
  }

  then<R1 = { error: DataError | null }, R2 = never>(
    onFulfilled?: ((value: { error: DataError | null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run()
      .catch((error: unknown) => ({ error: toDataError(error) }))
      .then(onFulfilled, onRejected);
  }
}

class WriteOnce implements PromiseLike<{ data: DocumentData | null; error: DataError | null }> {
  private wantsRow = false;

  constructor(private readonly work: () => Promise<DocumentData[]>) {}

  /** La proyeccion de columnas la valida Zod al recibir; aqui no hace falta recortar. */
  select(_columns?: string): this {
    return this;
  }

  /**
   * `insert(...).select('id').single()` DEVUELVE LA FILA CREADA, y dos sitios
   * dependen de ello: el alta de un empleado necesita su id para asignarle
   * ubicaciones y puestos acto seguido, y la apertura de un periodo devuelve el
   * periodo entero. Sin esto, la segunda mitad de esas dos operaciones se quedaba
   * sin el identificador que acababa de existir.
   */
  single(): this {
    this.wantsRow = true;
    return this;
  }

  then<R1 = { data: DocumentData | null; error: DataError | null }, R2 = never>(
    onFulfilled?:
      | ((value: { data: DocumentData | null; error: DataError | null }) => R1 | PromiseLike<R1>)
      | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.work()
      .then((rows) => ({
        data: this.wantsRow ? (rows[0] ?? null) : null,
        error: null as DataError | null,
      }))
      .catch((error: unknown) => ({ data: null, error: toDataError(error) }))
      .then(onFulfilled, onRejected);
  }
}

class Table {
  constructor(
    private readonly db: Firestore,
    private readonly table: string,
  ) {}

  /**
   * El desvio a las vistas va AQUI y no en `from()`, y la diferencia importa: si
   * `from()` devolviera una union, cada `.insert()`, `.update()` y `.limit()` de los
   * catorce `api.ts` dejaria de compilar contra un tipo que no los tiene. Las cinco
   * vistas solo se leen —se comprobo uno por uno—, asi que el desvio cabe entero en
   * el camino de lectura.
   */
  select(columns?: string): SelectBuilder {
    const viewFunction = VIEW_FUNCTIONS[this.table];
    if (viewFunction !== undefined) {
      return new ViewBuilder(viewFunction) as unknown as SelectBuilder;
    }
    return new SelectBuilder(this.db, this.table).select(columns);
  }

  insert(rows: DocumentData | DocumentData[]): WriteOnce {
    return new WriteOnce(async () => {
      const list = Array.isArray(rows) ? rows : [rows];
      const batch = writeBatch(this.db);
      const written: DocumentData[] = [];
      list.forEach((row) => {
        const id = documentId(this.table, row);
        const ref =
          id === null ? doc(collection(this.db, this.table)) : doc(this.db, this.table, id);
        const value = { ...row, id: ref.id, created_at: row.created_at ?? serverTimestamp() };
        batch.set(ref, value);
        written.push(value);
      });
      await batch.commit();
      return written;
    });
  }

  /**
   * `onConflict` no se lee: las columnas en conflicto YA son el id determinista de
   * `COMPOSITE_IDS`. Escribir con `merge` sobre ese id es exactamente lo que hacia
   * `on conflict do update`, y sin la lectura previa que haria falta para emularlo.
   */
  upsert(rows: DocumentData | DocumentData[], _options?: { onConflict?: string }): WriteOnce {
    return new WriteOnce(async () => {
      const list = Array.isArray(rows) ? rows : [rows];
      const batch = writeBatch(this.db);
      const written: DocumentData[] = [];
      list.forEach((row) => {
        const id = documentId(this.table, row);
        const ref =
          id === null ? doc(collection(this.db, this.table)) : doc(this.db, this.table, id);
        const value = { ...row, id: ref.id, updated_at: serverTimestamp() };
        batch.set(ref, value, { merge: true });
        written.push(value);
      });
      await batch.commit();
      return written;
    });
  }

  update(patch: DocumentData): MutationBuilder {
    return new MutationBuilder(this.db, this.table, 'update', patch);
  }

  delete(): MutationBuilder {
    return new MutationBuilder(this.db, this.table, 'delete');
  }
}

export class DataClient {
  constructor(private readonly db: Firestore) {}

  from(table: string): Table {
    return new Table(this.db, table);
  }

  /**
   * Lo que era `db.rpc(nombre, {p_algo: ...})`.
   *
   * El nombre se traduce de `snake_case` a `camelCase` porque asi se llaman las
   * Cloud Functions, y los parametros conservan su prefijo `p_`: cambiarlos aqui
   * obligaria a tocar los siete puntos de llamada sin ganar nada.
   */
  rpc(name: string, args?: Record<string, unknown>) {
    const callableName = name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return callFunction<unknown>(callableName, args ?? {});
  }

  /** Lo que era `db.functions.invoke(nombre, { body })`. */
  readonly functions = {
    invoke: (name: string, options?: { body?: unknown }) => {
      const callableName = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return callFunction<unknown>(callableName, options?.body ?? {});
    },
  };

  /** Lo que era `db.auth.getUser()`, con la misma forma anidada. */
  readonly auth = {
    getUser: async () => {
      const auth = getFirebaseAuth();
      await auth?.authStateReady();
      const user = auth?.currentUser ?? null;
      return {
        data: { user: user === null ? null : { id: user.uid, email: user.email } },
        error: null,
      };
    },
  };

  /** Lo que era `db.storage.from(bucket)`. Aqui los «buckets» son prefijos de ruta. */
  storage = {
    from: (prefix: string) => new StorageArea(prefix),
  };

  /** Un documento por id, sin pasar por una consulta que exigiria indice. */
  async byId(table: string, id: string): Promise<Outcome<DocumentData | null>> {
    try {
      const snapshot = await getDoc(doc(this.db, table, id));
      return {
        data: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null,
        error: null,
      };
    } catch (error) {
      return { data: null, error: toDataError(error) };
    }
  }
}

/**
 * Almacenamiento. Los dos «buckets» de Supabase son ahora dos prefijos del mismo
 * bucket de Firebase, con reglas opuestas en `storage.rules`: el logo se lee
 * publicamente y las fotos de fichaje no se leen nunca sin URL firmada.
 */
class StorageArea {
  constructor(private readonly prefix: string) {}

  async upload(
    path: string,
    body: Blob | Uint8Array | ArrayBuffer,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ error: DataError | null }> {
    const storage = getFirebaseStorage();
    if (storage === null) {
      return { error: { code: 'not-configured', message: 'Falta la configuración de Firebase.' } };
    }
    try {
      await uploadBytes(storageRef(storage, `${this.prefix}/${path}`), body, {
        contentType: options?.contentType,
      });
      return { error: null };
    } catch (error) {
      return { error: toDataError(error) };
    }
  }

  async remove(paths: string[]): Promise<{ error: DataError | null }> {
    const storage = getFirebaseStorage();
    if (storage === null) {
      return { error: { code: 'not-configured', message: 'Falta la configuración de Firebase.' } };
    }
    try {
      await Promise.all(
        paths.map((path) => deleteObject(storageRef(storage, `${this.prefix}/${path}`))),
      );
      return { error: null };
    } catch (error) {
      /**
       * Borrar algo que ya no esta NO es un fallo. Pasa al cambiar el logo dos veces
       * seguidas, y tratarlo como error dejaba la pantalla en rojo despues de una
       * operacion que si funciono.
       */
      const failure = toDataError(error);
      return { error: failure.code === 'storage/object-not-found' ? null : failure };
    }
  }

  /**
   * URL publica del logo. Firebase no tiene una URL «adivinable» como Supabase: hay
   * que pedirla, asi que esto devuelve la ruta de descarga canonica, que es publica
   * porque `storage.rules` deja leer ese prefijo a cualquiera.
   */
  getPublicUrl(path: string): { data: { publicUrl: string } } {
    const bucket = env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const fullPath = encodeURIComponent(`${this.prefix}/${path}`);
    return {
      data: {
        publicUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${fullPath}?alt=media`,
      },
    };
  }
}

/**
 * El cliente de datos, o `null` si falta configuracion.
 *
 * El desvio del modo demostracion va ANTES que nada, porque este es el unico punto
 * por el que pasa todo el acceso a datos de la app. Sustituyendo aqui, ninguna
 * pantalla, hook o feature necesita enterarse de que esta en demostracion: el resto
 * del codigo sigue hablando con lo que cree que es el backend de verdad.
 */
export function getDataClient(): DataClient | null {
  if (isDemoMode) return getDemoClient();
  const db = getDb();
  return db === null ? null : new DataClient(db);
}
