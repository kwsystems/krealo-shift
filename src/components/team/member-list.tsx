import { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SeparadorDeCabecera, SeparadorDeRegistro } from '@/components/ui/layout';
import { MemberRow } from './member-row';
import type { TeamMember } from '@/features/team/hooks';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';

/**
 * Lista del equipo, VIRTUALIZADA (§23).
 *
 * §23 pide listas virtualizadas y la pantalla pintaba `filtered.map(...)` dentro de un
 * `ScrollView`: con doscientos empleados montaba doscientas tarjetas de golpe, y cada
 * letra tecleada en el filtro las volvía a renderizar todas. Con cuatro empleados de
 * demostración no se nota; con una empresa de verdad, sí.
 *
 * ES UN COMPONENTE Y NO UN `FlatList` SUELTO EN LA PANTALLA por dos razones concretas:
 *
 * 1. `renderItem` y `keyExtractor` tienen que ser estables. Definidos dentro del
 *    componente de pantalla se recrean en cada render, y entonces el `memo` de las filas
 *    no sirve para nada: se vuelven a renderizar igual.
 *
 * 2. Así se puede PROBAR que virtualiza. La pantalla necesita una sesión de Supabase
 *    para tener datos; este componente recibe un array, así que una prueba le puede dar
 *    trescientas filas y comprobar que no monta las trescientas.
 *
 * El `flex: 1` es lo que hace que la lista scrollee dentro de la pantalla en vez de
 * crecer sin fin. Va aquí y no en la pantalla para que no se pueda olvidar.
 */

export type MemberListProps = {
  members: TeamMember[];
  /** Minutos recientes por empleado. Un `Map` y no un array: se busca por id en cada fila. */
  recentMinutesByMember: Map<string, number>;
  jobRoleNames: Map<string, string>;
  onSelect: (id: string) => void;
  testID?: string;
};

export function MemberList({
  members,
  recentMinutesByMember,
  jobRoleNames,
  onSelect,
  testID = 'team-member-list',
}: MemberListProps) {
  const renderItem = useCallback(
    ({ item }: { item: TeamMember }) => (
      <MemberRow
        member={item}
        recentMinutes={recentMinutesByMember.get(item.id) ?? 0}
        jobRoleNames={jobRoleNames}
        onPress={onSelect}
      />
    ),
    [recentMinutesByMember, jobRoleNames, onSelect],
  );

  return (
    <FlatList
      data={members}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      /*
       * LA CABECERA DICE UNA VEZ LO QUE SIGNIFICA CADA COLUMNA.
       *
       * Antes cada fila repetía «Horas recientes: 43:05», veinte veces la misma palabra
       * para un dato que cambia. Una cabecera lo dice una vez y las veinte filas se
       * quedan con el número, que es lo que se compara. Es la diferencia entre una tabla y
       * una lista de frases.
       *
       * `accessibilityRole` de cabecera para que un lector de pantalla pueda saltar aquí,
       * y los mismos anchos que las columnas de la fila: si no coincidieran, el rótulo
       * señalaría a la columna de al lado.
       */
      ListHeaderComponent={<CabeceraDeColumnas />}
      /*
       * ESTO FALTABA, y es exactamente lo que Andree señaló mirando la app publicada: «el
       * que separa a Ana y Joseph no se ve, es como que no están separados». No es que no
       * se viera: NO ESTABA. Volcado el DOM, entre fila y fila no había ningún elemento;
       * eran bloques blancos de 73 px pegados sobre fondo blanco.
       *
       * Y lo que lo hizo invisible para mí: el comentario de `member-row` afirmaba que las
       * filas «las separa una regla fina (SeparadorDeRegistro, en la lista)». Lo escribí yo
       * al quitarles la tarjeta y nunca comprobé que la lista la tuviera. Horas sí la
       * llevaba, así que al mirar el código de al lado todo parecía consistente.
       */
      ItemSeparatorComponent={SeparadorDeRegistro}
      style={styles.lista}
      contentContainerStyle={styles.contenido}
      testID={testID}
      // Sin esto, teclear en el filtro cierra el teclado en cada pulsación.
      keyboardShouldPersistTaps="handled"
    />
  );
}

const keyExtractor = (member: TeamMember) => member.id;

const styles = StyleSheet.create({
  lista: { flex: 1 },
  /*
   * SIN HUECO ENTRE FILAS: las separa una regla, no un vacío. El hueco era lo que hacía
   * que quince sesiones parecieran quince objetos sueltos en vez de una hoja.
   */
  contenido: { paddingBottom: spacing.xl },
});

/** Los rótulos de las columnas de la derecha, con los mismos anchos que las filas. */
function CabeceraDeColumnas() {
  const { t } = useTranslation();
  const estilos = useEstilosDeCabecera();
  return (
    <>
      <View style={estilos.cabecera}>
        <View style={estilos.hueco} />
        {/*
        SIN `numberOfLines`: si algún día no cabe, que envuelva en dos líneas en vez de
        cortarse. Un rótulo cortado —«Horas reci…»— obliga a adivinar qué columna es, que
        es exactamente lo que una cabecera existe para evitar. Pasó en el primer intento,
        con la columna a 72 px.
      */}
        <AppText variant="label" tone="subtle" accessibilityRole="header" style={estilos.horas}>
          {t('team.recentHours')}
        </AppText>
        <AppText variant="label" tone="subtle" accessibilityRole="header" style={estilos.estado}>
          {t('team.statusColumn')}
        </AppText>
      </View>
      <SeparadorDeCabecera />
    </>
  );
}

const useEstilosDeCabecera = estilosDelTema((colors) => ({
  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  hueco: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  /* Los MISMOS anchos que en la fila: si no coinciden, el rótulo señala otra columna. */
  horas: { width: 104, textAlign: 'right', flexShrink: 0 },
  estado: { width: 104, textAlign: 'right', flexShrink: 0 },
}));
