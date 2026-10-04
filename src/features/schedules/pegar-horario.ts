import { detectOverlaps, JORNADA_MAXIMA_MINUTOS, type ScheduledShift } from './conflicts';
import { localTimeToMinutes, minutesToLocalTime, shiftInstants, type DateKey } from './week';

/**
 * Pegar una semana entera de horario desde una tabla.
 *
 * POR QUE EXISTE. El horario semanal nace FUERA de la app: quien lo decide lo escribe
 * en una tabla —una hoja de cálculo, un mensaje, un documento— y hasta ahora entrarlo
 * significaba abrir el formulario de turno una vez por turno. Una semana normal de cinco
 * personas son 25 turnos, y cada uno pide persona, día, entrada, salida y descanso: del
 * orden de 150 campos para copiar algo que ya está escrito y correcto. Eso no es un
 * detalle de comodidad, es la razón por la que un horario se entra tarde o no se entra:
 * el trabajo de teclearlo es mayor que el de decidirlo.
 *
 * Esto lee la tabla tal como se pega y produce los turnos. La app deja de pedir que le
 * dicten lo que ya está escrito.
 *
 * DOS DECISIONES QUE HACEN QUE SEA FIABLE Y NO SOLO RAPIDO:
 *
 *   1. LOS TOTALES DE LA TABLA SE USAN COMO ORACULO. Casi todas las tablas de horario
 *      llevan una columna de horas por persona, calculada por quien lo hizo. Si está,
 *      se compara con lo que sale de los turnos leídos: coincidir es la prueba de que
 *      se entendió la tabla, y discrepar es un aviso ANTES de crear nada. Sin eso,
 *      leer «17:30» como «7:30» produce un horario plausible y equivocado.
 *
 *   2. LAS FECHAS DE LA CABECERA SE COMPRUEBAN CONTRA LA SEMANA QUE SE ESTA VIENDO.
 *      El error más fácil de cometer y el más difícil de ver: pegar la tabla de la
 *      semana siguiente estando en la semana actual. Los 25 turnos entran sin una
 *      queja, siete días corridos, y el horario está entero pero mal. Si la cabecera
 *      trae los días del mes, un desajuste bloquea.
 *
 * NO ADIVINA EL DESCANSO: lo aplica por regla, y la regla es visible. Un turno de 8 h o
 * más lleva una hora de refrigerio no pagado; menos de 8 h, ninguna. Es lo que hace que
 * seis días de 10:00 a 19:00 sumen 48 h y no 54, y es también lo que se puede afinar
 * turno a turno después, en el formulario de siempre.
 */

/** Jornada a partir de la cual el turno lleva refrigerio no pagado. */
export const JORNADA_CON_REFRIGERIO_MINUTOS = 8 * 60;

/** Duración del refrigerio no pagado de una jornada larga. */
export const REFRIGERIO_MINUTOS = 60;

/**
 * El descanso que le toca a un turno por su duración bruta.
 *
 * VIVE AQUI Y SOLO AQUI. Estaba escrito a mano en la prueba de la semana real, que es
 * donde se descubrió la regla: los totales de la tienda solo cuadran restando una hora
 * a los turnos largos. Una regla de negocio copiada en dos sitios acaba discrepando
 * consigo misma, y esta decide las horas que se pagan.
 */
export function refrigerioDeUnTurno(minutosBrutos: number): number {
  return minutosBrutos >= JORNADA_CON_REFRIGERIO_MINUTOS ? REFRIGERIO_MINUTOS : 0;
}

export type EmpleadoConocido = {
  id: string;
  nombre: string;
  /** Puesto que se le pone al turno. El de la persona, porque la tabla no lo trae. */
  jobRoleId: string | null;
};

export type TurnoPegado = {
  employeeId: string;
  nombre: string;
  jobRoleId: string | null;
  dateKey: DateKey;
  startTime: string;
  endTime: string;
  plannedUnpaidBreakMinutes: number;
  /** Minutos que cuentan: duración menos refrigerio. */
  minutosNetos: number;
  cruzaMedianoche: boolean;
};

/**
 * Un día libre marcado A PROPOSITO, que no es lo mismo que una celda vacía.
 *
 * LA TABLA DISTINGUE LAS DOS COSAS Y LA APP TENIA QUE DEJAR DE PERDERLO. «DESCANSO»
 * dice «esta persona trabaja esta semana y este día lo tiene libre»; una raya o una
 * celda en blanco dicen «aquí no hay nada», que es el caso de quien ya no sigue en la
 * tienda o de un hueco que todavía no se ha decidido. En la rejilla las tres se veían
 * igual —un hueco con un «+»— y con eso no se puede ni repartir el horario («¿cuándo
 * descanso?») ni revisarlo («¿esto es un día libre o me falta cubrirlo?»).
 */
export type DescansoPegado = {
  employeeId: string;
  nombre: string;
  dateKey: DateKey;
};

export type ProblemaPegado =
  | { clave: 'nadaQueLeer' }
  | { clave: 'nombreDesconocido'; texto: string }
  | { clave: 'nombreAmbiguo'; texto: string; candidatos: string[] }
  | { clave: 'celdaIlegible'; nombre: string; dia: DateKey; texto: string }
  | { clave: 'semanaDistinta'; dias: string; cabecera: string }
  | { clave: 'solape'; nombre: string }
  | { clave: 'personaRepetida'; nombre: string; filas: string[] }
  | { clave: 'turnoImposible'; nombre: string; dia: DateKey; texto: string; minutos: number }
  | { clave: 'nocheLarga'; nombre: string; dia: DateKey; texto: string; minutos: number }
  | { clave: 'totalDiscrepa'; nombre: string; leido: number; declarado: number };

export type ResumenPegado = {
  employeeId: string;
  nombre: string;
  turnos: number;
  descansos: number;
  minutos: number;
  /** Total que declara la tabla, si traía columna de horas. */
  minutosDeclarados: number | null;
};

export type HorarioPegado = {
  turnos: TurnoPegado[];
  descansos: DescansoPegado[];
  problemas: ProblemaPegado[];
  resumen: ResumenPegado[];
};

/**
 * Qué impide crear y qué solo avisa.
 *
 * Bloquea lo que produciría un horario EQUIVOCADO sin que nadie se entere: un nombre que
 * no se pudo resolver, una celda que no se entendió, la semana cambiada, dos turnos
 * encima, la misma persona en dos filas, un turno que ninguna tienda tiene. Avisa —sin
 * bloquear— cuando los totales de la tabla no cuadran con lo leído: ahí el equivocado
 * puede ser cualquiera de los dos lados, y la suma la calculó una persona. Decidir eso no
 * es del programa. Y avisa de un turno de noche largo, que existe pero casi siempre es
 * una hora de salida mal escrita.
 */
export function problemaBloquea(problema: ProblemaPegado): boolean {
  return problema.clave !== 'totalDiscrepa' && problema.clave !== 'nocheLarga';
}

/**
 * Un turno que pasa la medianoche y dura más que esto se avisa. «18:00–02:00» es un cierre
 * de verdad; «13:00–03:00» casi siempre es «13:00–23:00» escrito con prisa.
 */
export const NOCHE_LARGA_MINUTOS = 12 * 60;

/** Dice «este día lo tiene libre», y eso se guarda. */
const PALABRAS_DE_DESCANSO = new Set([
  'descanso',
  'descansa',
  'dialibre',
  'diadelibre',
  'franco',
  'libre',
  'off',
  'x',
]);

/**
 * Dice «aquí no hay nada», y eso NO se guarda: es el jueves de quien dejó la tienda el
 * miércoles. Marcarlo como descanso la dejaría apareciendo en la plantilla de la semana
 * siguiente con un hueco que nadie tiene que cubrir, o peor, que alguien cubriría.
 */
const CELDAS_VACIAS = new Set(['', '-', '.', ':', '·', '*']);

const PALABRAS_DE_CABECERA = new Set([
  'personal',
  'empleado',
  'empleada',
  'employee',
  'equipo',
  'name',
  'nombre',
  'staff',
  'vendedora',
]);

/**
 * ¿Suena a nombre de día? Para reconocer la fila de cabecera («Lun 28 Sep»).
 *
 * LAS INICIALES SUELTAS SOLO VALEN SI LA CELDA ES ESA LETRA Y NADA MAS, y esto costó un
 * fallo de verdad: la versión anterior aceptaba la letra como PREFIJO, así que «LIBRE»
 * parecía lunes, «X» miércoles y «día libre» domingo. Con tres de esas en una fila, la
 * fila entera pasaba por cabecera y se descartaba en silencio: quien tuviera la semana
 * libre desaparecía de lo pegado sin un aviso. Lo cazó la prueba de las otras formas de
 * escribir «descanso»; leyendo el código parecía correcto.
 */
function suenaADia(celda: string): boolean {
  const texto = normalizar(celda);
  if (/^[lmxjvsd]$/.test(texto)) return true;
  // Una fecha sola también es un día: «2026-09-28», «28/09», «28/09/2026».
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(texto) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(texto)) {
    return true;
  }
  return /^(lun|mar|mie|jue|vie|sab|dom|mon|tue|wed|thu|fri|sat|sun)/.test(texto);
}

/** Sin acentos, sin mayúsculas y sin espacios de más: para comparar, nunca para mostrar. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Todos los guiones del mundo son el mismo guion. */
function unGuion(texto: string): string {
  return texto.replace(/[‐-―−]/g, '-');
}

/**
 * Las celdas de una línea.
 *
 * El camino normal es el tabulador: una tabla copiada de una hoja de cálculo, de un
 * documento o de un mensaje llega así. La barra y el punto y coma también separan. Dos
 * espacios o más también, porque una tabla escrita a mano se alinea con espacios.
 *
 * CON TABULADOR, BARRA O PUNTO Y COMA, UNA CELDA VACIA ES UNA CELDA (4-oct). Antes se
 * partía por «uno o más» separadores y los huecos se tiraban, así que el martes vacío de
 * una fila desaparecía y el miércoles caía en martes, el jueves en miércoles…: los mismos
 * turnos y las mismas horas —la vista previa decía «cuadra con tu tabla»— en días que la
 * tabla no decía. Con espacios no se puede saber dónde estaba el hueco, y ahí se sigue
 * como antes.
 *
 * Y HAY UN CAMINO DE RESERVA para la línea escrita con UN espacio —«Ana DESCANSO
 * 10:00-19:00 …»—, que con las reglas de arriba sería una sola celda. Ahí se parte por
 * fichas: lo que va antes de la primera celda reconocible es el nombre, y cada ficha
 * siguiente es un día. Sin esto, escribir el horario a mano en el propio cuadro de texto
 * —lo más natural del mundo— no funcionaría.
 */
function celdasDeLinea(linea: string): { celdas: string[]; conHuecos: boolean } {
  const conHuecos = celdasConHuecos(linea);
  const porSeparador =
    conHuecos ??
    linea
      .split(/\s{2,}/)
      .map((celda) => celda.trim())
      .filter((celda) => celda !== '');
  const llenas = porSeparador.filter((celda) => celda !== '');

  /*
   * DOS CELDAS TAMBIEN VALEN si la segunda es un día reconocible, y no es un detalle:
   * «Ana<tab>10:00-13:00 / 17:00-21:00» son exactamente dos, y exigir tres mandaba esa
   * línea al camino de reserva, que partía el turno partido en DOS DIAS DISTINTOS. Salía
   * el número de turnos correcto y las horas correctas —por eso la prueba lo dejó pasar
   * al principio— con los turnos en días que la tabla no decía.
   */
  if (porSeparador.length >= 3 && llenas.length >= 2) {
    return { celdas: porSeparador, conHuecos: conHuecos !== null };
  }
  if (porSeparador.length === 2 && esCeldaDeDia(porSeparador[1] ?? '')) {
    return { celdas: porSeparador, conHuecos: conHuecos !== null };
  }

  const fichas = unGuion(linea.replace(/[\t|;]/g, ' '))
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .split(/\s+/)
    .filter((ficha) => ficha !== '');

  const celdas: string[] = [];
  const nombre: string[] = [];
  for (const ficha of fichas) {
    if (celdas.length === 0 && !esCeldaDeDia(ficha)) {
      nombre.push(ficha);
      continue;
    }
    if (celdas.length === 0) celdas.push(nombre.join(' '));
    celdas.push(ficha);
  }
  if (celdas.length === 0 && nombre.length > 0) celdas.push(nombre.join(' '));
  return celdas.length >= 2 ? { celdas, conHuecos: false } : { celdas: llenas, conHuecos: false };
}

/**
 * Las celdas de una línea con separador explícito, CONSERVANDO LAS VACIAS; `null` si la
 * línea no lo tiene. Lo de la derecha que está vacío se quita: es la cola de la hoja de
 * cálculo, no un día. La barra de los bordes de una tabla «| Ana | … |» tampoco es celda.
 */
function celdasConHuecos(linea: string): string[] | null {
  let celdas: string[];
  if (linea.includes('\t')) {
    celdas = linea.split('\t');
  } else if (linea.includes('|')) {
    const sinBordes = linea.trim().replace(/^\|/, '').replace(/\|$/, '');
    celdas = sinBordes.split('|');
  } else if (linea.includes(';')) {
    celdas = linea.split(';');
  } else {
    return null;
  }
  const limpias = celdas.map((celda) => celda.trim());
  while (limpias.length > 0 && limpias[limpias.length - 1] === '') limpias.pop();
  return limpias;
}

/**
 * Cuántas columnas vacías hay a la izquierda de TODA la tabla: una hoja con la primera
 * columna en blanco se pega así, y entonces el nombre está en la segunda. Se mira el
 * mínimo de todas las filas, no cada fila por su cuenta, porque la cabecera tiene una más
 * —la esquina vacía encima de los nombres— y quitársela corría los días un puesto.
 */
function columnasVaciasDelante(filas: { celdas: string[]; conHuecos: boolean }[]): number {
  const cuentas = filas
    .filter((fila) => fila.conHuecos && fila.celdas.some((celda) => celda !== ''))
    .map((fila) => fila.celdas.findIndex((celda) => celda !== ''));
  return cuentas.length === 0 ? 0 : Math.min(...cuentas);
}

const RANGO = /^(\d{1,2})[:.h](\d{2})-(\d{1,2})[:.h](\d{2})$/;

/** Una celda es de día si se entiende: horas, descanso o vacía. */
function esCeldaDeDia(celda: string): boolean {
  return leerCelda(celda) !== null;
}

type Rango = { startTime: string; endTime: string };

/**
 * TRES RESULTADOS Y UN FALLO, y hacen falta los cuatro. Antes eran dos —«rangos» o
 * «lista vacía»— y la lista vacía significaba a la vez «descanso» y «aquí no hay nada»:
 * el importador no podía distinguir un día libre del jueves de quien ya no
 * trabaja. `null` sigue siendo «no lo entendí», que no es ninguno de los tres.
 */
type Celda = { tipo: 'turnos'; rangos: Rango[] } | { tipo: 'descanso' } | { tipo: 'vacia' };

function leerCelda(celda: string): Celda | null {
  const limpia = unGuion(celda)
    .replace(/\s+/g, '')
    .replace(/a(?=\d)/gi, '-');
  const palabra = normalizar(limpia);
  if (PALABRAS_DE_DESCANSO.has(palabra)) return { tipo: 'descanso' };
  if (CELDAS_VACIAS.has(palabra)) return { tipo: 'vacia' };

  const rangos: Rango[] = [];
  for (const parte of limpia.split('/')) {
    const suelta = normalizar(parte);
    // «10:00-13:00 / descanso» es un turno con ruido, no medio descanso.
    if (PALABRAS_DE_DESCANSO.has(suelta) || CELDAS_VACIAS.has(suelta)) continue;
    const trozos = RANGO.exec(parte);
    if (trozos === null) return null;
    const inicio = localTimeToMinutes(`${trozos[1]}:${trozos[2]}`);
    const fin = localTimeToMinutes(`${trozos[3]}:${trozos[4]}`);
    if (inicio === null || fin === null) return null;
    rangos.push({ startTime: minutesToLocalTime(inicio), endTime: minutesToLocalTime(fin) });
  }
  return rangos.length === 0 ? { tipo: 'vacia' } : { tipo: 'turnos', rangos };
}

/** «48h» → 2880. «23.5 h» → 1410. Sin la «h» no es un total: es un día. */
function totalDeclarado(celda: string): number | null {
  const trozos = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*h(?:rs?|oras?)?$/i.exec(celda.trim());
  if (trozos === null) return null;
  const horas = Number(trozos[1]);
  const fraccion = trozos[2] === undefined ? 0 : Number(`0.${trozos[2]}`);
  return Math.round((horas + fraccion) * 60);
}

/**
 * El nombre sin el contrato ni el puesto, vaya detrás o delante: «Ana – FT» → «Ana», y
 * «Full Time: Ana» → «Ana». Lo de delante lleva dos puntos en la tabla de la tienda
 * (30-sep); sin quitarlo, ninguna fila se reconocía. Una celda de nombre nunca trae una
 * hora, así que los dos puntos no se confunden con los de «10:00».
 */
function nombreDeCelda(celda: string): string {
  const sinParentesis = celda.replace(/\([^)]*\)/g, ' ');
  const dosPuntos = sinParentesis.lastIndexOf(':');
  const trasElContrato =
    dosPuntos >= 0 && sinParentesis.slice(dosPuntos + 1).trim() !== ''
      ? sinParentesis.slice(dosPuntos + 1)
      : sinParentesis;
  const cortado = unGuion(trasElContrato).split(/\s+-\s*|\s*-\s+/)[0] ?? '';
  return cortado.replace(/[·,:]+$/, '').trim();
}

function diaDelMes(dia: DateKey): number {
  return Number(dia.slice(8, 10));
}

/**
 * La cabecera, si la línea lo es: ninguna celda de día y varias que hablan de días.
 * Devuelve los números de día que anuncia, en orden, para poder compararlos.
 */
function numerosDeCabecera(celdas: string[]): number[] | null {
  const candidatas = celdas
    .slice(1)
    .filter((celda) => celda !== '' && totalDeclarado(celda) === null);
  if (candidatas.length < 3) return null;
  /*
   * HORAS O DESCANSO ⇒ ES UNA FILA DE HORARIO, NO UNA CABECERA. Lo segundo importa tanto
   * como lo primero: una cabecera nunca dice «DESCANSO», y mirarlo aquí desambigua la
   * «X» —que en una cabecera es miércoles y en una celda es día libre— sin tener que
   * adivinar por el contexto.
   */
  if (
    candidatas.some((celda) => {
      const tipo = leerCelda(celda)?.tipo;
      return tipo === 'turnos' || tipo === 'descanso';
    })
  ) {
    return null;
  }

  const primera = normalizar(nombreDeCelda(celdas[0] ?? ''));
  const suenaACabecera =
    PALABRAS_DE_CABECERA.has(primera) || candidatas.filter((celda) => suenaADia(celda)).length >= 3;
  if (!suenaACabecera) return null;

  const numeros: number[] = [];
  for (const celda of candidatas) {
    const numero = diaDeLaCabecera(celda);
    if (numero !== null) numeros.push(numero);
  }
  return numeros;
}

/**
 * El día del mes que dice una celda de cabecera. «2026-09-28» es el 28, no el 9: el primer
 * número suelto de esa fecha es el MES, y leerlo así hacía decir «esa tabla es de otra
 * semana» a una tabla que era de esta. «28/09» es el 28 (día y mes, como se escribe aquí);
 * «09/28» también, porque no hay mes 28.
 */
function diaDeLaCabecera(celda: string): number | null {
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(celda);
  if (iso !== null) return Number(iso[3]);
  const barra = /\b(\d{1,2})\/(\d{1,2})\b/.exec(celda);
  if (barra !== null) {
    const primero = Number(barra[1]);
    const segundo = Number(barra[2]);
    return primero <= 12 && segundo > 12 ? segundo : primero;
  }
  const suelto = /\b(\d{1,2})\b/.exec(celda);
  return suelto === null ? null : Number(suelto[1]);
}

function empleadoDelTexto(
  texto: string,
  empleados: EmpleadoConocido[],
): { encontrado: EmpleadoConocido | null; candidatos: EmpleadoConocido[] } {
  const buscado = normalizar(texto);
  if (buscado === '') return { encontrado: null, candidatos: [] };

  const unico = (lista: EmpleadoConocido[]) =>
    lista.length === 1 ? { encontrado: lista[0] ?? null, candidatos: lista } : null;

  const exactos = empleados.filter((empleado) => normalizar(empleado.nombre) === buscado);
  const resueltoExacto = unico(exactos);
  if (resueltoExacto !== null) return resueltoExacto;
  if (exactos.length > 1) return { encontrado: null, candidatos: exactos };

  const porPrefijo = empleados.filter((empleado) =>
    normalizar(empleado.nombre).startsWith(`${buscado} `),
  );
  const resueltoPrefijo = unico(porPrefijo);
  if (resueltoPrefijo !== null) return resueltoPrefijo;
  if (porPrefijo.length > 1) return { encontrado: null, candidatos: porPrefijo };

  /*
   * EL NOMBRE DE PILA SOLO SI EL RESTO NO DICE OTRA COSA (4-oct). Antes bastaba el primer
   * nombre: «Ana Torres», que no está en el equipo, se le asignaba a «Ana Rivas» sin un
   * aviso, y la semana de una persona acababa en la ficha de otra. Ahora el resto de lo
   * escrito tiene que casar: «Ana R.» es Ana Rivas, «Ana María Rivas» también (el apellido
   * registrado está), «Ana Torres» no es nadie y se dice.
   */
  const [primerNombre = buscado, ...restoEscrito] = buscado.replace(/\./g, '').split(' ');
  const porPrimerNombre = empleados.filter((empleado) => {
    const [suPrimero, ...suResto] = normalizar(empleado.nombre).split(' ');
    if (suPrimero !== primerNombre) return false;
    const escritoCasa = restoEscrito.every((palabra) =>
      suResto.some((suya) => suya.startsWith(palabra)),
    );
    const registradoEsta =
      suResto.length > 0 && suResto.every((suya) => restoEscrito.includes(suya));
    return escritoCasa || registradoEsta;
  });
  return unico(porPrimerNombre) ?? { encontrado: null, candidatos: porPrimerNombre };
}

export function parsearHorarioPegado(params: {
  texto: string;
  dias: DateKey[];
  empleados: EmpleadoConocido[];
  timezone: string;
}): HorarioPegado {
  const { texto, dias, empleados, timezone } = params;

  const turnos: TurnoPegado[] = [];
  const descansos: DescansoPegado[] = [];
  const problemas: ProblemaPegado[] = [];
  const declarados = new Map<string, number>();
  const nombresLeidos: string[] = [];

  /*
   * LA LINEA NO SE RECORTA ANTES DE PARTIRLA: el tabulador del principio es la esquina vacía
   * de la cabecera, y quitarlo corría los días un puesto («Esa tabla es de otra semana» de
   * una tabla que era de esta).
   */
  const filas = texto
    .split(/\r?\n/)
    .filter((linea) => linea.trim() !== '')
    .map(celdasDeLinea);
  const sobran = columnasVaciasDelante(filas);
  /** Las filas de cada persona, con el nombre como se escribió: para decir cuáles chocan. */
  const filasDe = new Map<string, string[]>();

  for (const fila of filas) {
    const celdas = fila.conHuecos ? fila.celdas.slice(sobran) : fila.celdas;
    if (celdas.length < 2) continue;

    const cabecera = numerosDeCabecera(celdas);
    if (cabecera !== null) {
      const esperados = dias.map(diaDelMes);
      const comparables = cabecera.slice(0, esperados.length);
      const cuadra =
        comparables.length === 0 ||
        comparables.every((numero, indice) => numero === esperados[indice]);
      if (!cuadra) {
        problemas.push({
          clave: 'semanaDistinta',
          dias: esperados.join(', '),
          cabecera: comparables.join(', '),
        });
      }
      continue;
    }

    const textoDelNombre = nombreDeCelda(celdas[0] ?? '');
    const { encontrado, candidatos } = empleadoDelTexto(textoDelNombre, empleados);

    // Celdas de día: las que siguen al nombre, sin la columna de horas del final.
    const resto = celdas.slice(1);
    const ultima = resto[resto.length - 1];
    const total = ultima === undefined ? null : totalDeclarado(ultima);
    const celdasDeDia = (total === null ? resto : resto.slice(0, -1)).slice(0, dias.length);

    const hayAlgoDeHorario = celdasDeDia.some((celda) => {
      const leida = leerCelda(celda);
      return leida !== null && leida.tipo !== 'vacia';
    });

    if (encontrado === null) {
      // Una línea sin nombre reconocible y sin horas es basura de la tabla, no un error.
      if (!hayAlgoDeHorario) continue;
      if (candidatos.length > 1) {
        problemas.push({
          clave: 'nombreAmbiguo',
          texto: textoDelNombre,
          candidatos: candidatos.map((empleado) => empleado.nombre),
        });
      } else {
        problemas.push({ clave: 'nombreDesconocido', texto: textoDelNombre });
      }
      continue;
    }

    /*
     * LA MISMA PERSONA EN DOS FILAS BLOQUEA (4-oct). Dos filas «Ana» se fundían en una sola
     * persona: los turnos de las dos, en la semana de una. Si son dos personas, el nombre
     * completo las separa; si es la misma, una de las filas sobra.
     */
    const yaLeidas = filasDe.get(encontrado.id);
    if (yaLeidas !== undefined) {
      yaLeidas.push(textoDelNombre);
      continue;
    }
    filasDe.set(encontrado.id, [textoDelNombre]);

    nombresLeidos.push(encontrado.id);
    if (total !== null) declarados.set(encontrado.id, total);

    celdasDeDia.forEach((celda, indice) => {
      const dia = dias[indice];
      if (dia === undefined) return;

      const leida = leerCelda(celda);
      if (leida === null) {
        problemas.push({
          clave: 'celdaIlegible',
          nombre: encontrado.nombre,
          dia,
          texto: celda,
        });
        return;
      }

      if (leida.tipo === 'descanso') {
        descansos.push({ employeeId: encontrado.id, nombre: encontrado.nombre, dateKey: dia });
        return;
      }
      if (leida.tipo === 'vacia') return;

      for (const rango of leida.rangos) {
        const instantes = shiftInstants({
          dateKey: dia,
          startTime: rango.startTime,
          endTime: rango.endTime,
          timezone,
        });
        if (instantes === null) {
          problemas.push({
            clave: 'celdaIlegible',
            nombre: encontrado.nombre,
            dia,
            texto: celda,
          });
          continue;
        }

        const brutos = Math.round(
          (Date.parse(instantes.endsAt) - Date.parse(instantes.startsAt)) / 60000,
        );
        /*
         * UN TURNO QUE NINGUNA TIENDA TIENE NO SE CREA (4-oct). «9:00-6:00» se leía como 21 h
         * que cruzan la medianoche, sin una palabra: la hora de salida escrita al revés
         * acababa en el horario y en las horas que se pagan. El tope es el de la jornada
         * —el mismo que separa un turno partido de dos jornadas—, no uno propio.
         */
        if (brutos > JORNADA_MAXIMA_MINUTOS) {
          problemas.push({
            clave: 'turnoImposible',
            nombre: encontrado.nombre,
            dia,
            texto: celda,
            minutos: brutos,
          });
          continue;
        }
        if (instantes.crossesMidnight && brutos > NOCHE_LARGA_MINUTOS) {
          problemas.push({
            clave: 'nocheLarga',
            nombre: encontrado.nombre,
            dia,
            texto: celda,
            minutos: brutos,
          });
        }
        const refrigerio = refrigerioDeUnTurno(brutos);
        turnos.push({
          employeeId: encontrado.id,
          nombre: encontrado.nombre,
          jobRoleId: encontrado.jobRoleId,
          dateKey: dia,
          startTime: rango.startTime,
          endTime: rango.endTime,
          plannedUnpaidBreakMinutes: refrigerio,
          minutosNetos: Math.max(0, brutos - refrigerio),
          cruzaMedianoche: instantes.crossesMidnight,
        });
      }
    });
  }

  for (const [employeeId, suyas] of filasDe) {
    if (suyas.length < 2) continue;
    const nombre = empleados.find((empleado) => empleado.id === employeeId)?.nombre ?? '';
    problemas.push({ clave: 'personaRepetida', nombre, filas: suyas });
  }

  if (turnos.length === 0 && descansos.length === 0 && problemas.length === 0) {
    problemas.push({ clave: 'nadaQueLeer' });
  }

  /*
   * Los solapes se buscan con el MISMO detector que usa la rejilla, no con uno propio:
   * dos turnos encima son dos turnos encima, y tener dos opiniones sobre eso es como no
   * tener ninguna. Los instantes se recalculan aquí igual que arriba porque el detector
   * compara cadenas ISO.
   */
  const paraDetectar: ScheduledShift[] = turnos.map((turno, indice) => {
    const instantes = shiftInstants({
      dateKey: turno.dateKey,
      startTime: turno.startTime,
      endTime: turno.endTime,
      timezone,
    });
    return {
      id: `pegado-${indice}`,
      employeeId: turno.employeeId,
      employeeName: turno.nombre,
      startsAt: instantes?.startsAt ?? '',
      endsAt: instantes?.endsAt ?? '',
      plannedUnpaidBreakMinutes: turno.plannedUnpaidBreakMinutes,
      status: 'draft',
    };
  });
  const yaAvisados = new Set<string>();
  for (const solape of detectOverlaps(paraDetectar)) {
    if (yaAvisados.has(solape.employeeId)) continue;
    yaAvisados.add(solape.employeeId);
    problemas.push({ clave: 'solape', nombre: solape.employeeName });
  }

  const resumen: ResumenPegado[] = [];
  for (const employeeId of [...new Set(nombresLeidos)]) {
    const suyos = turnos.filter((turno) => turno.employeeId === employeeId);
    const susDescansos = descansos.filter((descanso) => descanso.employeeId === employeeId);
    const minutos = suyos.reduce((suma, turno) => suma + turno.minutosNetos, 0);
    const declarado = declarados.get(employeeId) ?? null;
    const nombre =
      suyos[0]?.nombre ??
      susDescansos[0]?.nombre ??
      empleados.find((empleado) => empleado.id === employeeId)?.nombre ??
      '';
    resumen.push({
      employeeId,
      nombre,
      turnos: suyos.length,
      descansos: susDescansos.length,
      minutos,
      minutosDeclarados: declarado,
    });
    if (declarado !== null && declarado !== minutos) {
      problemas.push({ clave: 'totalDiscrepa', nombre, leido: minutos, declarado });
    }
  }

  return { turnos, descansos, problemas, resumen };
}
