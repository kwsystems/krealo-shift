import { View } from 'react-native';

import { AvailabilityScreen } from '@/features/availability/availability-screen';

/** Equipo → Disponibilidad (1-oct). La pantalla vive en `features/availability`. */
export default function ManagerAvailabilityRoute() {
  return (
    <View style={{ flex: 1 }} testID="manager-availability">
      <AvailabilityScreen />
    </View>
  );
}
