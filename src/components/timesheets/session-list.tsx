import { useCallback } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { SessionRow } from './session-row';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import type { WorkSession } from '@/features/timesheets/api';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import type { TimeFormatPreference } from '@/utils/time';

/**
 * Lista de sesiones de la hoja de tiempo, VIRTUALIZADA (§23).
 *
 * Es la lista que más crece de toda la app: un mes de un local con cincuenta personas son
 * más de mil filas, y se pintaban todas de golpe con un `.map()` dentro de un
 * `ScrollView`. Cambiar un filtro las volvía a renderizar todas.
 *
 * `renderItem` y `keyExtractor` van estables —`useCallback` y una función de módulo—
 * porque definidos dentro de la pantalla se recrean en cada render y anulan cualquier
 * memorización de las filas.
 */

export type SessionListProps = {
  sessions: WorkSession[];
  employeeNames: Map<string, string>;
  alertsBySession: Map<string, TimesheetAlert[]>;
  unknownEmployeeLabel: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  onSelect: (session: WorkSession) => void;
  testID?: string;
};

export function SessionList({
  sessions,
  employeeNames,
  alertsBySession,
  unknownEmployeeLabel,
  timezone,
  timeFormat,
  language,
  onSelect,
  testID = 'timesheet-session-list',
}: SessionListProps) {
  const renderItem = useCallback(
    ({ item }: { item: WorkSession }) => (
      <SessionRow
        session={item}
        employeeName={employeeNames.get(item.employee_id) ?? unknownEmployeeLabel}
        alerts={alertsBySession.get(item.id) ?? []}
        timezone={timezone}
        timeFormat={timeFormat}
        language={language}
        onPress={onSelect}
        testID={`session-${item.id}`}
      />
    ),
    [
      employeeNames,
      alertsBySession,
      unknownEmployeeLabel,
      timezone,
      timeFormat,
      language,
      onSelect,
    ],
  );

  return (
    <FlatList
      data={sessions}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      style={styles.lista}
      contentContainerStyle={styles.contenido}
      testID={testID}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
}

const keyExtractor = (session: WorkSession) => session.id;

const styles = StyleSheet.create({
  lista: { flex: 1 },
  contenido: { gap: spacing.sm, paddingBottom: spacing.xl },
});
