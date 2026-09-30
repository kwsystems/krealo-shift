import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import {
  CLAVE_DE_ESTADO,
  ICONO_DE_ESTADO,
  type EstadoVisible,
} from '@/features/timesheets/en-curso';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * «EN TURNO AHORA», encima del Horario: quién está en la tienda en este momento.
 *
 * Lo pidió Andree el 29-sep: «necesito ver cuando están en turno, y cuándo están
 * almorzando». Las tarjetas de la rejilla ya se tiñen, pero una tarjeta es una celda entre
 * cuarenta y hay que encontrarla —y en un teléfono, bajar hasta su día—. Esto lo dice de
 * un vistazo y sin buscar: una píldora por persona, verde si trabaja y ámbar si está en su
 * pausa, con la palabra y el icono (el color nunca va solo, §21).
 *
 * Al volver del almuerzo su píldora pasa sola a verde: sale de la misma consulta que
 * Inicio y Horas, que se refresca cada minuto.
 */

export type PersonaEnTurno = {
  id: string;
  nombre: string;
  estado: EstadoVisible;
  /** El motivo de la pausa si no es la comida (la comida ya la dice «Almorzando»). */
  motivo: string | null;
  /** Hora ya escrita: la de entrada si trabaja, la del inicio de la pausa si no. */
  desde: string;
};

const CLAVE_DE_MOTIVO: Readonly<Record<string, string>> = {
  rest: 'kiosk.reasonRest',
  permit: 'kiosk.reasonPermit',
  meeting: 'kiosk.reasonMeeting',
  training: 'kiosk.reasonTraining',
  errand: 'kiosk.reasonErrand',
  other: 'kiosk.reasonOther',
};

export function EnTurnoAhora({ personas }: { personas: PersonaEnTurno[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  if (personas.length === 0) return null;

  return (
    <View style={estilos.caja} testID="en-turno-ahora">
      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm} align="center" justify="space-between">
          <AppText variant="bodyStrong" accessibilityRole="header">
            {t('schedule.onShiftNow')}
          </AppText>
          <AppText variant="label" tone="subtle" tabular>
            {t('timesheet.livePeople', { count: personas.length })}
          </AppText>
        </Row>
        <Row gap={spacing.sm} wrap>
          {personas.map((persona) => {
            const trabaja = persona.estado === 'trabajando';
            const clave = persona.motivo === null ? undefined : CLAVE_DE_MOTIVO[persona.motivo];
            const detalle = [
              t(CLAVE_DE_ESTADO[persona.estado]),
              clave === undefined || persona.estado !== 'descanso' ? null : t(clave),
              t('timesheet.sinceTime', { time: persona.desde }),
            ]
              .filter((parte): parte is string => parte !== null)
              .join(' · ');
            return (
              <View
                key={persona.id}
                style={[estilos.pildora, trabaja ? estilos.trabaja : estilos.pausa]}
                accessible
                accessibilityLabel={`${persona.nombre}. ${detalle}`}
                testID={`en-turno-${persona.id}`}
              >
                <Ionicons
                  name={ICONO_DE_ESTADO[persona.estado]}
                  size={16}
                  color={trabaja ? colors.success600 : colors.warning600}
                />
                <AppText variant="label" style={estilos.encoge}>
                  {persona.nombre}
                </AppText>
                <AppText variant="label" tone="muted" tabular>
                  {detalle}
                </AppText>
              </View>
            );
          })}
        </Row>
      </Stack>
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  caja: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.base,
  },
  pildora: {
    /*
     * NUNCA MÁS ANCHA QUE SU CAJA. Una píldora mide lo que su texto, y con un nombre largo
     * —«José Antonio Huamán de la Cruz Salazar · Trabajando · desde 10:21»— medía 431 px en
     * una caja de 328: se salía por la derecha y arrastraba de lado el Horario entero en un
     * teléfono. Con el tope, lo que no cabe baja a la línea de abajo DENTRO de la píldora,
     * que para eso ya envolvía.
     */
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borderWidth.hairline,
  },
  encoge: { flexShrink: 1 },
  /* Los mismos dos tonos que las tarjetas de la rejilla, Horas y Equipo. */
  trabaja: { backgroundColor: colors.success50, borderColor: colors.success600 },
  pausa: { backgroundColor: colors.warning50, borderColor: colors.warning600 },
}));
