import { useCallback } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useEmployeeNames } from '@/features/team/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { currentLanguage } from '@/i18n';
import type { ColorSet } from '@/theme/tokens';
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
const ICONO: Record<ClaseDeAviso, IconName> = {
  entrada: 'log-in-outline',
  vuelta: 'play-outline',
  comida: 'restaurant-outline',
  descanso: 'cafe-outline',
  pausa: 'pause-outline',
  salida: 'log-out-outline',
};

function coloresDe(clase: ClaseDeAviso, colors: ColorSet): { fondo: string; tinta: string } {
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

export function BaldosaDelAviso({ clase, lado = 36 }: { clase: ClaseDeAviso; lado?: number }) {
  const { colors } = useTheme();
  const { fondo, tinta } = coloresDe(clase, colors);
  return (
    <View
      style={{
        width: lado,
        height: lado,
        borderRadius: Math.round(lado * 0.3),
        backgroundColor: fondo,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      testID={`aviso-clase-${clase}`}
    >
      <Ionicons name={ICONO[clase]} size={Math.round(lado * 0.5)} color={tinta} />
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
