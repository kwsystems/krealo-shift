import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AvisoDeVersion } from '@/components/layout/aviso-de-version';
import { ErrorDeMembresia } from '@/components/boot/sin-acceso';
import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { useBootResolution } from '@/features/boot/use-boot-resolution';
import { useDatosAlDia } from '@/hooks/use-datos-al-dia';

/**
 * La vista del vendedor (30-sep): su horario, sus horas y su puntualidad, en el celular.
 *
 * Es un grupo aparte del panel y no una pestaña más, a propósito: el panel monta el alcance
 * de quien gestiona —todas las sedes, todo el equipo— y un vendedor no tiene que cargar ni
 * ver nada de eso. Aquí solo entra quien la resolución de arranque manda aquí; cualquier
 * otro destino se resuelve en la ruta raíz, igual que hace el grupo de acceso.
 */
export default function EmployeeLayout() {
  const { t } = useTranslation();
  const { destination, retry } = useBootResolution();
  // Su horario se pone al día solo, sin recargar: un turno cambiado le llega (7-oct).
  useDatosAlDia();

  if (destination.kind === 'resolving') {
    return (
      <AppScreen tone="canvas">
        <LoadingState label={t('boot.resolvingSession')} />
      </AppScreen>
    );
  }
  if (destination.kind === 'membershipError') {
    return <ErrorDeMembresia error={destination.error} onRetry={retry} />;
  }
  if (destination.kind !== 'employeePortal') return <Redirect href="/" />;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <AvisoDeVersion />
    </View>
  );
}
