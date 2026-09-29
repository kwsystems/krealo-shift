import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AnclaDePersona } from '@/components/ui/ancla';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack, useRespuestaAlPuntero } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { TeamMember } from '@/features/team/hooks';
import { useResponsive } from '@/hooks/use-responsive';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
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

/** Quien está dentro ahora: si trabaja o está en su descanso, y desde qué hora entró. */
export type DentroEnEquipo = {
  estado: 'trabajando' | 'descanso';
  /** La hora de entrada, ya escrita en el formato de la sede. */
  desde: string;
};

export type MemberRowProps = {
  member: TeamMember;
  /** Minutos trabajados en el periodo reciente, CON lo que lleva hoy si sigue dentro. */
  recentMinutes: number;
  dentro?: DentroEnEquipo;
  jobRoleNames: Map<string, string>;
  onPress: (id: string) => void;
};

function MemberRowBase({ member, recentMinutes, dentro, jobRoleNames, onPress }: MemberRowProps) {
  const { t } = useTranslation();
  const styles = useEstilos();
  const { colors } = useTheme();
  const { isWide } = useResponsive();
  const isCompact = !isWide;
  const respuesta = useRespuestaAlPuntero();

  /*
   * QUIEN ESTÁ DENTRO SE DICE EN LA COLUMNA DE ESTADO, en vez de «Activo». Alguien
   * trabajando ahora es, obviamente, alguien activo, y dos insignias verdes en la misma
   * fila —«Activo» y «Trabajando»— se leerían como dos cosas del mismo peso cuando solo
   * una es noticia. Es la misma palabra, el mismo icono y el mismo verde que en Horas.
   */
  const estado =
    dentro?.estado === 'trabajando'
      ? t('timesheet.stateWorking')
      : dentro?.estado === 'descanso'
        ? t('timesheet.stateOnBreak')
        : member.status === 'active'
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

  const insignia = (
    <StatusBadge
      label={estado}
      tone={
        dentro?.estado === 'trabajando'
          ? 'working'
          : dentro?.estado === 'descanso'
            ? 'onBreak'
            : member.status === 'active'
              ? 'working'
              : 'offShift'
      }
      icon={
        dentro?.estado === 'trabajando'
          ? 'radio-button-on'
          : dentro?.estado === 'descanso'
            ? 'cafe-outline'
            : member.status === 'active'
              ? 'checkmark-circle'
              : 'pause-circle-outline'
      }
      compact
    />
  );

  return (
    <Pressable
      onPress={() => onPress(member.id)}
      accessibilityRole="button"
      /*
       * EL NOMBRE ACCESIBLE SÍ DICE «horas recientes», aunque la columna ya no lo escriba.
       * Quien mira tiene la cabecera de la columna para saber qué es ese número; quien
       * navega con un lector de pantalla no la tiene a mano, así que aquí va con palabras.
       */
      accessibilityLabel={`${member.displayName}. ${estado}${
        dentro === undefined ? '' : `, ${t('timesheet.sinceTime', { time: dentro.desde })}`
      }. ${t('team.recentHours')}: ${minutesToHHmm(recentMinutes)}${
        dentro === undefined ? '' : `, ${t('timesheet.live')}`
      }`}
      accessibilityHint={t('team.openEmployeeHint')}
      testID={`team-member-${member.id}`}
      {...respuesta.props}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.fila,
            dentro?.estado === 'trabajando' ? styles.filaTrabajando : null,
            dentro?.estado === 'descanso' ? styles.filaDescanso : null,
            ...respuesta.estilo(
              pressed,
              dentro?.estado === 'trabajando'
                ? colors.success100
                : dentro?.estado === 'descanso'
                  ? colors.warning100
                  : undefined,
            ),
          ]}
        >
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
              {/*
                SIN BARRA LATERAL EL ESTADO VA AQUÍ, DEBAJO DEL NOMBRE, y a la derecha solo
                quedan las horas. El corte es `isWide` (768) y no `isCompact` (400): un
                teléfono grande mide 414 y ahí el nombre se quedaba con 22 px. Con las dos columnas de 104 px a la derecha, al nombre le
                quedaban unos 40 px y se partía por sílabas —«Bru / no / Sal / aza / r»—:
                todo cabía, nada se recortaba, y ningún arnés lo veía, pero no se leía.
              */}
              {isCompact ? (
                <Row gap={spacing.xs} wrap align="center">
                  {insignia}
                  {dentro === undefined ? null : (
                    <AppText variant="label" tone="muted" tabular>
                      {t('timesheet.sinceTime', { time: dentro.desde })}
                    </AppText>
                  )}
                </Row>
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
            {/*
              LAS HORAS DE QUIEN SIGUE DENTRO CUENTAN YA LO DE HOY, con «en curso» debajo.
              Antes salían solo las jornadas cerradas: la de hoy entraba al marcar la
              salida, así que a media mañana la fila de quien estaba trabajando decía lo
              mismo que si no hubiera venido. La cifra es la misma que la de su fila en
              Horas, porque sale de la misma cuenta.
            */}
            {dentro === undefined ? (
              <AppText
                variant="label"
                tone="subtle"
                tabular
                style={isCompact ? estilosDeColumna.horasCompacta : estilosDeColumna.horas}
              >
                {minutesToHHmm(recentMinutes)}
              </AppText>
            ) : (
              <Stack
                gap={0}
                style={isCompact ? estilosDeColumna.horasCompacta : estilosDeColumna.horas}
              >
                <AppText
                  variant="label"
                  tabular
                  style={estilosDeColumna.derecha}
                  testID={`team-member-${member.id}-en-curso`}
                >
                  {minutesToHHmm(recentMinutes)}
                </AppText>
                <AppText variant="label" tone="subtle" style={estilosDeColumna.derecha}>
                  {dentro.estado === 'trabajando' ? t('timesheet.live') : t('timesheet.paused')}
                </AppText>
              </Stack>
            )}
            {isCompact ? null : (
              <View style={estilosDeColumna.estado}>
                {insignia}
                {dentro === undefined ? null : (
                  <AppText variant="label" tone="muted" tabular style={estilosDeColumna.derecha}>
                    {t('timesheet.sinceTime', { time: dentro.desde })}
                  </AppText>
                )}
              </View>
            )}
          </Row>
        </View>
      )}
    </Pressable>
  );
}

export const MemberRow = memo(MemberRowBase);

const useEstilos = estilosDelTema((colors) => ({
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
  /* El mismo tinte que la fila de Horas de quien está dentro, y por lo mismo. */
  filaTrabajando: { backgroundColor: colors.success50 },
  filaDescanso: { backgroundColor: colors.warning50 },
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
/**
 * LOS ANCHOS DE LAS COLUMNAS, compartidos con la cabecera de la lista: si no coinciden, el
 * rótulo señala la columna de al lado.
 *
 * El estado pasa de 104 a 120 porque «En descanso» no cabía en una línea en su insignia.
 * En teléfono no hay columna de estado (va bajo el nombre) y las horas bajan a 72, lo justo
 * para «00:00» y «en curso», que es lo que le devuelve al nombre el sitio para leerse.
 */
export const ANCHO_DE_COLUMNA = { horas: 104, horasCompacta: 72, estado: 120 } as const;

const estilosDeColumna = StyleSheet.create({
  horas: { width: ANCHO_DE_COLUMNA.horas, textAlign: 'right', flexShrink: 0 },
  horasCompacta: { width: ANCHO_DE_COLUMNA.horasCompacta, textAlign: 'right', flexShrink: 0 },
  derecha: { textAlign: 'right' },
  estado: {
    width: ANCHO_DE_COLUMNA.estado,
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: spacing.xs,
  },
});
