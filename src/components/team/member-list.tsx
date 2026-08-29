import { useCallback } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { MemberRow } from './member-row';
import type { TeamMember } from '@/features/team/hooks';
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
      style={styles.lista}
      contentContainerStyle={styles.contenido}
      testID={testID}
      // Sin esto, teclear en el filtro cierra el teclado en cada pulsación.
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
}

const keyExtractor = (member: TeamMember) => member.id;

const styles = StyleSheet.create({
  lista: { flex: 1 },
  contenido: { gap: spacing.sm, paddingBottom: spacing.xl },
});
