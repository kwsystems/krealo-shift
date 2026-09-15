import { View } from 'react-native';

import { ReportsScreen } from '@/features/reports/reports-screen';

/**
 * Pestaña Reportes (§11.4, pedido de Andree 2026-09-15).
 *
 * El `testID` va en la ruta, igual que en las demás: identifica «se llegó a esta
 * pestaña del panel», que es lo que un flujo E2E afirma, y no un detalle interno de
 * la pantalla.
 */
export default function ManagerReportsRoute() {
  return (
    <View style={{ flex: 1 }} testID="manager-reports">
      <ReportsScreen />
    </View>
  );
}
