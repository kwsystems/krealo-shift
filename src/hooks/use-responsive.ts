import { useWindowDimensions } from 'react-native';

import { SIDEBAR_MIN_WIDTH, breakpoints, interpolateFontSize } from '@/theme/tokens';

export type Density = 'compact' | 'regular' | 'wide' | 'extraWide';

export type Responsive = {
  width: number;
  height: number;
  density: Density;
  /** iPhone pequeño: hay que apretar el espaciado sin cortar acciones. */
  isCompact: boolean;
  /** iPad o ventana equivalente: se puede usar sidebar y columnas por día. */
  isWide: boolean;
  isLandscape: boolean;
  /** Barra inferior en teléfono, sidebar en iPad con ancho suficiente (§6.3). */
  useSidebar: boolean;
  /** Escala tipográfica del kiosco según ancho (§5). */
  scaleFont: (min: number, max: number) => number;
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const density: Density =
    width >= breakpoints.extraWide
      ? 'extraWide'
      : width >= breakpoints.wide
        ? 'wide'
        : width >= breakpoints.regular
          ? 'regular'
          : 'compact';

  return {
    width,
    height,
    density,
    isCompact: density === 'compact',
    isWide: width >= breakpoints.wide,
    isLandscape: width > height,
    useSidebar: width >= SIDEBAR_MIN_WIDTH,
    scaleFont: (min, max) => interpolateFontSize(width, min, max),
  };
}
