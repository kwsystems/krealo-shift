import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { useRespuestaAlPuntero } from '@/components/ui/layout';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, durations, radii, shadows, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import type { MarcaDeAviso } from './api';
import { useAvisosStore } from './avisos-store';
import { BaldosaDelAviso, useDescribirAviso } from './piezas-del-aviso';

/**
 * EL AVISO EMERGENTE (5-oct): sale arriba unos segundos cuando alguien marca, y se va solo.
 * Andree: «también un popup, pero solo en la parte de arriba». No tapa la pantalla ni pide
 * nada: la campana guarda la marca igual, y tocar el aviso la abre.
 *
 * En pantalla ancha cuelga a la derecha, debajo de la campana, que es adonde va a parar;
 * en el teléfono ocupa el ancho, debajo de la cabecera. Como mucho tres a la vez, el más
 * nuevo arriba; si llegan más de golpe, «y N avisos más».
 */
export const DURACION_DEL_EMERGENTE_MS = 7_000;
const ANCHO_DEL_EMERGENTE = 360;
const ANCHO_PARA_COLGAR = 600;

export function AvisosEmergentes({ arriba }: { arriba: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const { width } = useWindowDimensions();
  const emergentes = useAvisosStore((s) => s.emergentes);
  const sinMostrar = useAvisosStore((s) => s.sinMostrar);
  const marcas = useAvisosStore((s) => s.marcas);
  const abrirPanel = useAvisosStore((s) => s.abrirPanel);

  if (emergentes.length === 0) return null;
  const porId = new Map(marcas.map((marca) => [marca.id, marca]));
  const visibles = [...emergentes]
    .reverse()
    .map((id) => porId.get(id))
    .filter((marca): marca is MarcaDeAviso => marca !== undefined);
  const colgado = width >= ANCHO_PARA_COLGAR;

  return (
    <View
      pointerEvents="box-none"
      style={[
        estilos.capa,
        { top: arriba },
        colgado ? { right: spacing.xl, width: ANCHO_DEL_EMERGENTE } : estilos.capaEstrecha,
      ]}
      aria-live="polite"
      testID="avisos-emergentes"
    >
      {visibles.map((marca) => (
        <Emergente key={marca.id} marca={marca} />
      ))}
      {sinMostrar > 0 ? (
        <Pressable
          onPress={abrirPanel}
          accessibilityRole="button"
          accessibilityLabel={`${t('alerts.more', { count: sinMostrar })}. ${t('alerts.open')}`}
          style={estilos.mas}
          testID="avisos-mas"
        >
          {/* Sobre el fondo elevado, el violeta más contrastado: ver el pie de la campana. */}
          <AppText variant="label" style={{ color: colors.primary700 }}>
            {t('alerts.more', { count: sinMostrar })}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Emergente({ marca }: { marca: MarcaDeAviso }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const respuesta = useRespuestaAlPuntero();
  const { location } = useManagerScope();
  const describir = useDescribirAviso();
  const cerrarEmergente = useAvisosStore((s) => s.cerrarEmergente);
  const abrirPanel = useAvisosStore((s) => s.abrirPanel);
  const aviso = describir(marca);

  /*
   * ENTRA BAJANDO UN POCO Y SE HACE VISIBLE, 200 ms. Con «reducir movimiento» aparece sin
   * desplazarse: el aviso tiene que verse igual, lo que sobra es el viaje.
   */
  const [entrada] = useState(() => new Animated.Value(0));
  const [sinMovimiento, setSinMovimiento] = useState(false);
  useEffect(() => {
    let vivo = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reducir) => {
      if (!vivo) return;
      setSinMovimiento(reducir);
      if (reducir) entrada.setValue(1);
      else
        Animated.timing(entrada, {
          toValue: 1,
          duration: durations.base,
          useNativeDriver: false,
        }).start();
    });
    const reloj = setTimeout(() => cerrarEmergente(marca.id), DURACION_DEL_EMERGENTE_MS);
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [entrada, cerrarEmergente, marca.id]);

  const lugar = location === null ? null : location.name;

  return (
    <Animated.View
      style={[
        estilos.tarjeta,
        {
          opacity: entrada,
          transform: sinMovimiento
            ? []
            : [{ translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
        },
      ]}
      testID={`aviso-emergente-${marca.id}`}
    >
      <Pressable
        onPress={abrirPanel}
        accessibilityRole="button"
        accessibilityLabel={`${aviso.texto}, ${aviso.hora}. ${t('alerts.open')}`}
        style={estilos.cuerpoPulsable}
        {...respuesta.props}
      >
        {({ pressed }) => (
          <View style={[estilos.cuerpo, ...respuesta.estilo(pressed)]}>
            <BaldosaDelAviso clase={aviso.clase} lado={40} />
            <View style={estilos.textos}>
              <AppText variant="bodyStrong" style={estilos.frase} numberOfLines={2}>
                {aviso.texto}
              </AppText>
              <AppText variant="help" tone="subtle" numberOfLines={1} tabular>
                {lugar === null ? aviso.hora : `${aviso.hora} · ${lugar}`}
              </AppText>
            </View>
          </View>
        )}
      </Pressable>
      <Pressable
        onPress={() => cerrarEmergente(marca.id)}
        accessibilityRole="button"
        accessibilityLabel={t('alerts.dismiss')}
        style={estilos.cerrar}
        testID={`aviso-emergente-cerrar-${marca.id}`}
      >
        <Ionicons name="close" size={18} color={colors.ink500} />
      </Pressable>
    </Animated.View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  capa: { position: 'absolute', zIndex: 50, gap: spacing.sm },
  capaEstrecha: { left: spacing.sm, right: spacing.sm },
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    ...shadows.floating,
  },
  cuerpoPulsable: { flex: 1, minWidth: 0 },
  cuerpo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderTopLeftRadius: radii.card,
    borderBottomLeftRadius: radii.card,
  },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  frase: { fontSize: 15, lineHeight: 20 },
  cerrar: {
    width: sizes.touchTargetMin,
    height: sizes.touchTargetMin,
    marginRight: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
    flexShrink: 0,
  },
  mas: {
    alignSelf: 'flex-end',
    minHeight: sizes.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.raised,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    ...shadows.card,
  },
}));
