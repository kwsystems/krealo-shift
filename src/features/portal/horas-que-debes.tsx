import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, SeparadorDeRegistro, Stack } from '@/components/ui/layout';
import { formatDateKeyShort } from '@/features/schedules/week';
import {
  fetchMisHorasDebidas,
  minutosPendientes,
  pendientes,
} from '@/features/timesheets/horas-debidas';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';
import { duracion } from '@/features/timesheets/duracion';

/**
 * LAS HORAS QUE DEBES, en el celular de la persona (Andree, 1-oct: «a ella debería
 * aparecerle en su apartado»). Solo lo pendiente —lo compensado o perdonado ya no se
 * debe— con el día y la nota que dejó quien lo registró. Sin nada pendiente, no sale:
 * una tarjeta que dice «no debes nada» todos los días es ruido.
 */
export function HorasQueDebes({
  organizationId,
  employeeId,
  language,
}: {
  organizationId: string;
  employeeId: string;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const consulta = useQuery({
    queryKey: ['portal', 'horas-debidas', employeeId],
    queryFn: () => fetchMisHorasDebidas({ organizationId, employeeId }),
  });
  const filas = pendientes(consulta.data ?? []);
  /*
   * SI NO SE PUDO LEER, SE DICE (auditoría, 4-oct). Escondida, la tarjeta se leía como «no
   * debes nada» de una consulta que había fallado.
   */
  if (consulta.isError) {
    return (
      <Card style={estilos.caja} testID="mi-horario-debes-error">
        <Stack gap={spacing.sm}>
          <AppText variant="help" tone="danger">
            {t('portal.owedError')}
          </AppText>
          <SecondaryButton
            label={t('common.retry')}
            onPress={() => void consulta.refetch()}
            fullWidth={false}
          />
        </Stack>
      </Card>
    );
  }
  if (filas.length === 0) return null;

  return (
    <Card style={estilos.caja} testID="mi-horario-debes">
      <Stack gap={spacing.sm}>
        <Row justify="space-between" align="center" gap={spacing.md}>
          <AppText variant="section">{t('portal.owedTitle')}</AppText>
          <AppText variant="section" tone="warning" tabular testID="mi-horario-debes-total">
            {duracion(t, minutosPendientes(filas))}
          </AppText>
        </Row>
        <AppText variant="help" tone="muted">
          {t('portal.owedBody')}
        </AppText>
        {filas.map((fila, i) => (
          <View key={fila.id}>
            {i > 0 ? <SeparadorDeRegistro /> : null}
            <Row justify="space-between" align="center" gap={spacing.md} style={estilos.fila}>
              <Stack gap={0} style={estilos.crece}>
                <AppText variant="body">{formatDateKeyShort(fila.work_date, language)}</AppText>
                {fila.note === null ? null : (
                  <AppText variant="label" tone="subtle">
                    {fila.note}
                  </AppText>
                )}
              </Stack>
              <AppText variant="bodyStrong" tabular>
                {duracion(t, fila.minutes)}
              </AppText>
            </Row>
          </View>
        ))}
      </Stack>
    </Card>
  );
}

const useEstilos = estilosDelTema(() => ({
  caja: { gap: spacing.sm },
  fila: { paddingVertical: spacing.xs },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
}));
