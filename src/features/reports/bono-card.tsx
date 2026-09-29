import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { EstadoDelBono, ResultadoDelBono } from './bono';
import { ChartCard } from '@/components/charts/chart-frame';
import { InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { Row, SeparadorDeRegistro, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { formatDateKeyShort, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { spacing, type StatusTone } from '@/theme/tokens';

/**
 * EL APARTADO DEL BONO DE ASISTENCIA, en Reportes por mes.
 *
 * Una lista por estado y, en cada persona, el PORQUÉ en palabras: «Faltó el 12 sep»,
 * «Llegó tarde el 3 y el 15 sep». Un «no» sin motivo es lo que obliga a quien paga a ir a
 * Horas a buscarlo, y a quien no lo cobra a preguntar por qué. La regla está en `bono.ts`.
 */

const ORDEN: EstadoDelBono[] = ['gana', 'enCamino', 'pierde', 'noAplica'];

const TONO: Record<EstadoDelBono, StatusTone> = {
  gana: 'working',
  enCamino: 'info',
  pierde: 'late',
  noAplica: 'offShift',
};

const ICONO: Record<
  EstadoDelBono,
  'ribbon-outline' | 'hourglass-outline' | 'close-circle-outline' | 'remove-circle-outline'
> = {
  gana: 'ribbon-outline',
  enCamino: 'hourglass-outline',
  pierde: 'close-circle-outline',
  noAplica: 'remove-circle-outline',
};

/** «3 sep», «3 sep y 15 sep», «3 sep, 15 sep, 22 sep y 2 más». */
function dias(lista: DateKey[], language: SupportedLanguage, y: string, mas: string): string {
  const cortos = lista.slice(0, 3).map((d) => formatDateKeyShort(d, language));
  if (lista.length > 3) return `${cortos.join(', ')} ${mas}`;
  if (cortos.length <= 1) return cortos[0] ?? '';
  return `${cortos.slice(0, -1).join(', ')} ${y} ${cortos[cortos.length - 1]}`;
}

export function BonoCard({
  resultados,
  diasSinReloj = [],
  mesTerminado,
  nombre,
  language,
}: {
  resultados: ResultadoDelBono[];
  /** Días con turnos en que nadie fichó en la tienda: no cuentan. Ver `bono.ts`. */
  diasSinReloj?: DateKey[];
  mesTerminado: boolean;
  nombre: (employeeId: string) => string;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();

  const detalle = (r: ResultadoDelBono): string => {
    if (r.estado === 'noAplica') {
      return t('reports.bonusJoinedMidMonth', {
        date: formatDateKeyShort(r.ingreso ?? '', language),
      });
    }
    if (r.estado === 'pierde') {
      const partes: string[] = [];
      const y = t('reports.bonusAnd');
      if (r.faltas.length > 0) {
        partes.push(
          t('reports.bonusAbsent', {
            days: dias(
              r.faltas,
              language,
              y,
              t('reports.bonusMore', { count: r.faltas.length - 3 }),
            ),
          }),
        );
      }
      if (r.tardanzas.length > 0) {
        partes.push(
          t('reports.bonusLate', {
            days: dias(
              r.tardanzas,
              language,
              y,
              t('reports.bonusMore', { count: r.tardanzas.length - 3 }),
            ),
          }),
        );
      }
      return partes.join(' · ');
    }
    return r.estado === 'gana'
      ? t('reports.bonusAllOnTime', { count: r.cumplidos })
      : t('reports.bonusSoFar', { count: r.cumplidos });
  };

  const etiqueta: Record<EstadoDelBono, string> = {
    gana: t('reports.bonusWins'),
    enCamino: t('reports.bonusOnTrack'),
    pierde: t('reports.bonusLoses'),
    noAplica: t('reports.bonusNotApplicable'),
  };

  return (
    <ChartCard
      title={t('reports.bonusTitle')}
      subtitle={t('reports.bonusRule')}
      footnote={t('reports.bonusProposal')}
      testID="report-bonus"
    >
      <Stack gap={spacing.md}>
        {mesTerminado ? null : (
          <InlineNotice
            tone="info"
            icon="information-circle-outline"
            body={t('reports.bonusProvisional')}
          />
        )}
        {diasSinReloj.length === 0 ? null : (
          <InlineNotice
            tone="info"
            icon="calendar-outline"
            body={t('reports.bonusDaysWithoutClock', {
              days: dias(
                diasSinReloj,
                language,
                t('reports.bonusAnd'),
                t('reports.bonusMore', { count: diasSinReloj.length - 3 }),
              ),
            })}
            testID="report-bonus-sin-reloj"
          />
        )}
        {resultados.length === 0 ? (
          <AppText variant="help" tone="subtle">
            {t('reports.bonusNobody')}
          </AppText>
        ) : (
          ORDEN.map((estado) => {
            const deEste = resultados.filter((r) => r.estado === estado);
            if (deEste.length === 0) return null;
            return (
              <Stack key={estado} gap={spacing.xs} testID={`report-bonus-${estado}`}>
                <AppText variant="label" tone="muted">
                  {t(`reports.bonusGroup_${estado}`, { count: deEste.length })}
                </AppText>
                {deEste.map((r, i) => (
                  <View key={r.employeeId}>
                    {i > 0 ? <SeparadorDeRegistro /> : null}
                    <Row
                      gap={spacing.md}
                      align="center"
                      justify="space-between"
                      wrap
                      style={{ paddingVertical: spacing.sm }}
                    >
                      <Stack gap={0} style={{ flexShrink: 1, minWidth: 0 }}>
                        <AppText variant="bodyStrong">{nombre(r.employeeId)}</AppText>
                        <AppText variant="help" tone="muted">
                          {detalle(r)}
                        </AppText>
                      </Stack>
                      <StatusBadge
                        label={etiqueta[r.estado]}
                        tone={TONO[r.estado]}
                        icon={ICONO[r.estado]}
                        compact
                      />
                    </Row>
                  </View>
                ))}
              </Stack>
            );
          })
        )}
      </Stack>
    </ChartCard>
  );
}
