import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AdminErrorState } from '@/components/schedule/data-states';
import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { useBootResolution } from '@/features/boot/use-boot-resolution';
import { ManagerScopeProvider } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { borderWidth, colors, fontFamily, fontSize, sizes, spacing } from '@/theme/tokens';

/**
 * Navegación de propietario, gerente y administrador (§6.3).
 *
 * Cinco pestañas: Inicio, Equipo, Horario, Horas y Más. Horario es una pestaña
 * principal, no una pantalla escondida, porque cambiar los turnos cada semana es
 * la tarea central del administrador (§6.3, §11.3).
 *
 * En iPad con ancho suficiente la barra inferior se convierte en un SIDEBAR
 * lateral con etiqueta al lado del icono, en lugar de estirar una interfaz de
 * teléfono de lado a lado (§6.3, §33). La decisión la toma
 * `useResponsive().useSidebar`, que responde al ancho disponible: al rotar el
 * iPad, la navegación cambia sola.
 *
 * El provider de contexto envuelve las cinco pestañas para que compartan la
 * organización, el rol y la ubicación elegida sin volver a consultarlos.
 *
 * GUARDA DE SESIÓN Y DE ROL
 * `(manager)` es un grupo, así que sus rutas viven en la raíz: `/team`,
 * `/schedule`, `/hours`, `/more`. Eso significa que se alcanzan por enlace
 * profundo o escribiendo la URL en Expo Web SIN pasar por la redirección de
 * `app/index.tsx`. Sin esta guarda, el panel administrativo quedaba accesible sin
 * sesión.
 *
 * No sustituye a RLS —el servidor sigue siendo la autoridad y no devolvería
 * datos— pero enseñar el armazón del panel a quien no inició sesión es una fuga de
 * estructura y una pantalla confusa. La guarda va en el layout y no en cada
 * pantalla porque el layout es el único punto por el que pasan todas.
 *
 * La guarda NO reimplementa la resolución: usa la misma
 * `resolveBootDestination` que `app/index.tsx`. La tenía copiada, y las dos copias
 * se contestaban distinto a partir del tercer paso. Compartiéndola, además, es
 * imposible que las dos rutas se redirijan la una a la otra en bucle.
 */
export default function ManagerLayout() {
  const { t } = useTranslation();
  const { useSidebar } = useResponsive();
  const { destination, retry } = useBootResolution();

  switch (destination.kind) {
    // Mientras no se sabe, no se muestra nada: ni el panel ni el acceso. Mandar a
    // iniciar sesión a quien SÍ la tiene sería peor que esperar un instante.
    case 'resolving':
      return (
        <AppScreen tone="kiosk">
          <LoadingState label={t('boot.resolvingSession')} />
        </AppScreen>
      );
    // Un iPad en modo kiosco no abre el panel: el reloj compartido manda (§6.1).
    case 'kiosk':
      return <Redirect href="/kiosk" />;
    case 'signIn':
      return <Redirect href="/(auth)/sign-in" />;
    // La membresía no se pudo leer: se explica y se ofrece reintentar, en vez de
    // dejar el panel cargando para siempre (§20).
    case 'membershipError':
      return (
        <AppScreen tone="canvas">
          <AdminErrorState error={destination.error} onRetry={retry} />
        </AppScreen>
      );
    // Sesión válida sin rol administrativo: no es el sitio de esa persona. La
    // explicación la pinta la ruta raíz, en un solo sitio.
    case 'noAdminRole':
      return <Redirect href="/" />;
    case 'adminPanel':
      break;
  }

  return (
    <ManagerScopeProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary600,
          tabBarInactiveTintColor: colors.ink500,
          // Sidebar en iPad ancho, barra inferior en teléfono.
          tabBarPosition: useSidebar ? 'left' : 'bottom',
          // La variante `material` es la que sabe dibujarse en vertical con
          // etiqueta al lado del icono; `uikit` es la barra inferior de iOS.
          tabBarVariant: useSidebar ? 'material' : 'uikit',
          tabBarLabelPosition: useSidebar ? 'beside-icon' : 'below-icon',
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderRightColor: colors.border,
            borderRightWidth: useSidebar ? borderWidth.hairline : 0,
            minHeight: sizes.touchTargetPreferred,
            paddingTop: useSidebar ? spacing.base : 0,
          },
          tabBarItemStyle: {
            minHeight: sizes.touchTargetPreferred,
            justifyContent: 'center',
          },
          tabBarLabelStyle: {
            fontFamily: fontFamily.medium,
            fontSize: fontSize.label,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('admin.tabHome'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="home-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="team"
          options={{
            title: t('admin.tabTeam'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="people-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: t('admin.tabSchedule'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="calendar-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="hours"
          options={{
            title: t('admin.tabHours'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="time-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: t('admin.tabMore'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="ellipsis-horizontal" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
      </Tabs>
    </ManagerScopeProvider>
  );
}
