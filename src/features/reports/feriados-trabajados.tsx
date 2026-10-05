import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ChartCard } from '@/components/charts/chart-frame';
import { AppText } from '@/components/ui/app-text';
import { Row, SeparadorDeRegistro, Stack } from '@/components/ui/layout';
import { formatDateKeyShort, formatWeekdayShort } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

import type { TrabajoEnFeriado } from './aggregate';

/**
 * QUIÉN TRABAJÓ CADA FERIADO (4-oct). Andree: «verifica en los reportes la gente que trabajó
 * en feriado». La casilla de arriba decía cuántas horas; esto dice de quién, día por día,
 * porque es la persona la que cobra triple si no tuvo otro día de descanso a cambio. La
 * regla va escrita debajo del título: quien mira esto va a pagar.
 *
 * Tocar a alguien filtra el tablero a esa persona, como «Asistencia por persona».
 */
export function FeriadosTrabajados({
  trabajo,
  nombre,
  language,
  elegida,
  onElegir,
}: {
  /** Ya filtrado por los días y por la persona elegida, como el resto del tablero. */
  trabajo: readonly TrabajoEnFeriado[];
  nombre: (employeeId: string) => string;
  language: SupportedLanguage;
  elegida: string | null;
  onElegir: (employeeId: string) => void;
}) {
  const { t } = useTranslation();
  if (trabajo.length === 0) return null;

  return (
    <ChartCard
      title={t('reports.holidayWork.title')}
      subtitle={t('holidays.payRule')}
      footnote={t('reports.holidayWork.footnote')}
      testID="report-holiday-work"
    >
      <Stack gap={spacing.sm}>
        {trabajo.map((dia, i) => (
          <View key={dia.dia} testID={`report-holiday-${dia.dia}`}>
            {i > 0 ? <SeparadorDeRegistro /> : null}
            <Stack gap={spacing.xs}>
              <AppText variant="bodyStrong" tone="danger">
                {`${formatWeekdayShort(dia.dia, language)} ${formatDateKeyShort(dia.dia, language)} · ${t(`holidays.pe.${dia.feriado}`)}`}
              </AppText>
              {dia.personas.length === 0 ? (
                <AppText variant="help" tone="subtle">
                  {t('reports.holidayWork.nobody')}
                </AppText>
              ) : (
                dia.personas.map((persona) => (
                  <Pressable
                    key={persona.employeeId}
                    onPress={() => onElegir(persona.employeeId)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: elegida === persona.employeeId }}
                    testID={`report-holiday-${dia.dia}-${persona.employeeId}`}
                  >
                    <Row justify="space-between" gap={spacing.md}>
                      <AppText
                        variant="body"
                        tone={elegida === persona.employeeId ? 'primary' : 'default'}
                      >
                        {nombre(persona.employeeId)}
                      </AppText>
                      <AppText variant="body" tabular>
                        {minutesToHHmm(persona.minutos)}
                      </AppText>
                    </Row>
                  </Pressable>
                ))
              )}
            </Stack>
          </View>
        ))}
      </Stack>
    </ChartCard>
  );
}
