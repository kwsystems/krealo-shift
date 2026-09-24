/**
 * EL COLOR DE MARCA DE UNA EMPRESA, DERIVADO Y MEDIDO.
 *
 * POR QUÉ NO SE USA EL COLOR TAL CUAL. «Sube tu logo y tu color» es lo que ofrecen las
 * apps de fichaje que hacen marca blanca, y es también donde está la trampa: esta app
 * tiene 3.124 textos medidos en dos temas, y todos esos números suponen un acento
 * conocido. Si el acento pasa a ser el amarillo pálido de una pastelería, el texto encima
 * deja de leerse —y nadie se entera hasta que el iPad está colgado en la pared de la
 * tienda, que es el peor sitio posible para descubrirlo—.
 *
 * ASÍ QUE LA EMPRESA ELIGE UN COLOR Y LA APP DERIVA DE ÉL LA RAMPA QUE NECESITA, buscando
 * la luminosidad que cumple el contraste en vez de confiar en la que venga. El contraste
 * no se comprueba después: se cumple POR CONSTRUCCIÓN. Para cualquier tono existe una
 * luminosidad que pasa —oscurecer sobre blanco, aclarar sobre negro—, así que la búsqueda
 * siempre encuentra respuesta y no hay que rechazar a nadie por su color.
 *
 * LO QUE SÍ PUEDE FALLAR Y NO SE ARREGLA SOLO ES EL TONO. En esta app el verde, el ámbar
 * y el rojo SIGNIFICAN estado —trabajando, en pausa, tarde— y un color no puede
 * significar dos cosas. Una empresa cuya marca sea verde tendría su acento a un paso del
 * «Trabajando», y eso no lo arregla ninguna luminosidad: cambiarlo sería cambiarle la
 * marca, que no nos toca. Por eso ese caso sale como AVISO con su número, para que lo
 * decida quien es dueño de la marca, y no como un rechazo.
 *
 * Es el mismo criterio que ya se aplicó a las anclas de identidad el 2026-09-24, y por la
 * misma razón: aquel día se midió que cinco tintes elegidos a ojo eran el mismo color
 * cinco veces. Un color que no se calcula es un color que no se sabe.
 */

/**
 * LA FAMILIA ENTERA DEL ACENTO, no tres pasos de seis.
 *
 * La primera versión derivaba solo `p50`, `p500` y `p600` con el argumento de que son los
 * tres papeles que de verdad hace el acento. LA CAPTURA LO DESMINTIÓ: con una marca fucsia,
 * el texto de la pestaña activa salía fucsia y su píldora seguía lavanda, porque usa otro
 * escalón. Y con ella otros ocho sitios —la tecla pulsada del teclado del reloj, el borde
 * de la cuenta atrás, los chips, el carril del interruptor, el visto de un chip elegido—.
 * Media pantalla del color de la empresa y media del violeta de fábrica es peor que no
 * tener marca.
 *
 * SOLO TRES LLEVAN PROMESA DE CONTRASTE (`p50`, `p500`, `p600`): son los que llevan texto
 * encima o hacen de forma. Los otros tres se colocan interpolando la luminosidad entre
 * ellos, conservando el tono, y su única obligación es no romper la escalera.
 */
export type RampaDeMarca = {
  /** Fondo tenue. Se garantiza que `p600` encima se lee. */
  p50: string;
  p100: string;
  p200: string;
  /** Relleno y bordes sin texto encima. Se garantiza ≥ 3:1 contra la superficie. */
  p500: string;
  /** Texto del acento y botones principales. Se garantiza ≥ 4,5:1 contra la superficie. */
  p600: string;
  p700: string;
};

export type AvisoDeMarca = {
  /** Qué color de estado se le parece. */
  estado: 'trabajando' | 'pausa' | 'tarde';
  /** Separación perceptual medida, en OKLab ×100. Por debajo de 8 se confunden. */
  distancia: number;
};

export type VeredictoDeMarca = {
  rampa: RampaDeMarca;
  /** Vacío si el color no se parece a ningún estado. */
  avisos: AvisoDeMarca[];
  /** `true` cuando el color elegido es tan gris que dejó de ser un color de marca. */
  sinColor: boolean;
};

/** Separación mínima para que dos colores se lean como distintos. */
export const SEPARACION_MINIMA = 8;
/** Texto pequeño sobre su fondo. */
const CONTRASTE_TEXTO = 4.5;
/** Formas sin texto encima: bordes, rellenos, marcas de gráfico. */
const CONTRASTE_FORMA = 3;
/** Por debajo de este croma, el tono ya no se percibe como color. */
const CROMA_MINIMO = 0.02;

/**
 * La rampa de una empresa sobre una superficie dada.
 *
 * `superficie` es el color detrás: blanco en el tema claro, el plano elevado en el oscuro.
 * Se pasa en vez de deducirse porque los dos temas la tienen distinta y esta función no
 * tiene por qué saber en cuál está.
 */
export function rampaDeMarca(
  base: string,
  superficie: string,
  estados: { trabajando: string; pausa: string; tarde: string },
): VeredictoDeMarca | null {
  const lch = aOklch(base);
  if (lch === null) return null;

  const claraLaSuperficie = luminancia(superficie) > 0.4;

  /*
   * EL TEXTO SE BUSCA HACIA DONDE HAY SITIO: más oscuro sobre una superficie clara, más
   * claro sobre una oscura. Buscar siempre hacia abajo dejaría el tema oscuro con un
   * acento casi negro sobre fondo casi negro, que es justo el error que se arregló esta
   * mañana con la elevación.
   */
  const fuerte = buscarLuminosidad(lch, superficie, CONTRASTE_TEXTO, claraLaSuperficie);
  const medio = buscarLuminosidad(lch, superficie, CONTRASTE_FORMA, claraLaSuperficie);
  /*
   * EL FONDO SUAVE SE BUSCA AL REVÉS: tiene que estar tan cerca de la superficie que no
   * moleste, y a la vez dejar leer el texto fuerte encima. Se busca contra `fuerte`, no
   * contra la superficie, porque lo que hay que poder leer es eso.
   */
  const suave = buscarLuminosidad(lch, fuerte, CONTRASTE_TEXTO, !claraLaSuperficie);

  /*
   * LOS TRES ESCALONES INTERMEDIOS SE INTERPOLAN EN LUMINOSIDAD, con el mismo tono.
   * `p700` va un paso MÁS ALLÁ de `p600`, alejándose de la superficie: es el que se usa
   * para el detalle que tiene que destacar sobre el acento, así que quedarse corto lo
   * haría desaparecer justo encima de él.
   */
  const lSuave = luminosidadDe(suave);
  const lMedio = luminosidadDe(medio);
  const lFuerte = luminosidadDe(fuerte);
  const entre = (a: number, b: number, t: number) => deOklch({ ...lch, l: a + (b - a) * t });
  const masAlla = deOklch({
    ...lch,
    l: Math.min(1, Math.max(0, lFuerte + (lFuerte - lMedio) * 0.6)),
  });

  const avisos: AvisoDeMarca[] = [];
  for (const [estado, color] of [
    ['trabajando', estados.trabajando],
    ['pausa', estados.pausa],
    ['tarde', estados.tarde],
  ] as const) {
    const distancia = distanciaPerceptual(fuerte, color);
    if (distancia < SEPARACION_MINIMA) {
      avisos.push({ estado, distancia: Number(distancia.toFixed(1)) });
    }
  }

  return {
    rampa: {
      p50: suave,
      p100: entre(lSuave, lMedio, 0.25),
      p200: entre(lSuave, lMedio, 0.55),
      p500: medio,
      p600: fuerte,
      p700: masAlla,
    },
    avisos,
    sinColor: lch.c < CROMA_MINIMO,
  };
}

/**
 * La luminosidad más cercana a la elegida que cumple el contraste pedido.
 *
 * BÚSQUEDA BINARIA Y NO UNA FÓRMULA, porque la relación entre la luminosidad de OKLab y el
 * contraste WCAG no se puede despejar: WCAG mide luminancia relativa en sRGB con su propia
 * curva, y OKLab está construido sobre otra escala. Con dieciocho pasos se acierta por
 * debajo de lo que distingue una pantalla.
 *
 * SE CONSERVA EL TONO Y SE CEDE EN LUMINOSIDAD, que es el orden correcto: el tono es lo que
 * la gente reconoce como «su» color; que sea un poco más oscuro casi nadie lo nota, y quien
 * lo note lo prefiere a no poder leer.
 */
function buscarLuminosidad(
  lch: Oklch,
  contra: string,
  objetivo: number,
  haciaAbajo: boolean,
): string {
  const cumple = (l: number) => contraste(deOklch({ ...lch, l }), contra) >= objetivo;
  if (cumple(lch.l)) return deOklch(lch);

  let dentro = haciaAbajo ? 0 : 1;
  let fuera = lch.l;
  // Si ni el extremo cumple, se devuelve el extremo: es lo más lejos que se puede llegar.
  if (!cumple(dentro)) return deOklch({ ...lch, l: dentro });
  for (let i = 0; i < 18; i += 1) {
    const medio = (dentro + fuera) / 2;
    if (cumple(medio)) dentro = medio;
    else fuera = medio;
  }
  return deOklch({ ...lch, l: dentro });
}

/** La luminosidad OKLab de un color ya convertido a hex. */
function luminosidadDe(hex: string): number {
  return aOklch(hex)?.l ?? 0;
}

type Oklch = { l: number; c: number; h: number };

/** `#RRGGBB` a OKLCh. `null` si no es un color válido: no se adivina. */
function aOklch(hex: string): Oklch | null {
  const limpio = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return null;
  const n = Number.parseInt(limpio, 16);
  const [l, a, b] = aOklab([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  return { l, c: Math.hypot(a, b), h: Math.atan2(b, a) };
}

/**
 * De OKLCh a `#RRGGBB`, bajando el croma hasta que el color EXISTE en la pantalla.
 *
 * Sin esto, un tono muy saturado a una luminosidad que no lo admite se sale del espacio
 * sRGB, y recortar cada canal por separado —que es lo obvio— TUERCE EL TONO: un morado
 * intenso demasiado oscuro sale azul. Bajar el croma conserva el tono, que es lo único que
 * no se puede tocar de la marca de alguien.
 */
function deOklch({ l, c, h }: Oklch): string {
  let alto = c;
  let bajo = 0;
  if (enGama(l, c, h)) return aHex(deOklab(l, Math.cos(h) * c, Math.sin(h) * c));
  for (let i = 0; i < 16; i += 1) {
    const medio = (alto + bajo) / 2;
    if (enGama(l, medio, h)) bajo = medio;
    else alto = medio;
  }
  return aHex(deOklab(l, Math.cos(h) * bajo, Math.sin(h) * bajo));
}

function enGama(l: number, c: number, h: number): boolean {
  const [r, g, b] = deOklabLineal(l, Math.cos(h) * c, Math.sin(h) * c);
  return [r, g, b].every((canal) => canal >= -0.0001 && canal <= 1.0001);
}

/** Distancia perceptual en OKLab ×100. La misma que usan las anclas de identidad. */
export function distanciaPerceptual(unColor: string, otroColor: string): number {
  const a = aOklabDeHex(unColor);
  const b = aOklabDeHex(otroColor);
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

/** Contraste WCAG entre dos colores opacos, de 1 a 21. */
export function contraste(unColor: string, otroColor: string): number {
  const [alto, bajo] = [luminancia(unColor), luminancia(otroColor)].sort((x, y) => y - x);
  return ((alto ?? 0) + 0.05) / ((bajo ?? 0) + 0.05);
}

function luminancia(hex: string): number {
  const canales = aCanales(hex);
  if (canales === null) return 0;
  const [r, g, b] = canales.map(aLineal);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function aCanales(hex: string): [number, number, number] | null {
  const limpio = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return null;
  const n = Number.parseInt(limpio, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const aLineal = (valor: number) => {
  const c = valor / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function aOklabDeHex(hex: string): [number, number, number] | null {
  const canales = aCanales(hex);
  return canales === null ? null : aOklab(canales);
}

function aOklab([rc, gc, bc]: [number, number, number]): [number, number, number] {
  const r = aLineal(rc);
  const g = aLineal(gc);
  const b = aLineal(bc);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deOklabLineal(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function deOklab(L: number, A: number, B: number): [number, number, number] {
  return deOklabLineal(L, A, B).map((canal) => {
    const acotado = Math.min(1, Math.max(0, canal));
    const gamma = acotado <= 0.0031308 ? acotado * 12.92 : 1.055 * acotado ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255);
  }) as [number, number, number];
}

const aHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
