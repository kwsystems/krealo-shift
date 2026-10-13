import { useState } from 'react';
import { Platform, Pressable, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { EsferaDeReloj } from '@/components/ui/esfera-de-reloj';
import { useNovedadesDeDisponibilidad } from '@/features/availability/novedades';
import { usePendingRequestCount } from '@/hooks/use-manager-dashboard';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useLiveClock } from '@/hooks/use-live-clock';
import { currentLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { propsDelMarco } from '@/theme/marco';
import { tonosDelTema, type Tono } from '@/theme/tonos';
import { movimiento } from '@/theme/movimiento';
import { fontFamily, radii, SIDEBAR_WIDTH, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { formatClockTime } from '@/utils/time';

/**
 * EL MENÚ LATERAL DEL PANEL (1-oct), hecho a mano y no el de react-navigation.
 *
 * Andree, mirando Homebase: «el diseño del menú de la izquierda, quizá sacar una parte
 * ahí, y dentro de Equipo agregar esto… utiliza más colores». Dos cosas que el menú de
 * fábrica no sabe hacer:
 *
 *   - SUBAPARTADOS: Equipo tiene ahora «Personas» y «Disponibilidad» debajo, siempre a la
 *     vista, con lo nuevo contado al lado.
 *   - COLOR POR SECCIÓN: cada destino lleva el color de su sección, y el activo se reconoce
 *     por el color antes que por la palabra.
 *
 * REHECHO EL 13-OCT, sobre el marco oscuro. Andree: «esta parte necesito que se vea mejor,
 * más bonito, se ve feo». Cada icono iba en una baldosa con fondo y borde, y el menú entero
 * era una columna de cajas apagadas del mismo peso. Ahora:
 *
 *   - el icono va suelto, en el color de su sección; SOLO el activo lleva su pastilla de
 *     color, el fondo iluminado y la barra al borde. Una caja por menú, no ocho;
 *   - los destinos van en tres grupos con su rótulo —el día a día, el análisis, la
 *     gestión—, que es como se usan;
 *   - los subapartados cuelgan de una guía vertical, como un árbol: se ve de quién son;
 *   - al pie, la hora de la sede con su reloj pequeño, la misma esfera del acceso.
 *
 * SON ENLACES DE VERDAD (`<a href>` en web), como los de antes: se abren en otra pestaña
 * con el botón del medio y los arneses los encuentran por su dirección.
 *
 * Solo en pantalla ancha. En el teléfono sigue la barra de abajo de siempre.
 */

/** Lo poco del estado de pestañas que hace falta: cuál está activa y cómo ir a otra. */
export type PropsDelMenu = {
  state: { index: number; routes: readonly { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
};

type Destino = {
  ruta: string;
  etiqueta: string;
  icono: keyof typeof Ionicons.glyphMap;
  /** El icono del destino activo: relleno, para que pese más que los demás. */
  iconoActivo: keyof typeof Ionicons.glyphMap;
  tono: Tono;
  /** Lo que espera respuesta ahí: las solicitudes de Bandeja. */
  insignia?: number;
  hijos?: readonly { ruta: string; etiqueta: string; insignia?: number }[];
};

type Grupo = { clave: string; titulo: string; destinos: readonly Destino[] };

const enlace = (ruta: string) => (ruta === 'index' ? '/' : `/${ruta}`);

export function MenuLateral({ state, navigation }: PropsDelMenu) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const scope = useManagerScope();
  // Los dos números del menú son los de sus pantallas: ver `novedades.ts` y Bandeja.
  const nuevas = useNovedadesDeDisponibilidad();
  const pendientes =
    usePendingRequestCount(scope.organization?.id ?? null, scope.locationId).data ?? 0;
  const activa = state.routes[state.index]?.name ?? 'index';

  const grupos: readonly Grupo[] = [
    {
      clave: 'dia',
      titulo: t('admin.navGroupDaily'),
      destinos: [
        {
          ruta: 'index',
          etiqueta: t('admin.tabHome'),
          icono: 'home-outline',
          iconoActivo: 'home',
          tono: 'violeta',
        },
        {
          ruta: 'team',
          etiqueta: t('admin.tabTeam'),
          icono: 'people-outline',
          iconoActivo: 'people',
          tono: 'turquesa',
          hijos: [
            { ruta: 'team', etiqueta: t('admin.tabTeamPeople') },
            { ruta: 'availability', etiqueta: t('admin.tabAvailability'), insignia: nuevas },
          ],
        },
        {
          ruta: 'schedule',
          etiqueta: t('admin.tabSchedule'),
          icono: 'calendar-outline',
          iconoActivo: 'calendar',
          tono: 'azul',
        },
        {
          ruta: 'hours',
          etiqueta: t('admin.tabHours'),
          icono: 'time-outline',
          iconoActivo: 'time',
          tono: 'ambar',
        },
      ],
    },
    {
      clave: 'analisis',
      titulo: t('admin.navGroupInsights'),
      destinos: [
        {
          ruta: 'reports',
          etiqueta: t('admin.tabReports'),
          icono: 'bar-chart-outline',
          iconoActivo: 'bar-chart',
          tono: 'rosa',
        },
      ],
    },
    {
      clave: 'gestion',
      titulo: t('admin.navGroupAdmin'),
      destinos: [
        {
          ruta: 'requests',
          etiqueta: t('admin.tabRequests'),
          icono: 'file-tray-outline',
          iconoActivo: 'file-tray',
          tono: 'naranja',
          insignia: pendientes,
        },
        {
          ruta: 'settings',
          etiqueta: t('admin.tabSettings'),
          icono: 'settings-outline',
          iconoActivo: 'settings',
          tono: 'pizarra',
        },
        {
          ruta: 'ayuda',
          etiqueta: t('admin.tabManual'),
          icono: 'book-outline',
          iconoActivo: 'book',
          tono: 'verde',
        },
      ],
    },
  ];

  const ir = (ruta: string) => (evento: GestureResponderEvent) => {
    // En web el Pressable es un `<a href>`: sin esto, el clic navegaría recargando la
    // página entera en vez de cambiar de pestaña.
    (evento as unknown as { preventDefault?: () => void }).preventDefault?.();
    navigation.navigate(ruta);
  };

  return (
    <View {...propsDelMarco()} style={estilos.menu} testID="menu-lateral" accessibilityRole="menu">
      <ScrollView style={estilos.desplazable} contentContainerStyle={estilos.lista}>
        {grupos.map((grupo) => (
          <View key={grupo.clave} style={estilos.grupo}>
            <AppText style={estilos.tituloDeGrupo}>{grupo.titulo}</AppText>
            {grupo.destinos.map((destino) => {
              const enEsta =
                activa === destino.ruta ||
                destino.hijos?.some((hijo) => hijo.ruta === activa) === true;
              return (
                <View key={destino.ruta}>
                  <Entrada destino={destino} activa={enEsta} onPress={ir(destino.ruta)} />
                  {destino.hijos === undefined ? null : (
                    <View style={estilos.hijos}>
                      {destino.hijos.map((hijo) => (
                        <Subentrada
                          key={hijo.ruta + hijo.etiqueta}
                          ruta={hijo.ruta}
                          etiqueta={hijo.etiqueta}
                          insignia={hijo.insignia ?? 0}
                          tono={destino.tono}
                          activa={activa === hijo.ruta}
                          onPress={ir(hijo.ruta)}
                        />
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <PieDelMenu />
    </View>
  );
}

function propsDeEnlace(ruta: string) {
  return Platform.OS === 'web'
    ? ({ href: enlace(ruta), role: 'link' } as unknown as Record<string, unknown>)
    : {};
}

function Entrada({
  destino,
  activa,
  onPress,
}: {
  destino: Destino;
  activa: boolean;
  onPress: (evento: GestureResponderEvent) => void;
}) {
  const estilos = useEstilos();
  const { colors } = useTheme();
  // El menú va sobre el marco oscuro en los dos temas: sus tonos son siempre los oscuros.
  const tonos = tonosDelTema(true);
  const tono = tonos[destino.tono];
  const [encima, setEncima] = useState(false);
  const iluminada = activa || encima;
  return (
    <Pressable
      {...propsDeEnlace(destino.ruta)}
      onPress={onPress}
      onHoverIn={() => setEncima(true)}
      onHoverOut={() => setEncima(false)}
      accessibilityLabel={
        (destino.insignia ?? 0) > 0 ? `${destino.etiqueta}, ${destino.insignia}` : destino.etiqueta
      }
      accessibilityState={{ selected: activa }}
      testID={`menu-${destino.ruta}`}
      style={({ pressed }) => [
        estilos.entrada,
        activa ? { backgroundColor: colors.marcoActiva } : null,
        !activa && (encima || pressed) ? { backgroundColor: colors.marcoEncima } : null,
      ]}
    >
      {/*
        LA MARCA DE «ESTÁS AQUÍ»: una barra del color de la sección pegada al borde del menú,
        que entra al cambiar de sección.
      */}
      {activa ? (
        <View
          {...movimiento('aparecer')}
          style={[estilos.marcaActiva, { backgroundColor: tono.solido }]}
        />
      ) : null}
      <View
        style={[
          estilos.icono,
          activa ? [estilos.iconoActivo, { backgroundColor: tono.solido }] : null,
        ]}
      >
        <Ionicons
          name={activa ? destino.iconoActivo : destino.icono}
          size={activa ? 17 : 19}
          color={activa ? colors.marco : tono.tinta}
        />
      </View>
      <AppText
        style={[
          estilos.etiqueta,
          activa ? estilos.etiquetaActiva : null,
          { color: iluminada ? colors.marcoTexto : colors.marcoApagado },
        ]}
        numberOfLines={1}
      >
        {destino.etiqueta}
      </AppText>
      {(destino.insignia ?? 0) > 0 ? (
        <Insignia valor={destino.insignia ?? 0} testID={`menu-${destino.ruta}-insignia`} />
      ) : null}
    </Pressable>
  );
}

function Subentrada({
  ruta,
  etiqueta,
  insignia,
  tono: nombreDelTono,
  activa,
  onPress,
}: {
  ruta: string;
  etiqueta: string;
  insignia: number;
  tono: Tono;
  activa: boolean;
  onPress: (evento: GestureResponderEvent) => void;
}) {
  const estilos = useEstilos();
  const { colors } = useTheme();
  const tono = tonosDelTema(true)[nombreDelTono];
  const [encima, setEncima] = useState(false);
  return (
    <Pressable
      {...propsDeEnlace(ruta)}
      onPress={onPress}
      onHoverIn={() => setEncima(true)}
      onHoverOut={() => setEncima(false)}
      accessibilityLabel={insignia > 0 ? `${etiqueta}, ${insignia}` : etiqueta}
      accessibilityState={{ selected: activa }}
      testID={`menu-sub-${ruta}`}
      style={({ pressed }) => [
        estilos.subentrada,
        !activa && (encima || pressed) ? { backgroundColor: colors.marcoEncima } : null,
      ]}
    >
      {/* En la guía del árbol: el nudo se enciende del color de la sección si es aquí. */}
      <View
        style={[
          estilos.nudo,
          activa
            ? { backgroundColor: tono.solido, borderColor: tono.solido }
            : { backgroundColor: colors.marco, borderColor: colors.marcoRegla },
        ]}
      />
      <AppText
        style={[
          estilos.etiquetaSub,
          activa ? estilos.etiquetaActiva : null,
          { color: activa || encima ? colors.marcoTexto : colors.marcoApagado },
        ]}
        numberOfLines={1}
      >
        {etiqueta}
      </AppText>
      {insignia > 0 ? <Insignia valor={insignia} testID={`menu-sub-${ruta}-insignia`} /> : null}
    </Pressable>
  );
}

/** Lo que espera respuesta, en naranja: el mismo aviso en Bandeja y en Disponibilidad. */
function Insignia({ valor, testID }: { valor: number; testID: string }) {
  const estilos = useEstilos();
  const aviso = tonosDelTema(true).naranja;
  return (
    <View style={[estilos.insignia, { backgroundColor: aviso.solido }]} testID={testID}>
      <AppText style={estilos.insigniaTexto} tabular>
        {String(valor)}
      </AppText>
    </View>
  );
}

/**
 * AL PIE, LA HORA DE LA SEDE (13-oct): con la esfera pequeña del reloj, la misma del acceso.
 * Es la hora con la que se mide todo lo de arriba —quién llegó tarde, quién está dentro—,
 * así que es la de la sede y no la del ordenador.
 */
function PieDelMenu() {
  const estilos = useEstilos();
  const scope = useManagerScope();
  const language = currentLanguage();
  const ahora = useLiveClock('minute');
  const dia = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: scope.timezone,
  }).format(ahora);
  return (
    <View style={estilos.pie} testID="menu-hora">
      <EsferaDeReloj tamano={38} />
      <View style={estilos.pieTexto}>
        <AppText style={estilos.hora} tabular>
          {formatClockTime(ahora.toISOString(), scope.timezone, scope.timeFormat, language)}
        </AppText>
        <AppText style={estilos.dia} numberOfLines={1}>
          {dia}
        </AppText>
      </View>
    </View>
  );
}

// El mínimo táctil, ni un píxel menos: `responsive-check` lo mide en cada fila del menú.
const ALTO_DE_ENTRADA = sizes.touchTargetMin;
const ANCHO_DEL_ICONO = 30;

const useEstilos = estilosDelTema((colors) => ({
  menu: {
    width: SIDEBAR_WIDTH,
    alignSelf: 'stretch',
    // EL MARCO (13-oct): oscuro en los dos temas, como la cabecera. Ver `marco` en tokens.
    backgroundColor: colors.marco,
  },
  desplazable: { flex: 1 },
  lista: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
    paddingHorizontal: spacing.md,
    gap: spacing.base,
  },
  grupo: { gap: 0 },
  tituloDeGrupo: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.marcoApagado,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  entrada: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: ALTO_DE_ENTRADA,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
  },
  marcaActiva: {
    position: 'absolute',
    // Pegada al borde del menú, fuera del relleno de la lista.
    left: -spacing.md,
    top: 10,
    bottom: 10,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  icono: {
    width: ANCHO_DEL_ICONO,
    height: ANCHO_DEL_ICONO,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconoActivo: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  etiqueta: { flexShrink: 1, fontFamily: fontFamily.medium, fontSize: 15 },
  etiquetaSub: { flexShrink: 1, fontFamily: fontFamily.medium, fontSize: 14 },
  etiquetaActiva: { fontFamily: fontFamily.semibold },
  /*
   * EL ÁRBOL: la guía vertical baja del centro del icono de Equipo, y cada subapartado
   * cuelga de ella con su nudo. Se ve de quién son sin tener que sangrarlos más.
   */
  hijos: {
    marginLeft: spacing.sm + ANCHO_DEL_ICONO / 2,
    borderLeftWidth: 1,
    borderLeftColor: colors.marcoRegla,
    paddingLeft: spacing.md,
    gap: 0,
  },
  subentrada: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
  },
  nudo: {
    position: 'absolute',
    // Sobre la guía: el relleno de `hijos` más la mitad del nudo, hacia la izquierda.
    left: -spacing.md - 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
  },
  insignia: {
    marginLeft: 'auto',
    minWidth: 22,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insigniaTexto: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: colors.marco,
  },
  pie: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.marcoEncima,
  },
  pieTexto: { flexShrink: 1, minWidth: 0 },
  hora: {
    fontFamily: fontFamily.displayBold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: colors.marcoTexto,
  },
  dia: { fontSize: 12, color: colors.marcoApagado },
}));
