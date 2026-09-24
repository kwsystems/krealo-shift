import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AnclaDePersona } from '@/components/ui/ancla';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { TeamMember } from '@/features/team/hooks';
import { estilosDelTema } from '@/theme/estilos';
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
  const styles = useEstilos();

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
      /*
       * EL NOMBRE ACCESIBLE SÍ DICE «horas recientes», aunque la columna ya no lo escriba.
       * Quien mira tiene la cabecera de la columna para saber qué es ese número; quien
       * navega con un lector de pantalla no la tiene a mano, así que aquí va con palabras.
       */
      accessibilityLabel={`${member.displayName}. ${estado}. ${t('team.recentHours')}: ${minutesToHHmm(recentMinutes)}`}
      accessibilityHint={t('team.openEmployeeHint')}
      testID={`team-member-${member.id}`}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <View style={styles.fila}>
        <Row gap={spacing.md} align="center">
          {/*
            EL ANCLA DE LA FILA: las iniciales.

            Una lista de veinte nombres sin nada a la izquierda obliga a leer para
            encontrar a alguien. Con un ancla, el ojo recorre la columna y se detiene en la
            forma que reconoce; leer es el segundo paso, no el primero.

            Son INICIALES y no una foto: la app no guarda retratos del equipo —solo fotos
            de fichaje, que son otra cosa y se borran por retención— así que una foto aquí
            sería un hueco gris en todas las filas.

            `aria-hidden` no hace falta: el `accessibilityLabel` del Pressable ya dice el
            nombre completo, y las iniciales no añaden nada que oír.
          */}
          <AnclaDePersona semilla={member.id} nombre={member.displayName} />
          <Stack gap={spacing.xs} style={styles.creceYEncoge}>
            <AppText variant="bodyStrong">{member.displayName}</AppText>
            <AppText variant="help" tone="subtle">
              {puestos}
            </AppText>
            {/*
              Sin sede no puede fichar: el reloj esta atado a una tienda y solo ofrece a
              quien trabaja alli. Asi que esto no es un dato que falte, es alguien que no
              puede trabajar, y por eso se dice en la fila y no escondido en su ficha.
            */}
            {member.locationIds.length === 0 ? (
              <AppText variant="help" tone="danger">
                {t('team.noLocationWarning')}
              </AppText>
            ) : null}
          </Stack>
          {/*
            COLUMNAS, NO DOS EXTREMOS.

            Antes esto era un `space-between` con el nombre pegado a la izquierda y un
            bloque con la insignia y las horas pegado a la derecha: en un monitor de 1440
            quedaban SETECIENTOS píxeles de nada en medio, y el ojo tenía que saltar de una
            punta a la otra en cada fila. Lo dijo Andree mirando la app publicada: «se ve
            raro».

            Ahora las horas y el estado son columnas de ancho fijo, así que caen en la
            MISMA vertical en todas las filas. Eso es lo que convierte una lista en una
            tabla que se recorre de un vistazo: el total de cada persona se compara con el
            de la de arriba sin leer, porque está justo debajo.

            Las horas van con cifras tabulares y alineadas a la derecha, que es la única
            forma de que dos números se puedan comparar en columna.
          */}
          <AppText variant="label" tone="subtle" tabular style={estilosDeColumna.horas}>
            {minutesToHHmm(recentMinutes)}
          </AppText>
          <View style={estilosDeColumna.estado}>
            <StatusBadge
              label={estado}
              tone={member.status === 'active' ? 'working' : 'offShift'}
              icon={member.status === 'active' ? 'checkmark-circle' : 'pause-circle-outline'}
              compact
            />
          </View>
        </Row>
      </View>
    </Pressable>
  );
}

export const MemberRow = memo(MemberRowBase);

const useEstilos = estilosDelTema((colors) => ({
  pressed: { opacity: 0.9 },
  /*
   * LA FILA ES UNA FILA DE TABLA, no una tarjeta. Comparte superficie con sus vecinas y
   * las separa una regla fina (`SeparadorDeRegistro`, en la lista). Antes cada una traía
   * su propia `Card`: quince sesiones eran quince planos flotando, cada uno pagando
   * relleno, sombra y hueco justo en la pantalla donde más falta hace el alto.
   */
  creceYEncoge: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
}));

/**
 * Las dos columnas de la derecha.
 *
 * Anchos FIJOS a propósito: lo que las hace servir es que caigan en la misma vertical en
 * todas las filas. Si creciesen con su contenido, cada fila tendría sus columnas en un
 * sitio distinto y volveríamos a una lista de fichas.
 *
 * Y la etiqueta «Horas recientes:» se cae del texto: repetida en veinte filas es ruido, y
 * lo que significa la columna se dice UNA vez en su cabecera. El nombre accesible de la
 * fila sí la conserva, porque ahí no hay cabecera que mirar.
 */
const estilosDeColumna = StyleSheet.create({
  horas: { width: 104, textAlign: 'right', flexShrink: 0 },
  estado: { width: 104, alignItems: 'flex-end', flexShrink: 0 },
});
