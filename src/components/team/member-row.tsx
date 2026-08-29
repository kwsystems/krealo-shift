import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Card, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { TeamMember } from '@/features/team/hooks';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * Una fila de la lista de equipo.
 *
 * VIVE APARTE PARA PODER VIRTUALIZAR Y PARA PODER PROBARLA. §23 pide listas
 * virtualizadas y la pantalla pintaba `filtered.map(...)` dentro de un `ScrollView`, o
 * sea que con doscientos empleados montaba doscientas tarjetas de golpe. Un `FlatList`
 * necesita un `renderItem`, y un `renderItem` definido dentro del componente de pantalla
 * se recrea en cada render y anula el `memo` de las filas.
 *
 * `memo` no es decoración: sin él, teclear una letra en el filtro vuelve a renderizar
 * todas las filas montadas.
 */

export type MemberRowProps = {
  member: TeamMember;
  /** Minutos trabajados en el periodo reciente que muestra la pantalla. */
  recentMinutes: number;
  jobRoleNames: Map<string, string>;
  onPress: (id: string) => void;
};

function MemberRowBase({ member, recentMinutes, jobRoleNames, onPress }: MemberRowProps) {
  const { t } = useTranslation();

  const estado =
    member.status === 'active'
      ? t('team.statusActive')
      : member.status === 'inactive'
        ? t('team.statusInactive')
        : t('team.statusInvited');

  const puestos =
    member.jobRoleIds.length === 0
      ? t('team.noJobRolesAssigned')
      : member.jobRoleIds
          .map((id) => jobRoleNames.get(id) ?? '')
          .filter((name) => name !== '')
          .join(', ');

  return (
    <Pressable
      onPress={() => onPress(member.id)}
      accessibilityRole="button"
      accessibilityLabel={`${member.displayName}. ${estado}`}
      accessibilityHint={t('team.openEmployeeHint')}
      testID={`team-member-${member.id}`}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <Card>
        <Row justify="space-between" gap={spacing.md} align="flex-start">
          <Stack gap={spacing.xs}>
            <AppText variant="bodyStrong">{member.displayName}</AppText>
            <AppText variant="help" tone="subtle">
              {puestos}
            </AppText>
          </Stack>
          <Stack gap={spacing.xs}>
            <StatusBadge
              label={estado}
              tone={member.status === 'active' ? 'working' : 'offShift'}
              icon={member.status === 'active' ? 'checkmark-circle' : 'pause-circle-outline'}
              compact
            />
            <AppText variant="label" tone="subtle" tabular>
              {`${t('team.recentHours')}: ${minutesToHHmm(recentMinutes)}`}
            </AppText>
          </Stack>
        </Row>
      </Card>
    </Pressable>
  );
}

export const MemberRow = memo(MemberRowBase);

const styles = StyleSheet.create({
  pressed: { opacity: 0.9 },
});
