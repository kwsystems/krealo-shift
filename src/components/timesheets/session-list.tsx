import { useCallback, useMemo, type ReactElement } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SessionRow, type HoraExtraDeLaFila } from './session-row';
import { AppText } from '@/components/ui/app-text';
import { EtiquetasDelDia } from '@/components/schedule/feriado';
import type { TipoDeTienda } from '@/domain/fechas-comerciales';
import { estadoDeFila, type EnCurso } from '@/features/timesheets/en-curso';
import {
  dateKeyOf,
  formatDateKeyShort,
  formatWeekdayShort,
  type DateKey,
} from '@/features/schedules/week';
import type { TimesheetAlert } from '@/features/timesheets/alerts';
import type { WorkSession } from '@/features/timesheets/api';
import type { SupportedLanguage } from '@/i18n';
import { SeparadorDeCabecera, SeparadorDeRegistro } from '@/components/ui/layout';
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
  /** Los avisos que son un dato y no piden decisión: en gris (8-oct). */
  registroBySession?: Map<string, TimesheetAlert[]>;
  /** Quién está dentro ahora, por sesión. Vacío mientras no llega: las abiertas se pintan «trabajando». */
  enCursoPorSesion?: Map<string, EnCurso>;
  /** El minuto actual, para contar en vivo las jornadas abiertas. */
  nowISO: string;
  /** La hora extra del día de esa sesión, aprobada o posible: ver `horas-extra.ts`. */
  horaExtraPorSesion?: Map<string, HoraExtraDeLaFila>;
  unknownEmployeeLabel: string;
  timezone: string;
  /** El tipo de tienda: la cabecera de cada día marca sus fechas con más clientes. */
  tipoDeTienda?: TipoDeTienda | null;
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

/**
 * UNA FILA DE LA LISTA: una jornada, o la cabecera de su día (auditoría, 4-oct). En la
 * semana una persona salía siete veces con «08:00 – 17:10» y nada decía de qué día era
 * cada una. Ahora las jornadas van bajo su día («sáb 3 oct»), y las de quien está dentro
 * —que van arriba, ver `dentroPrimero`— bajo «Dentro ahora».
 */
type Elemento =
  | { tipo: 'dia'; clave: string; dia: DateKey | null }
  | { tipo: 'sesion'; clave: string; sesion: WorkSession };

export function SessionList({
  sessions,
  employeeNames,
  alertsBySession,
  registroBySession,
  enCursoPorSesion,
  nowISO,
  horaExtraPorSesion,
  unknownEmployeeLabel,
  timezone,
  tipoDeTienda = null,
  timeFormat,
  language,
  onSelect,
  header,
  empty,
  testID = 'timesheet-session-list',
}: SessionListProps) {
  const { t } = useTranslation();
  const elementos = useMemo<Elemento[]>(() => {
    const lista: Elemento[] = [];
    let anterior: string | null = null;
    for (const sesion of sessions) {
      const estado = estadoDeFila(
        sesion,
        alertsBySession.get(sesion.id) ?? [],
        enCursoPorSesion?.get(sesion.id),
      );
      const dentro = estado === 'trabajando' || estado === 'descanso';
      const dia = dateKeyOf(sesion.starts_at, timezone);
      const grupo = dentro ? 'dentro' : dia;
      if (grupo !== anterior) {
        lista.push({ tipo: 'dia', clave: `dia-${grupo}`, dia: dentro ? null : dia });
        anterior = grupo;
      }
      lista.push({ tipo: 'sesion', clave: sesion.id, sesion });
    }
    return lista;
  }, [sessions, alertsBySession, enCursoPorSesion, timezone]);

  const renderItem = useCallback(
    ({ item }: { item: Elemento }) =>
      item.tipo === 'dia' ? (
        <CabeceraDelDia
          texto={
            item.dia === null
              ? t('timesheet.liveTile')
              : `${formatWeekdayShort(item.dia, language)} ${formatDateKeyShort(item.dia, language)}`
          }
          testID={`timesheet-day-${item.dia ?? 'dentro'}`}
          dia={item.dia}
          timezone={timezone}
          tipoDeTienda={tipoDeTienda ?? null}
        />
      ) : (
        <SessionRow
          session={item.sesion}
          employeeName={employeeNames.get(item.sesion.employee_id) ?? unknownEmployeeLabel}
          alerts={alertsBySession.get(item.sesion.id) ?? []}
          registro={registroBySession?.get(item.sesion.id) ?? []}
          enCurso={enCursoPorSesion?.get(item.sesion.id)}
          horaExtra={horaExtraPorSesion?.get(item.sesion.id)}
          nowISO={nowISO}
          timezone={timezone}
          timeFormat={timeFormat}
          language={language}
          onPress={onSelect}
          testID={`session-${item.sesion.id}`}
        />
      ),
    [
      t,
      employeeNames,
      alertsBySession,
      registroBySession,
      enCursoPorSesion,
      horaExtraPorSesion,
      nowISO,
      unknownEmployeeLabel,
      timezone,
      tipoDeTienda,
      timeFormat,
      language,
      onSelect,
    ],
  );

  return (
    <FlatList
      data={elementos}
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
      ItemSeparatorComponent={SeparadorEntreFilas}
      style={styles.lista}
      contentContainerStyle={styles.contenido}
      testID={testID}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const keyExtractor = (elemento: Elemento) => elemento.clave;

/** Entre dos jornadas, la regla de siempre; bajo la cabecera de un día, ninguna. */
function SeparadorEntreFilas({ leadingItem }: { leadingItem?: Elemento }) {
  return leadingItem?.tipo === 'dia' ? null : <SeparadorDeRegistro />;
}

function CabeceraDelDia({
  texto,
  testID,
  dia,
  timezone,
  tipoDeTienda,
}: {
  texto: string;
  testID: string;
  dia: string | null;
  timezone: string;
  tipoDeTienda: TipoDeTienda | null;
}) {
  const estilos = useEstilosDeCabecera();
  return (
    <View style={estilos.dia} testID={testID}>
      <AppText variant="label" tone="muted" accessibilityRole="header">
        {texto}
      </AppText>
      {/* El feriado y su pago, junto a las horas de ese día: es lo que paga distinto. */}
      {dia === null ? null : (
        <EtiquetasDelDia dateKey={dia} timezone={timezone} tipo={tipoDeTienda} conPago />
      )}
    </View>
  );
}

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
    <>
      <View style={estilos.cabecera}>
        <View style={estilos.hueco} />
        <AppText variant="label" tone="subtle" accessibilityRole="header" style={estilos.netas}>
          {t('timesheet.netHours')}
        </AppText>
        <AppText variant="label" tone="subtle" accessibilityRole="header" style={estilos.pausas}>
          {t('timesheet.breaks')}
        </AppText>
      </View>
      {/* La raya de la cabecera pesa más que las de entre filas: separa dos cosas
          distintas, no dos iguales. Ver `SeparadorDeCabecera`. */}
      <SeparadorDeCabecera />
    </>
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
  dia: {
    backgroundColor: colors.canvas,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  hueco: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  netas: { width: 80, textAlign: 'right', flexShrink: 0 },
  pausas: { width: 72, textAlign: 'right', flexShrink: 0 },
}));
