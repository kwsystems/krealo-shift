import { useCallback, type ReactElement } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SessionRow } from './session-row';
import { AppText } from '@/components/ui/app-text';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import type { WorkSession } from '@/features/timesheets/api';
import type { SupportedLanguage } from '@/i18n';
import { SeparadorDeRegistro } from '@/components/ui/layout';
import { estilosDelTema } from '@/theme/estilos';
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
      /*
        LA CABECERA DE LA PANTALLA Y ENCIMA LOS ROTULOS DE LAS COLUMNAS. Van juntos porque
        los dos tienen que desplazarse con la lista: una cabecera de columna que se queda
        fija mientras las filas suben señalaría a la nada en cuanto se pasara de la
        primera pantalla.
      */
      ListHeaderComponent={
        <>
          {header}
          <CabeceraDeColumnas />
        </>
      }
      ListEmptyComponent={empty}
      ItemSeparatorComponent={SeparadorDeRegistro}
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
  /*
   * SIN HUECO ENTRE FILAS: las separa una regla, no un vacío. El hueco era lo que hacía
   * que quince sesiones parecieran quince objetos sueltos en vez de una hoja.
   */
  contenido: { paddingBottom: spacing.xl },
});

/** Los rotulos de las columnas de la derecha, con los MISMOS anchos que las filas. */
function CabeceraDeColumnas() {
  const { t } = useTranslation();
  const estilos = useEstilosDeCabecera();
  return (
    <View style={estilos.cabecera}>
      <View style={estilos.hueco} />
      <AppText variant="label" tone="subtle" accessibilityRole="header" style={estilos.netas}>
        {t('timesheet.netHours')}
      </AppText>
      <AppText variant="label" tone="subtle" accessibilityRole="header" style={estilos.pausas}>
        {t('timesheet.breaks')}
      </AppText>
    </View>
  );
}

const useEstilosDeCabecera = estilosDelTema((colors) => ({
  cabecera: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  hueco: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  netas: { width: 80, textAlign: 'right', flexShrink: 0 },
  pausas: { width: 72, textAlign: 'right', flexShrink: 0 },
}));
