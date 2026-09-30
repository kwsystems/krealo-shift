import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from '@/components/ui/app-text';
import { Row } from '@/components/ui/layout';
import { feriadoDe } from '@/domain/feriados-peru';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * «Feriado · Combate de Angamos», con su bandera, donde se mira un día: la cabecera de la
 * rejilla de Horario, la lista del día en el teléfono y la vista de cada vendedor. Nada si
 * el día no es feriado en esa sede. Ver `src/domain/feriados-peru.ts`.
 *
 * EN ROJO, como en cualquier calendario impreso, y con palabra: el color solo no dice
 * qué feriado es ni que lo sea (§21).
 */
export function EtiquetaDeFeriado({
  dateKey,
  timezone,
  soloPalabra = false,
}: {
  dateKey: string;
  timezone: string;
  /** «Feriado» sin el nombre, para donde no cabe: la cabecera de una columna estrecha. */
  soloPalabra?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const feriado = feriadoDe(dateKey, timezone);
  if (feriado === null) return null;
  const nombre = t(`holidays.pe.${feriado}`);
  return (
    <Row
      gap={spacing.xs}
      align="center"
      accessibilityLabel={t('holidays.labelWithName', { name: nombre })}
      testID={`feriado-${dateKey}`}
    >
      <Ionicons name="flag" size={12} color={colors.danger600} />
      <AppText variant="label" tone="danger">
        {soloPalabra ? t('holidays.label') : t('holidays.labelWithName', { name: nombre })}
      </AppText>
    </Row>
  );
}
