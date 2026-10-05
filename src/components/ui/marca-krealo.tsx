import { Image, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { useTheme } from '@/theme/use-theme';

/**
 * EL LOGO DE KREALO SHIFT (5-oct), en UN componente: la cabecera del panel, el acceso, el
 * manual, el reloj sin activar y el celular lo piden aquí. Los archivos son los del kit de
 * marca (`public/brand/svg/`), con su nombre de siempre para no confundir variantes.
 *
 *   - `horizontal`: la K con reloj y «Krealo Shift» al lado. Es el logo de las cabeceras.
 *   - `icono`: solo la K con reloj, para donde el nombre no cabe —la cabecera del teléfono—.
 *   - `cuadrado`: la K con el nombre debajo, para pantallas con aire, como el reloj sin activar.
 *
 * CLARO U OSCURO SEGÚN EL TEMA DE LA APP, no según el sistema: quien eligió «Oscuro» en Ajustes
 * con el teléfono en claro ve el logo blanco y rojo, como el resto de la pantalla. El rojo y el
 * negro son los de la marca; la interfaz conserva su violeta (el kit lo pide así).
 *
 * SE DA EL ALTO Y EL ANCHO SALE DE LA PROPORCIÓN del dibujo, así nunca se deforma. Fuera de la
 * web no hay `public/` que servir: allí se escribe el nombre, como hasta ahora.
 */
export type VarianteDeMarca = 'horizontal' | 'icono' | 'cuadrado';

const ARCHIVO: Record<VarianteDeMarca, string> = {
  horizontal: 'horizontal',
  icono: 'icon',
  cuadrado: 'square',
};

/** Ancho entre alto del dibujo: el `viewBox` de cada SVG del kit. */
const PROPORCION: Record<VarianteDeMarca, number> = {
  horizontal: 580 / 128,
  icono: 1,
  cuadrado: 1,
};

export function rutaDelLogo(variante: VarianteDeMarca, oscuro: boolean): string {
  return `/brand/svg/krealo-shift-${ARCHIVO[variante]}-${oscuro ? 'dark' : 'light'}.svg`;
}

export function MarcaKrealo({
  variante = 'horizontal',
  alto = 26,
  testID = 'marca-krealo',
}: {
  variante?: VarianteDeMarca;
  /** En píxeles. El kit propone 26 en una cabecera de escritorio y 24 en el teléfono. */
  alto?: number;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { isDark, colors } = useTheme();
  const nombre = t('app.name');

  if (Platform.OS !== 'web') {
    return (
      <AppText variant="bodyStrong" style={{ color: colors.primary600 }} testID={testID}>
        {nombre}
      </AppText>
    );
  }
  return (
    <Image
      source={{ uri: rutaDelLogo(variante, isDark) }}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel={nombre}
      style={{ height: alto, width: Math.round(alto * PROPORCION[variante]), flexShrink: 0 }}
      testID={`${testID}-${variante}-${isDark ? 'dark' : 'light'}`}
    />
  );
}
