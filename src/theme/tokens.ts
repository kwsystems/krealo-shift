/**
 * Fuente de verdad visual de Krealo Shift (especificación §5).
 *
 * Ningún componente define colores, tamaños de fuente, radios ni espaciado por su
 * cuenta: todo sale de aquí. Si Krealo Media entrega su paleta oficial definitiva,
 * basta con cambiar los valores de este archivo.
 *
 * DOS JUEGOS DE COLOR, LAS MISMAS CLAVES
 * `claro` y `oscuro` tienen exactamente los mismos nombres, y el tipo lo OBLIGA: si
 * alguien añade un color a uno y se olvida del otro, no compila. Es la única forma de
 * que 54 archivos puedan escribir `surface` sin saber en qué tema están.
 *
 * LOS NOMBRES SON PAPELES, NO COLORES. `surface` no significa «blanco», significa «el
 * fondo de una tarjeta»; en oscuro es casi negro. `ink900` no es «casi negro», es «el
 * texto principal»; en oscuro es casi blanco. Leerlos como colores literales es lo que
 * lleva a escribir `colors.white` donde se quería decir «el texto que va encima del
 * acento», y eso es justo lo que se rompe al cambiar de tema.
 */

/** El juego claro: el de siempre, sin tocar un solo valor. */
export const lightColors = {
  primary50: '#F5F2FF',
  primary100: '#ECE6FF',
  primary200: '#D9CDFF',
  primary500: '#7157E8',
  primary600: '#5B3FD6',
  primary700: '#452BB7',
  ink900: '#19172A',
  ink700: '#403D52',
  ink500: '#6F6B7A',
  surface: '#FFFFFF',
  canvas: '#F7F7FA',
  border: '#E5E3EB',
  success50: '#EAF9F1',
  success600: '#16845B',
  warning50: '#FFF6E5',
  warning600: '#B56B00',
  danger50: '#FFF0F1',
  /** Un paso más que `danger50`: el fondo de un botón de peligro PULSADO. */
  danger100: '#FFE3E6',
  danger600: '#C43D4D',
  info50: '#EDF6FF',
  info600: '#2A6FA8',
  /**
   * El texto que va ENCIMA del acento (un botón primario relleno).
   *
   * Existe como token propio y no como `white` literal porque en oscuro NO es blanco:
   * el acento se aclara para verse sobre fondo oscuro, y blanco sobre ese morado claro
   * da 3,65:1 —insuficiente para texto—. Con tinta oscura da 4,87:1. Medido, no supuesto.
   */
  onPrimary: '#FFFFFF',
  black: '#000000',
  white: '#FFFFFF',
} as const;

export type ColorToken = keyof typeof lightColors;
export type ColorSet = Readonly<Record<ColorToken, string>>;

/**
 * El juego oscuro.
 *
 * NO ES UNA INVERSIÓN DE LA PALETA CLARA. Invertir produce grises lavados y acentos que
 * se apagan: un morado que se lee sobre blanco se pierde sobre negro. Cada valor se
 * eligió por su papel y se COMPROBÓ con dos herramientas, no con el ojo:
 *
 *   - Los tres colores que se usan como marcas de gráfico pasaron
 *     `validate_palette.js --mode dark` contra la superficie oscura: banda de
 *     luminosidad, suelo de croma, separación bajo protanopia y deuteranopia, suelo de
 *     visión normal y contraste. Las primeras propuestas —#F0A93C y #F4788A— FALLARON
 *     la banda de luminosidad del modo oscuro (0,785 y 0,671 frente a un techo de
 *     0,67): en oscuro la banda aceptable es más estrecha que en claro, así que
 *     «aclarar el color de claro» es exactamente el error.
 *   - Cada par de texto sobre su fondo se calculó con la fórmula de contraste WCAG.
 *     Los diez pares dan 4,7:1 o más; el texto apagado sobre tarjeta, que es el peor,
 *     da 5,27:1.
 *
 * El neutro tiene un sesgo hacia el morado de la marca en vez de ser gris puro: un gris
 * neutro al lado de un acento morado se lee como un gris que nadie eligió.
 */
export const darkColors = {
  /*
   * Fondos teñidos: lo que en claro era un lavanda pálido, aquí es un morado muy oscuro.
   *
   * `primary50` VALÍA #211C33 Y ESTABA MAL, por una razón que no se ve leyendo el color
   * sino midiendo lo que se pinta encima. El fondo del kiosco es este token, y el resto
   * del tema oscuro se afinó contra `surface`. #211C33 era MÁS CLARO que `surface`
   * —0,0139 contra 0,0111 de luminancia—, así que todo lo que llegaba justo a 4,5:1
   * sobre la tarjeta se quedaba en 4,49:1 sobre el fondo del kiosco. El arnés lo
   * encontró en cinco sitios a la vez: el nombre del negocio, el cambio de idioma,
   * «Ayuda y accesibilidad», «Olvidé marcar» y «Cancelar». Y el mensaje de PIN
   * incorrecto, que el arnés no alcanza.
   *
   * Un centésimo no se ve. Lo que importa es que eran CINCO SITIOS CON LA MISMA CAUSA:
   * el primer arreglo fue aclarar el rojo del mensaje de error, y estaba persiguiendo
   * el síntoma. La causa es el fondo, y arreglado ahí se arreglan todos.
   *
   * ADEMÁS ERA LA JERARQUÍA AL REVÉS. En claro, `primary50` (#F5F2FF) es más OSCURO que
   * la tarjeta: es el telón del fondo y las tarjetas se le ponen encima. En oscuro había
   * quedado más claro que la tarjeta, o sea el telón por delante de lo que sostiene.
   *
   * #1B1235 es más oscuro Y más morado. Lo segundo importa tanto como lo primero: este
   * token también es la fila elegida y el botón pulsado, que se distinguen de la tarjeta
   * por el tinte, no por la luz. Esa separación perceptual SUBE con el cambio —ΔE 3,1 →
   * 4,7 en OKLab, cuando el mismo par en claro es 3,7—, así que el kiosco se lee mejor
   * y la selección se ve mejor. Sobre este fondo: acento 4,85:1, peligro 4,85:1,
   * texto apagado 5,44:1.
   */
  primary50: '#1B1235',
  primary100: '#2A2342',
  primary200: '#363053',
  // El acento sube de luminosidad para sobrevivir al fondo oscuro. `primary700` es el
  // estado REFORZADO (pulsado, señalado), así que en oscuro es más CLARO que el 600,
  // no más oscuro: sobre negro, «más fuerte» significa más luz.
  primary500: '#9B86F5',
  primary600: '#8A72F0',
  primary700: '#A997F7',
  // La tinta se invierte de papel: 900 sigue siendo el texto principal.
  ink900: '#F2F0F7',
  ink700: '#C0BCCC',
  ink500: '#918C9E',
  // La tarjeta es MÁS CLARA que el lienzo, igual que en claro es más clara que el gris
  // de fondo. La jerarquía se conserva aunque los valores se den la vuelta.
  surface: '#1C1A24',
  canvas: '#131118',
  border: '#332F3D',
  success50: '#12261D',
  success600: '#4ADE9B',
  warning50: '#2B2011',
  warning600: '#C4831F',
  danger50: '#2C1519',
  danger100: '#3A1B21',
  danger600: '#DC5A70',
  info50: '#10202E',
  info600: '#6FB3E8',
  // Tinta oscura sobre el acento claro: 4,87:1. Blanco daría 3,65:1 y no llega.
  onPrimary: '#1A1526',
  black: '#000000',
  white: '#FFFFFF',
} as const satisfies ColorSet;

/**
 * El juego CLARO, tal cual, para todo lo que todavía no sabe de temas.
 *
 * Se mantiene a propósito mientras dura la migración: 54 archivos importan `colors` y
 * cambiarlos todos en un solo golpe sería un diff imposible de revisar y una tarde
 * entera sin poder compilar. Así la app sigue viéndose exactamente igual hoy, y cada
 * pantalla se pasa al tema en la tarea 2/5.
 *
 * Cuando no quede ningún uso, este alias se borra.
 */
export const colors = lightColors;

/** Escala base de espaciado (§5). Todo margen y padding sale de aquí. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
} as const;

export const radii = {
  card: 16,
  button: 14,
  /** Botones principales del kiosco, que son más grandes. */
  kioskButton: 18,
  input: 12,
  pill: 999,
} as const;

export const borderWidth = {
  hairline: 1,
  focus: 2,
} as const;

/**
 * Alturas mínimas y objetivos táctiles (§5).
 * El objetivo táctil mínimo es 44×44, pero preferimos 52×52.
 */
export const sizes = {
  buttonMobile: 52,
  buttonKiosk: 64,
  touchTargetMin: 44,
  touchTargetPreferred: 52,
  keypadKeyMobile: 64,
  keypadKeyKiosk: 88,
  pinDot: 18,
  iconMobile: 24,
  iconKiosk: 30,
  avatarSm: 32,
  avatarMd: 44,
  avatarLg: 72,
} as const;

/**
 * Tipografía (§5). Familia Inter vía @expo-google-fonts/inter.
 * Los tamaños del kiosco son rangos porque se adaptan al ancho: ver `getKioskScale`.
 */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const fontSize = {
  /** Hora del kiosco: 48–64 según ancho. */
  /** Mínimo absoluto del reloj en una pantalla baja. Ver `interpolateFontByHeight`. */
  kioskClockShort: 30,
  kioskClockMin: 48,
  kioskClockMax: 64,
  /**
   * Hora del kiosco en iPad HORIZONTAL, donde ocupa media pantalla para ella sola.
   *
   * §9.1 dice que la hora es el elemento dominante de la pantalla de reposo. Con el
   * reloj a 64 en una columna de 1300 px dejaba de serlo: el título "Marca tu entrada o
   * salida" de la otra columna se leía primero, y lo que la persona busca al acercarse
   * al iPad es la hora. Se mide en la captura de 2732x2048, no se supone.
   */
  kioskClockLandscapeMax: 120,
  /** Título del kiosco: 34–44 según ancho. */
  /** Mínimo absoluto del título en una pantalla baja. */
  kioskTitleShort: 20,
  kioskTitleMin: 34,
  kioskTitleMax: 44,
  titleMobileMin: 28,
  titleMobileMax: 32,
  sectionMin: 20,
  sectionMax: 24,
  body: 16,
  help: 14,
  /** Nunca menos de 12 (§5). */
  label: 12,
} as const;

export const lineHeight = {
  tight: 1.15,
  normal: 1.35,
  relaxed: 1.5,
} as const;

/**
 * Sombras muy suaves y solo en tarjetas flotantes o modales (§5).
 * Nada de sombras dramáticas ni efectos de vidrio.
 */
export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  card: {
    /*
     * NEGRO, no `ink900`. `ink900` es «el texto principal», y en oscuro eso es CASI
     * BLANCO: una sombra blanca es un halo, no una sombra. Una sombra es ausencia de
     * luz en los dos temas, así que su color es literalmente negro y lo que cambia es
     * cuánto se nota.
     */
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

/** Movimiento: transiciones de 150–250 ms (§5). */
export const durations = {
  fast: 150,
  base: 200,
  slow: 250,
  /** Cuenta regresiva antes de una acción irreversible. */
  actionCountdownMs: 3000,
  /** Regreso automático a reposo tras confirmar un fichaje. */
  kioskAutoReturnMs: 4000,
} as const;

/**
 * Puntos de quiebre por ancho disponible. Se usan para decidir densidad y
 * si el iPad muestra sidebar en vez de barra inferior (§6.3).
 */
export const breakpoints = {
  /** iPhone SE y anchos pequeños. */
  compact: 0,
  /** iPhone moderno. */
  regular: 400,
  /** iPad vertical. */
  wide: 768,
  /** iPad horizontal y ventanas de escritorio. */
  extraWide: 1024,
} as const;

/** Ancho mínimo para usar sidebar en lugar de barra inferior. */
export const SIDEBAR_MIN_WIDTH = breakpoints.wide;

/**
 * Ancho de la barra lateral cuando hay sidebar (§6.3, §33).
 *
 * Sin fijarlo, la barra se quedaba en los 360 px que le tocan por omisión, que es
 * ancho de pantalla de teléfono: en un monitor de 1920 se comía casi una quinta parte
 * de la ventana para cinco palabras. Un panel de escritorio pone la navegación en una
 * columna estrecha y da el resto al contenido; 248 es el ancho habitual y entra
 * "Horario" sin cortarse.
 */
export const SIDEBAR_WIDTH = 248;

/**
 * Estados de asistencia y su color semántico. El color nunca es la única señal:
 * cada estado lleva además icono y texto (§5, §21).
 *
 * ES UNA FUNCIÓN, y era un objeto constante. Siendo constante, las insignias de estado
 * de toda la app quedaban fijadas en claro al cargar este archivo, y el resultado se vio
 * a la primera captura en oscuro: una pantalla oscura con las insignias en crema y verde
 * pálido. Lo peor de este caso es que vivía DENTRO de `tokens.ts`, el único archivo que
 * el barrido de colores congelados excluía por ser la fuente de los colores.
 */
export const paletaDeEstado = (colors: ColorSet) =>
  ({
    offShift: { bg: colors.canvas, fg: colors.ink700, border: colors.border },
    working: { bg: colors.success50, fg: colors.success600, border: colors.success600 },
    onBreak: { bg: colors.warning50, fg: colors.warning600, border: colors.warning600 },
    late: { bg: colors.danger50, fg: colors.danger600, border: colors.danger600 },
    info: { bg: colors.info50, fg: colors.info600, border: colors.info600 },
    /**
     * Advertencia que no es un estado de asistencia. Comparte el ámbar de `onBreak`
     * a propósito —un solo ámbar en la app— pero se nombra aparte: usar `onBreak`
     * para "el iPad no sincroniza" le dice al siguiente que lee el código que eso
     * tiene algo que ver con un descanso, y no lo tiene.
     */
    warning: { bg: colors.warning50, fg: colors.warning600, border: colors.warning600 },
  }) as const;

/** Las claves salen del tipo de retorno: no hace falta una instancia solo para eso. */
export type StatusTone = keyof ReturnType<typeof paletaDeEstado>;

/**
 * Escala tipográfica del kiosco según el ancho disponible: interpola entre el
 * mínimo y el máximo definidos, para que el reloj se lea a un brazo de distancia
 * tanto en un iPad vertical como horizontal (§33).
 */
export function interpolateFontSize(width: number, min: number, max: number): number {
  const from = breakpoints.wide;
  const to = breakpoints.extraWide + 300;
  if (width <= from) return min;
  if (width >= to) return max;
  const ratio = (width - from) / (to - from);
  return Math.round(min + (max - min) * ratio);
}

/**
 * Altos de referencia del reloj de fichaje.
 *
 * `corto` es un iPhone SE de pie (568) y `holgado` un teléfono moderno (760). Entre
 * los dos, el reloj y el título encogen; por debajo de `corto` se quedan en su mínimo
 * absoluto y no bajan más, porque un reloj ilegible tampoco sirve.
 */
export const kioskHeights = {
  corto: 568,
  holgado: 760,
} as const;

/**
 * Escala tipográfica según el ALTO disponible.
 *
 * POR QUÉ HACÍA FALTA, Y NO BASTABA CON EL ANCHO
 * `interpolateFontSize` solo mira el ancho. En un teléfono el ancho ya está por debajo
 * del primer punto de corte, así que el reloj se quedaba clavado en su mínimo de 48 y
 * el título en 34 *hiciera lo que hiciera la altura*. En una pantalla de 360×640 eso
 * empujaba el teclado hacia abajo y LA ÚLTIMA FILA QUEDABA CORTADA: "Borrar", "0" y el
 * borrado de dígito se veían a medias. Medido en el navegador, no supuesto.
 *
 * El orden de sacrificio no es arbitrario. Lo primero que encoge es lo decorativo —el
 * reloj gigante y el título—; el teclado y los puntos del PIN no se tocan nunca, porque
 * son el objetivo táctil y §25 fija un mínimo por debajo del cual no se puede bajar.
 * Un reloj más pequeño es una molestia; un teclado que no cabe es la aplicación entera
 * sin funcionar.
 */
export function interpolateFontByHeight(height: number, min: number, max: number): number {
  const { corto, holgado } = kioskHeights;
  if (height <= corto) return min;
  if (height >= holgado) return max;
  const ratio = (height - corto) / (holgado - corto);
  return Math.round(min + (max - min) * ratio);
}

/**
 * Especificación de los gráficos de Reportes.
 *
 * EL COLOR AQUÍ NO SE ELIGIÓ MIRÁNDOLO. Se validó con el script de la disciplina
 * (`validate_palette.js`), que mide en OKLab la banda de luminosidad, el suelo de
 * croma, la separación entre pares bajo protanopia y deuteranopia simuladas, el
 * suelo para visión normal y el contraste contra la superficie. Esa diferencia
 * importó de verdad:
 *
 *   - `primary600` + `warning600` (los dos únicos colores que se tocan, en la barra
 *     apilada de horas extra) → TODO PASA. Peor par ΔE 31.3 con protanopia, 34.8
 *     con visión normal, contraste ≥ 3:1 los dos.
 *   - `success600` + `danger600`, que es lo que cualquiera pinta para «a tiempo /
 *     tarde» → **FALLA**: ΔE 4.8 con deuteranopia. Verde y rojo son el MISMO COLOR
 *     para una de cada doce personas, y un gráfico de puntualidad pintado así no
 *     dice nada al 8% de quien lo mire. Por eso la puntualidad NO es una barra de
 *     dos colores: es una sola serie —las tardanzas, que es lo accionable— sobre
 *     una pista neutra, con el número al lado.
 *
 * Si alguien añade un color a esta lista, el paso obligatorio es volver a correr el
 * validador con la lista entera, no mirarla.
 */
export const chart = (colors: ColorSet) =>
  ({
    /**
     * Serie 1. Casi todos los gráficos son UNA serie —minutos— sobre categorías sin
     * orden propio (personas, días, motivos), y ahí todas las barras van de este color.
     * Pintar cada barra de un color distinto gastaría el canal de identidad en repetir
     * lo que el largo de la barra ya dice.
     */
    series1: colors.primary600,
    /** Serie 2. Solo se usa donde hay DOS series de verdad: normales y extra. */
    series2: colors.warning600,
    /** Lo que hay que mirar: tardanzas, tiempo no trabajado. Nunca "serie 3". */
    attention: colors.danger600,
    /** Pista sin rellenar de un medidor: un paso claro, no gris muerto. */
    track: colors.primary100,
    /** Rejilla y línea base: un paso por encima de la superficie, sólida y discreta. */
    grid: colors.border,
  }) as const;

/**
 * Medidas fijas de las marcas. No se improvisan por gráfico: un proyecto donde cada
 * barra tiene su grosor se lee como cuatro proyectos.
 */
export const chartMarks = {
  /** Grosor de barra. El tope de la disciplina son 24; 14 deja aire en la banda. */
  barThickness: 14,
  /** Columna de día: más ancha porque son solo siete y hay sitio. */
  columnThickness: 24,
  /** Extremo del dato redondeado; el que apoya en la línea base va cuadrado. */
  endRadius: 4,
  /**
   * Hueco en color superficie entre dos tramos que se tocan. Es lo que separa los
   * tramos de una barra apilada: un borde alrededor de la marca sería tinta que no
   * es dato.
   */
  surfaceGap: 2,
  /** Alto del área de trazado de las columnas de la semana. */
  columnPlotHeight: 132,
} as const;
