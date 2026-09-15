/**
 * Fuente de verdad visual de Krealo Shift (especificación §5).
 *
 * Ningún componente define colores, tamaños de fuente, radios ni espaciado por su
 * cuenta: todo sale de aquí. Si Krealo Media entrega su paleta oficial definitiva,
 * basta con cambiar los valores de este archivo.
 */

export const colors = {
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
  danger600: '#C43D4D',
  info50: '#EDF6FF',
  info600: '#2A6FA8',
  black: '#000000',
  white: '#FFFFFF',
} as const;

export type ColorToken = keyof typeof colors;

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
    shadowColor: colors.ink900,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: colors.ink900,
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
 */
export const statusPalette = {
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
} as const;

export type StatusTone = keyof typeof statusPalette;

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
