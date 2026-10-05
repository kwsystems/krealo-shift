/**
 * LAS FECHAS CON MÁS CLIENTES, SEGÚN EL TIPO DE TIENDA (4-oct).
 *
 * POR QUÉ EXISTE. Andree: «en el calendario sería bueno poner no solo los feriados sino los
 * días donde creemos que podría haber más gente en la tienda; somos tienda de juguetes de
 * niños, quizá el día del niño, Halloween… y un apartado en Ajustes donde poner qué tienda
 * es». Quien arma el horario pone más gente esos días si los ve al armarlo.
 *
 * NO SON FERIADOS y no cambian nada de lo que se paga: son un aviso para planificar. Por eso
 * van aparte de `feriados-peru.ts`, con otro color y otra palabra.
 *
 * SE CALCULAN, no se copian de una tabla, por lo mismo que los feriados: una tabla habría
 * que rellenarla cada año. Las que se mueven («el segundo domingo de abril», Black Friday)
 * tienen su regla. Las que cambian de un año a otro por decisión de alguien —Cyber Wow, los
 * días no laborables— no están: una lista de ellas estaría mal en cuanto saliera la siguiente.
 *
 * SOLO EN SEDES DEL PERÚ, como los feriados: son fechas del Perú (el Día del Niño Peruano es
 * el de la Ley 27666).
 */

export const TIPOS_DE_TIENDA = [
  'jugueteria',
  'ropa',
  'libreria',
  'restaurante',
  'general',
] as const;
export type TipoDeTienda = (typeof TIPOS_DE_TIENDA)[number];

export function esTipoDeTienda(valor: unknown): valor is TipoDeTienda {
  return typeof valor === 'string' && (TIPOS_DE_TIENDA as readonly string[]).includes(valor);
}

export const FECHAS_COMERCIALES = [
  'reyes',
  'sanValentin',
  'campanaEscolar',
  'diaDelNinoPeruano',
  'diaDeLaMadre',
  'diaDelPadre',
  'polloALaBrasa',
  'gratificacionJulio',
  'diaDelNino',
  'halloween',
  'blackFriday',
  'campanaNavidad',
  'nochevieja',
] as const;
export type ClaveDeFechaComercial = (typeof FECHAS_COMERCIALES)[number];

/** Domingo = 0 … sábado = 6, como `Date.getUTCDay()`. */
type Regla =
  | { tipo: 'fija'; mes: number; dia: number }
  /** El enésimo día de la semana del mes: «el segundo domingo de abril». */
  | { tipo: 'enesimo'; mes: number; diaSemana: number; n: number }
  /** Una temporada de varios días, dentro del mismo año. */
  | { tipo: 'temporada'; desde: [number, number]; hasta: [number, number] }
  /** El viernes después del cuarto jueves de noviembre. */
  | { tipo: 'blackFriday' };

const REGLAS: Record<ClaveDeFechaComercial, Regla> = {
  reyes: { tipo: 'fija', mes: 1, dia: 6 },
  sanValentin: { tipo: 'fija', mes: 2, dia: 14 },
  // Las clases empiezan en marzo: la compra fuerte va de mediados de febrero a mediados de marzo.
  campanaEscolar: { tipo: 'temporada', desde: [2, 15], hasta: [3, 15] },
  // Ley 27666: el segundo domingo de abril.
  diaDelNinoPeruano: { tipo: 'enesimo', mes: 4, diaSemana: 0, n: 2 },
  diaDeLaMadre: { tipo: 'enesimo', mes: 5, diaSemana: 0, n: 2 },
  diaDelPadre: { tipo: 'enesimo', mes: 6, diaSemana: 0, n: 3 },
  polloALaBrasa: { tipo: 'enesimo', mes: 7, diaSemana: 0, n: 3 },
  // La gratificación se paga hasta el 15 de julio (Ley 27735): se gasta antes de Fiestas Patrias.
  gratificacionJulio: { tipo: 'temporada', desde: [7, 15], hasta: [7, 27] },
  // El Día del Niño de agosto, el tercer domingo, que se sigue celebrando en las tiendas.
  diaDelNino: { tipo: 'enesimo', mes: 8, diaSemana: 0, n: 3 },
  halloween: { tipo: 'fija', mes: 10, dia: 31 },
  blackFriday: { tipo: 'blackFriday' },
  // La de diciembre se paga hasta el 15: de ahí a Nochebuena es lo más fuerte del año.
  campanaNavidad: { tipo: 'temporada', desde: [12, 15], hasta: [12, 24] },
  nochevieja: { tipo: 'fija', mes: 12, dia: 31 },
};

/** Qué fechas marca cada tipo de tienda, en el orden del año. */
export const FECHAS_POR_TIPO: Record<TipoDeTienda, readonly ClaveDeFechaComercial[]> = {
  jugueteria: [
    'reyes',
    'diaDelNinoPeruano',
    'diaDelNino',
    'halloween',
    'blackFriday',
    'campanaNavidad',
  ],
  ropa: [
    'diaDeLaMadre',
    'diaDelPadre',
    'gratificacionJulio',
    'blackFriday',
    'campanaNavidad',
    'nochevieja',
  ],
  libreria: ['campanaEscolar', 'diaDelNinoPeruano', 'diaDelNino', 'campanaNavidad'],
  restaurante: ['sanValentin', 'diaDeLaMadre', 'diaDelPadre', 'polloALaBrasa', 'nochevieja'],
  general: ['diaDeLaMadre', 'diaDelPadre', 'gratificacionJulio', 'blackFriday', 'campanaNavidad'],
};

const ZONAS_DEL_PERU = new Set(['America/Lima']);

function clave(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** El día del mes del enésimo `diaSemana` (0 = domingo). A mediodía UTC: ningún cambio de hora lo mueve. */
function enesimo(anio: number, mes: number, diaSemana: number, n: number): number {
  const primero = new Date(Date.UTC(anio, mes - 1, 1, 12)).getUTCDay();
  return 1 + ((diaSemana - primero + 7) % 7) + (n - 1) * 7;
}

/** Los días que ocupa una fecha en un año: uno, o varios si es una temporada. */
export function diasDeLaFecha(fecha: ClaveDeFechaComercial, anio: number): string[] {
  const regla = REGLAS[fecha];
  switch (regla.tipo) {
    case 'fija':
      return [clave(anio, regla.mes, regla.dia)];
    case 'enesimo':
      return [clave(anio, regla.mes, enesimo(anio, regla.mes, regla.diaSemana, regla.n))];
    case 'blackFriday':
      return [clave(anio, 11, enesimo(anio, 11, 4, 4) + 1)];
    case 'temporada': {
      const dias: string[] = [];
      const desde = Date.UTC(anio, regla.desde[0] - 1, regla.desde[1], 12);
      const hasta = Date.UTC(anio, regla.hasta[0] - 1, regla.hasta[1], 12);
      for (let t = desde; t <= hasta; t += 86400000) {
        const d = new Date(t);
        dias.push(clave(anio, d.getUTCMonth() + 1, d.getUTCDate()));
      }
      return dias;
    }
  }
}

/** ¿Dura varios días? Una temporada se dice distinto: «Campaña de Navidad», no un día suelto. */
export function esTemporada(fecha: ClaveDeFechaComercial): boolean {
  return REGLAS[fecha].tipo === 'temporada';
}

const porAnioYTipo = new Map<string, Map<string, ClaveDeFechaComercial>>();

/** Las fechas de un tipo de tienda en un año: «2026-04-12» → 'diaDelNinoPeruano'. */
export function fechasDelAnio(
  tipo: TipoDeTienda,
  anio: number,
): Map<string, ClaveDeFechaComercial> {
  const llave = `${tipo}|${anio}`;
  const guardado = porAnioYTipo.get(llave);
  if (guardado !== undefined) return guardado;
  const mapa = new Map<string, ClaveDeFechaComercial>();
  // Una fecha de un día manda sobre la temporada en la que cae: Nochebuena dice su nombre.
  for (const fecha of FECHAS_POR_TIPO[tipo].filter(esTemporada)) {
    for (const dia of diasDeLaFecha(fecha, anio)) mapa.set(dia, fecha);
  }
  for (const fecha of FECHAS_POR_TIPO[tipo].filter((f) => !esTemporada(f))) {
    for (const dia of diasDeLaFecha(fecha, anio)) mapa.set(dia, fecha);
  }
  porAnioYTipo.set(llave, mapa);
  return mapa;
}

/**
 * La fecha comercial de un día en una sede, o `null`: sin tipo de tienda elegido, fuera del
 * Perú o en un día cualquiera. `dateKey` es el día del calendario de la sede.
 */
export function fechaComercialDe(
  dateKey: string,
  zona: string,
  tipo: TipoDeTienda | null | undefined,
): ClaveDeFechaComercial | null {
  if (tipo === null || tipo === undefined || !ZONAS_DEL_PERU.has(zona)) return null;
  const anio = Number(dateKey.slice(0, 4));
  if (!Number.isInteger(anio)) return null;
  return fechasDelAnio(tipo, anio).get(dateKey) ?? null;
}
