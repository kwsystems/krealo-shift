import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { useRespuestaAlPuntero } from '@/components/ui/layout';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, durations, fontFamily, radii, shadows, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import type { MarcaDeAviso } from './api';
import { useAvisosStore } from './avisos-store';
import { coloresDe, coloresDelSello, ICONO, useDescribirAviso } from './piezas-del-aviso';
import { etiquetaDeClase } from './textos-de-avisos';

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
const ANCHO_DEL_EMERGENTE = 380;
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

/**
 * UN AVISO (rediseño del 6-oct). Andree: «que se vea más llamativa y bonita, se ve bien
 * básica». Tres piezas, y cada una dice algo:
 *
 *   - EL SELLO DE HORA a la izquierda, del color de la marca: lo que se recuerda. Es la hora
 *     estampada de un reloj de fichar, y es lo primero que quiere saber quien gestiona.
 *   - EL RÓTULO encima de la frase —«ENTRADA», «SALE A COMER»— en el mismo color: qué pasó,
 *     antes de leer quién. Con la sede al lado, para quien lleva varias.
 *   - LA LÍNEA DE ABAJO se va vaciando: cuánto le queda en pantalla. Con el puntero encima o
 *     la pestaña oculta SE PARA, y sigue al soltar: un aviso no se va mientras se lee.
 *
 * MOVIMIENTO: entra bajando y creciendo un poco (300 ms, ease-out fuerte) y sale más rápido
 * de lo que entra (160 ms), que es lo que pide algo que el sistema despacha solo. Con
 * «reducir movimiento», solo la opacidad: se ve igual, sin viaje.
 */
const CURVA_DE_ENTRADA = Easing.bezier(0.23, 1, 0.32, 1);
const DURACION_DE_ENTRADA_MS = 300;
const DURACION_DE_SALIDA_MS = 160;

function Emergente({ marca }: { marca: MarcaDeAviso }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const estilos = useEstilos();
  const respuesta = useRespuestaAlPuntero();
  const { location, locations } = useManagerScope();
  const describir = useDescribirAviso();
  const cerrarEmergente = useAvisosStore((s) => s.cerrarEmergente);
  const abrirPanel = useAvisosStore((s) => s.abrirPanel);
  const aviso = describir(marca);
  const sello = coloresDelSello(aviso.clase, colors, isDark);
  const rotulo = etiquetaDeClase(t, aviso.clase);

  const [entrada] = useState(() => new Animated.Value(0));
  const [progreso] = useState(() => new Animated.Value(1));
  const [sinMovimiento, setSinMovimiento] = useState(false);
  const [encima, setEncima] = useState(false);
  const [sobreCerrar, setSobreCerrar] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const oculta = usePestanaOculta();
  const restante = useRef(DURACION_DEL_EMERGENTE_MS);

  const salir = useCallback(() => {
    setSaliendo(true);
    Animated.timing(entrada, {
      toValue: 0,
      duration: DURACION_DE_SALIDA_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start(() => cerrarEmergente(marca.id));
  }, [entrada, cerrarEmergente, marca.id]);

  useEffect(() => {
    let vivo = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reducir) => {
      if (!vivo) return;
      setSinMovimiento(reducir);
      Animated.timing(entrada, {
        toValue: 1,
        duration: reducir ? durations.fast : DURACION_DE_ENTRADA_MS,
        easing: CURVA_DE_ENTRADA,
        useNativeDriver: false,
      }).start();
    });
    return () => {
      vivo = false;
    };
  }, [entrada]);

  // El reloj del aviso, con pausa: corre solo con la pestaña a la vista y sin el puntero encima.
  const pausado = encima || sobreCerrar || oculta;
  useEffect(() => {
    if (pausado || saliendo) return undefined;
    const desde = Date.now();
    const vaciado = Animated.timing(progreso, {
      toValue: 0,
      duration: restante.current,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    vaciado.start();
    const reloj = setTimeout(salir, restante.current);
    return () => {
      clearTimeout(reloj);
      vaciado.stop();
      restante.current = Math.max(0, restante.current - (Date.now() - desde));
    };
  }, [pausado, saliendo, progreso, salir]);

  // La sede, solo si hay más de una: con una sola es ruido en cada aviso.
  const lugar = location === null || locations.length < 2 ? null : location.name;

  return (
    <Animated.View
      style={[
        estilos.tarjeta,
        {
          opacity: entrada,
          transform: sinMovimiento
            ? []
            : [
                { translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
                { scale: entrada.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
        },
      ]}
      testID={`aviso-emergente-${marca.id}`}
    >
      <Pressable
        onPress={abrirPanel}
        onHoverIn={() => setEncima(true)}
        onHoverOut={() => setEncima(false)}
        onFocus={respuesta.props.onFocus}
        onBlur={respuesta.props.onBlur}
        accessibilityRole="button"
        accessibilityLabel={`${rotulo}. ${aviso.texto}, ${aviso.hora}. ${t('alerts.open')}`}
        style={estilos.cuerpoPulsable}
      >
        {({ pressed }) => (
          <View style={[estilos.cuerpo, pressed ? estilos.cuerpoPulsado : null]}>
            <View
              style={[estilos.sello, { backgroundColor: sello.fondo }]}
              testID={`aviso-sello-${marca.id}`}
            >
              <Ionicons name={ICONO[aviso.clase]} size={16} color={sello.tinta} />
              <Text style={[estilos.selloHora, { color: sello.tinta }]}>{aviso.hora}</Text>
            </View>
            <View style={estilos.textos}>
              <Text style={estilos.rotuloFila} numberOfLines={1}>
                <Text style={[estilos.rotulo, { color: coloresDe(aviso.clase, colors).tinta }]}>
                  {rotulo.toLocaleUpperCase()}
                </Text>
                {lugar === null ? null : <Text style={estilos.lugar}>{`  ·  ${lugar}`}</Text>}
              </Text>
              <AppText variant="bodyStrong" style={estilos.frase} numberOfLines={2}>
                {aviso.texto}
              </AppText>
            </View>
          </View>
        )}
      </Pressable>
      <Pressable
        onPress={salir}
        onHoverIn={() => setSobreCerrar(true)}
        onHoverOut={() => setSobreCerrar(false)}
        accessibilityRole="button"
        accessibilityLabel={t('alerts.dismiss')}
        hitSlop={8}
        style={({ hovered }: { hovered?: boolean }) => [
          estilos.cerrar,
          hovered ? estilos.cerrarEncima : null,
        ]}
        testID={`aviso-emergente-cerrar-${marca.id}`}
      >
        <Ionicons name="close" size={16} color={colors.ink500} />
      </Pressable>
      {/* Lo que le queda en pantalla: se vacía de derecha a izquierda, del color de la marca. */}
      <View style={estilos.carril} pointerEvents="none">
        <Animated.View
          testID={`aviso-progreso-${marca.id}`}
          style={[
            estilos.linea,
            { backgroundColor: sello.fondo, transform: [{ scaleX: progreso }] },
          ]}
        />
      </View>
    </Animated.View>
  );
}

/** ¿La pestaña está oculta? En la web, para parar el reloj del aviso mientras nadie mira. */
function usePestanaOculta(): boolean {
  const [oculta, setOculta] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const mirar = () => setOculta(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', mirar);
    return () => document.removeEventListener('visibilitychange', mirar);
  }, []);
  return oculta;
}

const useEstilos = estilosDelTema((colors) => ({
  capa: { position: 'absolute', zIndex: 50, gap: spacing.sm },
  capaEstrecha: { left: spacing.sm, right: spacing.sm },
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.raised,
    borderRadius: 18,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.floating,
  },
  cuerpoPulsable: { flex: 1, minWidth: 0 },
  cuerpo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.xs,
  },
  cuerpoPulsado: { backgroundColor: colors.pulsado },
  /* El sello: ancho fijo para que las horas de tres avisos apilados queden en columna. */
  sello: {
    width: 64,
    alignSelf: 'stretch',
    minHeight: 58,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flexShrink: 0,
  },
  selloHora: {
    fontFamily: fontFamily.displayBold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  rotuloFila: { fontSize: 11, lineHeight: 15 },
  rotulo: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  lugar: { fontFamily: fontFamily.medium, fontSize: 11, color: colors.ink500 },
  frase: { fontSize: 15, lineHeight: 20 },
  cerrar: {
    width: 32,
    height: 32,
    marginTop: spacing.sm,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    flexShrink: 0,
  },
  cerrarEncima: { backgroundColor: colors.encima },
  carril: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.hundido,
  },
  linea: { height: 3, transformOrigin: 'left' },
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
