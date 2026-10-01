import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { TimesheetsScreen } from '@/features/timesheets/timesheets-screen';

/** Pestaña Horas (§11.4). */
/**
 * El `testID` va en la ruta y no dentro de la pantalla a proposito: identifica "se
 * llego a esta pestaña del panel", que es lo que un flujo E2E necesita afirmar, y
 * no un detalle de la pantalla. Asi tambien se puede comprobar lo contrario: que
 * alguien SIN permiso no llega. Ver e2e/README.md.
 *
 * `semana`, `persona` y `jornada` llegan desde un aviso de Horario (1-oct, marcas fuera
 * de su horario): abren Horas en esa semana, filtrada a esa persona y con su jornada
 * abierta. La `key` vuelve a montar la pantalla si se llega con otro destino.
 */
export default function ManagerHoursRoute() {
  const { semana, persona, jornada } = useLocalSearchParams<{
    semana?: string;
    persona?: string;
    jornada?: string;
  }>();
  return (
    <View style={{ flex: 1 }} testID="manager-hours">
      <TimesheetsScreen
        key={`${semana ?? ''}|${persona ?? ''}|${jornada ?? ''}`}
        destino={{ semana, persona, jornada }}
      />
    </View>
  );
}
