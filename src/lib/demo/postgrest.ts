/**
 * El trocito de PostgREST que esta app usa de verdad (modo demostración).
 *
 * NO ES UN CLON DE POSTGREST, y no pretende serlo. Se barrieron las 53 llamadas del
 * proyecto y el vocabulario real resultó ser cerrado y pequeño: `select`, `eq`, `neq`,
 * `in`, `gte`, `lte`, `lt`, `order`, `limit`, `single`, más `insert`, `update`, `upsert`
 * y `delete`. No hay `or`, ni `ilike`, ni selects con relaciones anidadas. Implementar
 * eso es abarcable; implementar PostgREST entero no lo sería, y tampoco haría falta.
 *
 * Un operador que la app NO use hoy no está aquí a propósito: si mañana alguien lo
 * escribe, esto falla ruidosamente en su cara (ver `noImplementado`) en vez de devolver
 * filas silenciosamente mal filtradas. Un backend de mentira que miente sobre sus
 * propios límites es la peor variante posible de esta idea.
 */

export type Fila = Record<string, unknown>;

/**
 * Identificadores de las filas creadas durante la demostracion.
 *
 * Llevan el nombre de la tabla para que un id suelto en una captura diga de donde sale,
 * y un contador global para que dos tablas no puedan repetirlo. No pretende parecerse a
 * un id de Firestore: si alguien lo ve, tiene que saber que es de mentira.
 */
let contadorDeIds = 0;
const nuevoId = (tabla: string): string => {
  contadorDeIds += 1;
  return `demo-${tabla}-${contadorDeIds}`;
};

export type ErrorPostgrest = {
  message: string;
  details: string;
  hint: string;
  code: string;
};

export type Resultado<T> = { data: T; error: ErrorPostgrest | null };

/** Almacén en memoria: nombre de tabla o vista -> filas. */
export type Almacen = Map<string, Fila[]>;

function noImplementado(operador: string): never {
  throw new Error(
    `Modo demostración: el operador "${operador}" no está implementado. ` +
      'Añádelo en src/lib/demo/postgrest.ts en vez de dejar que devuelva datos mal filtrados.',
  );
}

function error(code: string, message: string): ErrorPostgrest {
  return { code, message, details: '', hint: '' };
}

type Filtro = (fila: Fila) => boolean;

function comparables(a: unknown, b: unknown): [number, number] | null {
  if (typeof a === 'number' && typeof b === 'number') return [a, b];
  if (typeof a === 'string' && typeof b === 'string') {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return [ta, tb];
    return [a < b ? -1 : a > b ? 1 : 0, 0];
  }
  return null;
}

/**
 * Consulta encadenable. Es "thenable": se resuelve al usarla con `await`, igual que el
 * constructor de supabase-js, que tampoco devuelve promesas hasta que se espera.
 */
export class ConsultaDemo<T = Fila[]> implements PromiseLike<Resultado<T>> {
  private filtros: Filtro[] = [];
  private columnas: string[] | null = null;
  private orden: { campo: string; ascendente: boolean } | null = null;
  private tope: number | null = null;
  private unica: 'single' | 'maybeSingle' | null = null;

  constructor(
    private readonly nombre: string,
    private readonly almacen: Almacen,
    private readonly operacion: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select',
    private readonly carga: Fila[] = [],
  ) {}

  private get filas(): Fila[] {
    return this.almacen.get(this.nombre) ?? [];
  }

  select(columnas?: string): this {
    if (typeof columnas === 'string' && columnas.trim() !== '' && columnas.trim() !== '*') {
      if (columnas.includes('(')) noImplementado(`select con relación anidada: ${columnas}`);
      this.columnas = columnas.split(',').map((c) => c.trim());
    }
    return this;
  }

  eq(campo: string, valor: unknown): this {
    this.filtros.push((fila) => fila[campo] === valor);
    return this;
  }

  neq(campo: string, valor: unknown): this {
    this.filtros.push((fila) => fila[campo] !== valor);
    return this;
  }

  in(campo: string, valores: readonly unknown[]): this {
    const conjunto = new Set(valores);
    this.filtros.push((fila) => conjunto.has(fila[campo]));
    return this;
  }

  is(campo: string, valor: null | boolean): this {
    this.filtros.push((fila) => (fila[campo] ?? null) === valor);
    return this;
  }

  gte(campo: string, valor: unknown): this {
    return this.comparar(campo, valor, (a, b) => a >= b);
  }

  gt(campo: string, valor: unknown): this {
    return this.comparar(campo, valor, (a, b) => a > b);
  }

  lte(campo: string, valor: unknown): this {
    return this.comparar(campo, valor, (a, b) => a <= b);
  }

  lt(campo: string, valor: unknown): this {
    return this.comparar(campo, valor, (a, b) => a < b);
  }

  private comparar(campo: string, valor: unknown, cumple: (a: number, b: number) => boolean): this {
    this.filtros.push((fila) => {
      const par = comparables(fila[campo], valor);
      return par === null ? false : cumple(par[0], par[1]);
    });
    return this;
  }

  order(campo: string, opciones?: { ascending?: boolean }): this {
    this.orden = { campo, ascendente: opciones?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.tope = n;
    return this;
  }

  single(): ConsultaDemo<T> {
    this.unica = 'single';
    return this;
  }

  maybeSingle(): ConsultaDemo<T> {
    this.unica = 'maybeSingle';
    return this;
  }

  private proyectar(fila: Fila): Fila {
    if (this.columnas === null) return { ...fila };
    const salida: Fila = {};
    for (const columna of this.columnas) salida[columna] = fila[columna];
    return salida;
  }

  private leer(): Fila[] {
    let filas = this.filas.filter((fila) => this.filtros.every((cumple) => cumple(fila)));
    const orden = this.orden;
    if (orden !== null) {
      filas = [...filas].sort((a, b) => {
        const par = comparables(a[orden.campo], b[orden.campo]);
        if (par === null) return 0;
        const signo = par[0] === par[1] ? 0 : par[0] < par[1] ? -1 : 1;
        return orden.ascendente ? signo : -signo;
      });
    }
    if (this.tope !== null) filas = filas.slice(0, this.tope);
    return filas.map((fila) => this.proyectar(fila));
  }

  /**
   * Claves de `upsert(fila, { onConflict })`. Sin esto, guardar dos veces las
   * preferencias de notificación dejaba dos filas y la segunda lectura devolvía la
   * vieja: el interruptor volvía solo a su sitio y parecía que no se guardaba nada.
   */
  private conflicto: string[] = [];

  conflictoEn(columnas: string[]): this {
    this.conflicto = columnas;
    return this;
  }

  private escribir(): { error: ErrorPostgrest | null; creadas: Fila[] } {
    const actuales = this.almacen.get(this.nombre) ?? [];

    if (this.operacion === 'insert' || this.operacion === 'upsert') {
      /*
       * EL ID LO PONE LA BASE, y aquí no lo ponía nadie.
       *
       * El adaptador real genera la referencia del documento al insertar y devuelve la
       * fila creada, y dos altas de la app dependen de ello: `createEmployee` necesita
       * el id para asignarle ubicaciones y puestos, y `createLocation` para ofrecer la
       * sede recién abierta. En la demostración la fila se guardaba tal cual —sin id— y
       * `insert(...).select('id').single()` devolvía `null`, así que las dos altas
       * fallaban con «expected object, received null», un error de Zod que no menciona
       * en ningún momento que el problema sea el backend de mentira.
       *
       * O sea que la demostración no podía dar de alta NADA, y eso lo escondía: es la
       * superficie contra la que se verifica todo lo demás.
       */
      const nuevas: Fila[] = this.carga.map((fila) => ({
        ...fila,
        id: fila.id ?? nuevoId(this.nombre),
        created_at: fila.created_at ?? new Date().toISOString(),
      }));
      const clave = this.conflicto;
      const conserva =
        this.operacion === 'upsert' && clave.length > 0
          ? actuales.filter(
              (fila) => !nuevas.some((nueva) => clave.every((c) => fila[c] === nueva[c])),
            )
          : actuales;
      this.almacen.set(this.nombre, [...conserva, ...nuevas]);
      return { error: null, creadas: nuevas };
    }

    const alcanzadas = (fila: Fila) => this.filtros.every((cumple) => cumple(fila));

    if (this.operacion === 'delete') {
      this.almacen.set(
        this.nombre,
        actuales.filter((fila) => !alcanzadas(fila)),
      );
      return { error: null, creadas: [] };
    }

    // update
    const parche = this.carga[0] ?? {};
    this.almacen.set(
      this.nombre,
      actuales.map((fila) => (alcanzadas(fila) ? { ...fila, ...parche } : fila)),
    );
    return { error: null, creadas: [] };
  }

  then<R1 = Resultado<T>, R2 = never>(
    alResolver?: ((valor: Resultado<T>) => R1 | PromiseLike<R1>) | null,
    alRechazar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then((): Resultado<T> => {
        if (this.operacion !== 'select') {
          const { error: fallo, creadas } = this.escribir();
          if (fallo !== null) return { data: null as T, error: fallo };
          // Sin `select()` encadenado no se espera ningun dato: se conserva `null`,
          // que es lo que devuelven los `update(...).eq(...)` de toda la app.
          if (this.columnas === null && this.unica === null) {
            return { data: null as T, error: null };
          }
          const proyectadas = creadas.map((fila) => this.proyectar(fila));
          if (this.unica !== null) {
            return proyectadas.length === 1
              ? { data: proyectadas[0] as T, error: null }
              : {
                  data: null as T,
                  error: error('PGRST116', `se esperaba una fila y hay ${proyectadas.length}`),
                };
          }
          return { data: proyectadas as T, error: null };
        }

        const filas = this.leer();

        if (this.unica !== null) {
          if (filas.length === 1) return { data: filas[0] as T, error: null };
          if (filas.length === 0) {
            return this.unica === 'maybeSingle'
              ? { data: null as T, error: null }
              : // Mismo código que PostgREST: la app lo traduce a "no encontrado".
                { data: null as T, error: error('PGRST116', 'no se encontró ninguna fila') };
          }
          return {
            data: null as T,
            error: error('PGRST116', `se esperaba una fila y hay ${filas.length}`),
          };
        }

        return { data: filas as T, error: null };
      })
      .then(alResolver, alRechazar);
  }
}

/** Puerta de entrada: `db.from('tabla')`, con la misma forma que supabase-js. */
export function crearFrom(almacen: Almacen) {
  return (nombre: string) => ({
    select: (columnas?: string) => new ConsultaDemo(nombre, almacen).select(columnas),
    insert: (filas: Fila | Fila[]) =>
      new ConsultaDemo(nombre, almacen, 'insert', Array.isArray(filas) ? filas : [filas]),
    upsert: (filas: Fila | Fila[], opciones?: { onConflict?: string }) =>
      new ConsultaDemo(
        nombre,
        almacen,
        'upsert',
        Array.isArray(filas) ? filas : [filas],
      ).conflictoEn(
        typeof opciones?.onConflict === 'string'
          ? opciones.onConflict.split(',').map((c) => c.trim())
          : [],
      ),
    update: (parche: Fila) => new ConsultaDemo(nombre, almacen, 'update', [parche]),
    delete: () => new ConsultaDemo(nombre, almacen, 'delete'),
  });
}
