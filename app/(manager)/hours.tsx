import { View } from 'react-native';

import { TimesheetsScreen } from '@/features/timesheets/timesheets-screen';

/** Pestaña Horas (§11.4). */
/**
 * El `testID` va en la ruta y no dentro de la pantalla a proposito: identifica "se
 * llego a esta pestaña del panel", que es lo que un flujo E2E necesita afirmar, y
 * no un detalle de la pantalla. Asi tambien se puede comprobar lo contrario: que
 * alguien SIN permiso no llega. Ver e2e/README.md.
 */
export default function ManagerHoursRoute() {
  return (
    <View style={{ flex: 1 }} testID="manager-hours">
      <TimesheetsScreen />
    </View>
  );
}
