import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontFamily, fontSize, sizes } from '@/theme/tokens';

/**
 * Navegación de propietario, gerente y administrador (§6.3).
 *
 * Cinco pestañas: Inicio, Equipo, Horario, Horas y Más. Horario es una pestaña
 * principal, no una pantalla escondida, porque cambiar los turnos cada semana es
 * la tarea central del administrador (§6.3, §11.3).
 *
 * Pendiente de P0-5: en iPad con ancho suficiente esta barra debe convertirse en
 * un sidebar adaptable en lugar de estirar una interfaz de teléfono. El hook
 * `useResponsive().useSidebar` ya expone la decisión.
 */
export default function ManagerLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary600,
        tabBarInactiveTintColor: colors.ink500,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          minHeight: sizes.touchTargetPreferred,
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
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: t('admin.tabTeam'),
          tabBarIcon: ({ color }) => <Ionicons name="people-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('admin.tabSchedule'),
          tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="hours"
        options={{
          title: t('admin.tabHours'),
          tabBarIcon: ({ color }) => <Ionicons name="time-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('admin.tabMore'),
          tabBarIcon: ({ color }) => <Ionicons name="ellipsis-horizontal" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
