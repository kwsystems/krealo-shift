import { useCallback, type ReactElement } from 'react';
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
  /**
   * Lo que va ENCIMA de las filas, dentro de la propia lista.
   *
   * Existe para que la pantalla tenga UN SOLO contenedor que se desplaza. Con la
   * cabecera fuera, la lista solo recibía el alto que sobrara, y cuando la cabecera
   * medía más que la pantalla no sobraba nada: la lista quedaba entera por debajo del
   * cristal y no había forma de bajar a ella. Ver el comentario en `timesheets-screen`.
   */
  header?: ReactElement;
  /** Qué enseñar cuando no hay filas: cargando, error o vacío de verdad. */
  empty?: ReactElement;
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
  header,
  empty,
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
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      style={styles.lista}
      contentContainerStyle={styles.contenido}
      testID={testID}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const keyExtractor = (session: WorkSession) => session.id;

const styles = StyleSheet.create({
  lista: { flex: 1 },
  contenido: { gap: spacing.sm, paddingBottom: spacing.xl },
});
