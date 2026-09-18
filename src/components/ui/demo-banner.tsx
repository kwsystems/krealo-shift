import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { isDemoMode } from '@/lib/demo/config';
import { borderWidth, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';

/**
 * Aviso permanente de que los datos son inventados.
 *
 * NO ES DECORACIÓN NI CORTESÍA. Un tablero de asistencia con nombres, horas y fichajes
 * es indistinguible de uno de verdad mirándolo: alguien puede tomar una decisión sobre
 * personal —o enseñárselo a un cliente— creyendo que son datos reales. Y cuanto mejor
 * quede el modo demostración, más fácil es confundirlo, así que esto tiene que crecer
 * en visibilidad junto con la calidad de la demostración, no al revés.
 *
 * Se pinta en la raíz y no en cada pantalla porque la raíz es el único sitio por el que
 * pasan todas, incluido el kiosco.
 *
 * Devuelve `null` cuando la demostración está apagada: en producción este componente
 * está en el árbol pero no existe en pantalla.
 */
export function DemoBanner() {
  const styles = useEstilos();
  const { t } = useTranslation();

  if (!isDemoMode) return null;

  return (
    <View style={styles.barra} accessibilityRole="alert" testID="demo-banner">
      <AppText style={styles.texto}>{t('demo.banner')}</AppText>
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  barra: {
    backgroundColor: colors.warning50,
    borderBottomColor: colors.warning600,
    borderBottomWidth: borderWidth.hairline,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  texto: {
    color: colors.warning600,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.label,
    textAlign: 'center',
  },
}));
