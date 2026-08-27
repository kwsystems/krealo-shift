import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AdminErrorState } from '@/components/schedule/data-states';
import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { ManagerScopeProvider, useManagerMembership } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { useKioskStore } from '@/stores/kiosk-store';
import { canUseAdminPanel, useSessionStore } from '@/stores/session-store';
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
 */
export default function ManagerLayout() {
  const { t } = useTranslation();
  const { useSidebar } = useResponsive();

  const phase = useSessionStore((s) => s.phase);
  const storedRole = useSessionStore((s) => s.role);
  const kioskHydrated = useKioskStore((s) => s.hydrated);
  const binding = useKioskStore((s) => s.binding);

  // La membresía se resuelve aquí, antes de la guarda de rol: la sesión de
  // Supabase dice quién eres, no qué puedes hacer. La consulta comparte clave con
  // el provider, así que no se pregunta dos veces.
  const membership = useManagerMembership(
    phase === 'signedIn' && kioskHydrated && binding === null,
  );

  // Mientras no se sabe, no se muestra nada: ni el panel ni el acceso. Mandar a
  // iniciar sesión a quien SÍ la tiene sería peor que esperar un instante.
  if (phase === 'unknown' || !kioskHydrated) {
    return (
      <AppScreen tone="kiosk">
        <LoadingState label={t('boot.resolvingSession')} />
      </AppScreen>
    );
  }

  // Un iPad en modo kiosco no abre el panel: el reloj compartido manda (§6.1).
  if (binding !== null) {
    return <Redirect href="/kiosk" />;
  }

  if (phase !== 'signedIn') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // La membresía no se pudo leer: se explica y se ofrece reintentar, en vez de
  // dejar el panel cargando para siempre (§20).
  if (membership.error !== null) {
    return (
      <AppScreen tone="canvas">
        <AdminErrorState error={membership.error} onRetry={() => void membership.refetch()} />
      </AppScreen>
    );
  }

  const role = membership.data?.role ?? storedRole;

  // Rol todavía sin resolver: se espera, igual que en el arranque.
  if (role === null) {
    return (
      <AppScreen tone="kiosk">
        <LoadingState label={t('boot.resolvingSession')} />
      </AppScreen>
    );
  }

  // Sesión válida pero sin rol administrativo: no es el sitio de esa persona.
  if (!canUseAdminPanel(role)) {
    return <Redirect href="/" />;
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
