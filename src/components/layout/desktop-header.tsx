import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { borderWidth, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';

/**
 * Cabecera del panel en pantallas anchas.
 *
 * POR QUÉ HACÍA FALTA
 * Abierta en un monitor, la app no decía en ninguna parte qué aplicación era ni de
 * qué negocio eran esos datos: se entraba directamente a una columna de pestañas y un
 * título de pantalla. Eso es normal en un teléfono, donde el icono de la app y el
 * cambiador de tareas dan ese contexto gratis, y no lo es en una pestaña del navegador
 * entre otras quince.
 *
 * Trae el nombre del producto, el de la organización y la sede activa, que es el dato
 * que decide lo que se está mirando en las cuatro pantallas.
 *
 * SOLO EN ANCHO. En teléfono y en iPad estrecho devuelve `null` a propósito: ahí el
 * espacio vertical es el recurso escaso y cada pantalla ya trae su propio título. Este
 * componente añade identidad donde sobra sitio, no roba sitio donde falta.
 *
 * NO REPITE ACCIONES. Cerrar sesión y los ajustes viven en «Más», y duplicarlos aquí
 * sería dos caminos para lo mismo que hay que mantener sincronizados.
 */
export function DesktopHeader() {
  const estilos = useEstilos();
  const { t } = useTranslation();
  const { useSidebar } = useResponsive();
  const { organization, location } = useManagerScope();

  if (!useSidebar) return null;

  return (
    <View style={estilos.barra} testID="desktop-header">
      <AppText style={estilos.marca}>{t('app.name')}</AppText>

      {organization !== null ? (
        <View style={estilos.contexto}>
          <AppText style={estilos.organizacion}>{organization.name}</AppText>
          {location !== null ? (
            <>
              <AppText style={estilos.separador}>·</AppText>
              <AppText style={estilos.sede}>{location.name}</AppText>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: borderWidth.hairline,
  },
  marca: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.body,
    color: colors.primary600,
  },
  contexto: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  organizacion: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.label,
    color: colors.ink700,
  },
  separador: { color: colors.ink500, fontSize: fontSize.label },
  sede: { fontSize: fontSize.label, color: colors.ink500 },
}));
