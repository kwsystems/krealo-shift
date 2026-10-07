import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { useVersionNueva } from '@/hooks/use-version-nueva';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, shadows, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * «HAY UNA VERSIÓN NUEVA» (7-oct), abajo y pequeño, en el panel y en el celular. Sale cuando
 * se ha publicado la app después de abrir esta pestaña: hasta recargar, la pestaña sigue con
 * la versión de antes. No tapa nada ni recarga sola —alguien puede estar escribiendo en una
 * hoja—; un botón lo hace. Ver `use-version-nueva.ts`.
 */
export function AvisoDeVersion() {
  const hayNueva = useVersionNueva();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  if (!hayNueva) return null;

  return (
    <View style={estilos.capa} pointerEvents="box-none">
      <View style={estilos.tarjeta} accessibilityRole="alert" testID="version-nueva">
        <Ionicons name="sparkles-outline" size={20} color={colors.primary600} />
        <AppText variant="bodyStrong" style={estilos.texto}>
          {t('app.newVersion')}
        </AppText>
        <PrimaryButton
          label={t('app.newVersionReload')}
          onPress={() => window.location.reload()}
          fullWidth={false}
          testID="version-nueva-actualizar"
        />
      </View>
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  capa: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    bottom: spacing.lg,
    alignItems: 'center',
    zIndex: 60,
  },
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 560,
    backgroundColor: colors.raised,
    borderRadius: 18,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.base,
    paddingRight: spacing.sm,
    ...shadows.floating,
  },
  texto: { flexShrink: 1 },
}));
