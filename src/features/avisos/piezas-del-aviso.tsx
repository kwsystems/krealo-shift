import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useEmployeeNames } from '@/features/team/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import { fontFamily, type ColorSet } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { formatClockTime } from '@/utils/time';

import type { MarcaDeAviso } from './api';
import { claseDeAviso, textoDelAviso, type ClaseDeAviso } from './textos-de-avisos';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * CÓMO SE VE CADA CLASE DE AVISO, igual en la campana y en el emergente. Los colores son
 * los de ESTADO del panel, no los tonos de sección: verde es «trabajando» en Inicio y en
 * Horario, ámbar es «en descanso», y una entrada pintada de otro color aquí obligaría a
 * aprender una segunda leyenda para lo mismo.
 */
export const ICONO: Record<ClaseDeAviso, IconName> = {
  entrada: 'log-in-outline',
  vuelta: 'play-outline',
  comida: 'restaurant-outline',
  descanso: 'cafe-outline',
  pausa: 'pause-outline',
  salida: 'log-out-outline',
};

export function coloresDe(clase: ClaseDeAviso, colors: ColorSet): { fondo: string; tinta: string } {
  switch (clase) {
    case 'entrada':
    case 'vuelta':
      return { fondo: colors.success50, tinta: colors.success600 };
    case 'comida':
    case 'descanso':
      return { fondo: colors.warning50, tinta: colors.warning600 };
    case 'pausa':
      return { fondo: colors.info50, tinta: colors.info600 };
    case 'salida':
      return { fondo: colors.hundido, tinta: colors.ink700 };
  }
}

/**
 * EL SELLO DE HORA (6-oct), lo que se recuerda del aviso: la hora en un bloque del color de
 * la marca, como la que estampa un reloj de fichar. Andree: «que se vea más llamativa y
 * bonita, se ve bien básica». En claro, color lleno y texto blanco; en oscuro, el mismo
 * color encendido con el texto del fondo, que sobre un panel oscuro brilla en vez de apagarse.
 * Medido: el texto queda a 5:1 o más sobre los cuatro colores, en los dos temas.
 */
export function coloresDelSello(
  clase: ClaseDeAviso,
  colors: ColorSet,
  oscuro: boolean,
): { fondo: string; tinta: string } {
  const tinta = oscuro ? colors.canvas : colors.white;
  switch (clase) {
    case 'entrada':
    case 'vuelta':
      return { fondo: colors.success600, tinta };
    case 'comida':
    case 'descanso':
      return { fondo: colors.warning600, tinta };
    case 'pausa':
      return { fondo: colors.info600, tinta };
    case 'salida':
      return { fondo: colors.ink700, tinta };
  }
}

/**
 * El sello pequeño de cada fila de la campana: icono y hora en una píldora del color suave de
 * la marca. Es el mismo sello del aviso emergente en tamaño de lista, así que la campana se
 * lee como el registro del día y no como una lista de mensajes.
 */
export function PildoraDeHora({ clase, hora }: { clase: ClaseDeAviso; hora: string }) {
  const { colors } = useTheme();
  const { fondo, tinta } = coloresDe(clase, colors);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minWidth: 70,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: fondo,
        flexShrink: 0,
      }}
      testID={`aviso-clase-${clase}`}
    >
      <Ionicons name={ICONO[clase]} size={14} color={tinta} />
      <Text
        style={{
          color: tinta,
          fontFamily: fontFamily.displayBold,
          fontSize: 13,
          lineHeight: 16,
          fontVariant: ['tabular-nums'],
        }}
      >
        {hora}
      </Text>
    </View>
  );
}

export type AvisoDescrito = { clase: ClaseDeAviso; texto: string; hora: string };

/**
 * La frase, la hora y la clase de una marca, con el nombre de la persona y la hora de la
 * sede. La usan la campana y el emergente, para que digan lo mismo con las mismas palabras.
 */
export function useDescribirAviso(): (marca: MarcaDeAviso) => AvisoDescrito {
  const { t } = useTranslation();
  const { organization, timezone, timeFormat } = useManagerScope();
  const nombres = useEmployeeNames(organization?.id ?? null);
  return useCallback(
    (marca: MarcaDeAviso) => ({
      clase: claseDeAviso(marca),
      texto: textoDelAviso(t, marca, nombres.get(marca.employee_id)),
      hora: formatClockTime(marca.occurred_at, timezone, timeFormat, currentLanguage()),
    }),
    [t, nombres, timezone, timeFormat],
  );
}
