import { useState } from 'react';
import { Platform, Pressable, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { useDisponibilidad } from '@/features/availability/api';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { estilosDelTema } from '@/theme/estilos';
import { useTonos, type Tono } from '@/theme/tonos';
import { borderWidth, radii, SIDEBAR_WIDTH, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * EL MENÚ LATERAL DEL PANEL (1-oct), hecho a mano y no el de react-navigation.
 *
 * Andree, mirando Homebase: «el diseño del menú de la izquierda, quizá sacar una parte
 * ahí, y dentro de Equipo agregar esto… utiliza más colores». Dos cosas que el menú de
 * fábrica no sabe hacer:
 *
 *   - SUBAPARTADOS: Equipo tiene ahora «Personas» y «Disponibilidad» debajo, siempre a la
 *     vista, con lo nuevo contado al lado.
 *   - COLOR POR SECCIÓN: cada destino lleva su baldosa de color, y el activo se pinta
 *     entero de su tono. Se reconoce dónde estás por el color antes que por la palabra.
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
  tono: Tono;
  hijos?: readonly { ruta: string; etiqueta: string; insignia?: number }[];
};

const enlace = (ruta: string) => (ruta === 'index' ? '/' : `/${ruta}`);

export function MenuLateral({ state, navigation }: PropsDelMenu) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const scope = useManagerScope();
  const disponibilidad = useDisponibilidad(scope.organization?.id ?? null);
  const nuevas = (disponibilidad.data ?? []).filter((fila) => fila.status === 'new').length;
  const activa = state.routes[state.index]?.name ?? 'index';

  const destinos: readonly Destino[] = [
    { ruta: 'index', etiqueta: t('admin.tabHome'), icono: 'home-outline', tono: 'violeta' },
    {
      ruta: 'team',
      etiqueta: t('admin.tabTeam'),
      icono: 'people-outline',
      tono: 'turquesa',
      hijos: [
        { ruta: 'team', etiqueta: t('admin.tabTeamPeople') },
        { ruta: 'availability', etiqueta: t('admin.tabAvailability'), insignia: nuevas },
      ],
    },
    { ruta: 'schedule', etiqueta: t('admin.tabSchedule'), icono: 'calendar-outline', tono: 'azul' },
    { ruta: 'hours', etiqueta: t('admin.tabHours'), icono: 'time-outline', tono: 'ambar' },
    { ruta: 'reports', etiqueta: t('admin.tabReports'), icono: 'bar-chart-outline', tono: 'rosa' },
    {
      ruta: 'requests',
      etiqueta: t('admin.tabRequests'),
      icono: 'file-tray-outline',
      tono: 'naranja',
    },
    {
      ruta: 'settings',
      etiqueta: t('admin.tabSettings'),
      icono: 'settings-outline',
      tono: 'pizarra',
    },
    { ruta: 'ayuda', etiqueta: t('admin.tabManual'), icono: 'book-outline', tono: 'verde' },
  ];

  const ir = (ruta: string) => (evento: GestureResponderEvent) => {
    // Es un enlace: sin esto el navegador recargaría la página entera.
    (evento as unknown as { preventDefault?: () => void }).preventDefault?.();
    navigation.navigate(ruta);
  };

  return (
    <View style={estilos.menu} testID="menu-lateral" accessibilityRole="menu">
      <ScrollView contentContainerStyle={estilos.lista}>
        {destinos.map((destino) => {
          const enEsta =
            activa === destino.ruta || destino.hijos?.some((hijo) => hijo.ruta === activa) === true;
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
      </ScrollView>
    </View>
  );
}

/** Las propiedades de enlace que react-native-web convierte en `<a href>`. */
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
  const tonos = useTonos();
  const { colors } = useTheme();
  const tono = tonos[destino.tono];
  const [encima, setEncima] = useState(false);
  return (
    <Pressable
      {...propsDeEnlace(destino.ruta)}
      onPress={onPress}
      onHoverIn={() => setEncima(true)}
      onHoverOut={() => setEncima(false)}
      accessibilityLabel={destino.etiqueta}
      accessibilityState={{ selected: activa }}
      testID={`menu-${destino.ruta}`}
      style={({ pressed }) => [
        estilos.entrada,
        activa ? { backgroundColor: tono.fondo } : null,
        !activa && (encima || pressed) ? { backgroundColor: colors.hundido } : null,
      ]}
    >
      <View
        style={[
          estilos.baldosa,
          activa
            ? { backgroundColor: colors.surface, borderColor: tono.borde }
            : { backgroundColor: tono.fondo, borderColor: tono.fondo },
        ]}
      >
        <Ionicons name={destino.icono} size={18} color={tono.tinta} />
      </View>
      <AppText
        variant={activa ? 'bodyStrong' : 'body'}
        style={[estilos.etiqueta, activa ? { color: tono.tinta } : null]}
        numberOfLines={1}
      >
        {destino.etiqueta}
      </AppText>
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
  const tonos = useTonos();
  const { colors } = useTheme();
  const tono = tonos[nombreDelTono];
  const aviso = tonos.naranja;
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
        !activa && (encima || pressed) ? { backgroundColor: colors.hundido } : null,
      ]}
    >
      <View
        style={[
          estilos.punto,
          { backgroundColor: activa ? tono.solido : 'transparent', borderColor: tono.borde },
        ]}
      />
      <AppText
        variant={activa ? 'bodyStrong' : 'help'}
        tone={activa ? 'default' : 'muted'}
        style={[estilos.etiqueta, activa ? { color: tono.tinta } : null]}
        numberOfLines={1}
      >
        {etiqueta}
      </AppText>
      {insignia > 0 ? (
        <View
          style={[estilos.insignia, { backgroundColor: aviso.fondo, borderColor: aviso.borde }]}
          testID={`menu-sub-${ruta}-insignia`}
        >
          <AppText variant="label" style={{ color: aviso.tinta }} tabular>
            {String(insignia)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  menu: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: borderWidth.hairline,
    borderRightColor: colors.border,
  },
  lista: { paddingTop: spacing.base, paddingHorizontal: spacing.sm, gap: spacing.xs },
  entrada: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.touchTargetPreferred,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
  },
  baldosa: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  etiqueta: { flexShrink: 1 },
  /* Los subapartados, alineados con la palabra de su sección: 8 + 32 + 12. */
  hijos: { paddingLeft: spacing.sm + 32 + spacing.md - spacing.sm, gap: 2, marginBottom: 2 },
  subentrada: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
  },
  punto: { width: 8, height: 8, borderRadius: 4, borderWidth: borderWidth.hairline },
  insignia: {
    marginLeft: 'auto',
    minWidth: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
  },
}));
