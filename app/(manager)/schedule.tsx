import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { ScheduleScreen } from '@/features/schedules/schedule-screen';

/** Pestaña Horario (§6.3, §11.3): la función principal del panel administrativo. */
/**
 * El `testID` va en la ruta y no dentro de la pantalla a proposito: identifica "se
 * llego a esta pestaña del panel", que es lo que un flujo E2E necesita afirmar, y
 * no un detalle de la pantalla. Asi tambien se puede comprobar lo contrario: que
 * alguien SIN permiso no llega. Ver e2e/README.md.
 */
export default function ManagerScheduleRoute() {
  const router = useRouter();
  return (
    <View style={{ flex: 1 }} testID="manager-schedule">
      <ScheduleScreen onGoToTeam={() => router.push('/(manager)/team')} />
    </View>
  );
}
