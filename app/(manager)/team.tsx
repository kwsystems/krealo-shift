import { View } from 'react-native';

import { TeamScreen } from '@/features/team/team-screen';

/** Pestaña Equipo (§11.2). La pantalla vive en `features/team` para no engordar la ruta. */
/**
 * El `testID` va en la ruta y no dentro de la pantalla a proposito: identifica "se
 * llego a esta pestaña del panel", que es lo que un flujo E2E necesita afirmar,
 * y no un detalle de la pantalla. Asi tambien se puede comprobar lo contrario:
 * que alguien SIN permiso no llega. Ver e2e/README.md.
 */
export default function ManagerTeamRoute() {
  return (
    <View style={{ flex: 1 }} testID="manager-team">
      <TeamScreen />
    </View>
  );
}
