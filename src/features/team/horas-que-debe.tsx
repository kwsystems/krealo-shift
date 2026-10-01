import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AsyncSection } from '@/components/schedule/data-states';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { formatDateKeyShort } from '@/features/schedules/week';
import {
  minutosPendientes,
  useHorasDebidas,
  useSaldarHorasDebidas,
  type HoraDebida,
} from '@/features/timesheets/horas-debidas';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * LAS HORAS QUE DEBE, en su ficha de Equipo (1-oct).
 *
 * Se registran desde «Por resolver» en Horas —«le debe 4 h 49 min»— y aquí se ven juntas,
 * con el total arriba, y se dan por saldadas cuando toca: «ya las compensó» o «perdonar».
 * Nada se borra: lo saldado se queda, tachado de pendientes, para que se sepa qué pasó.
 * La persona ve lo mismo en su celular.
 */
export function HorasQueDebe({
  organizationId,
  locationId,
  employeeId,
  language,
}: {
  organizationId: string | null;
  locationId: string | null;
  employeeId: string;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const consulta = useHorasDebidas({ organizationId, locationId, employeeId });
  const saldar = useSaldarHorasDebidas();
  const filas = consulta.data ?? [];
  const pendiente = minutosPendientes(filas);

  return (
    <Stack gap={spacing.sm} testID="horas-que-debe">
      <Row justify="space-between" align="center" gap={spacing.md}>
        <AppText variant="bodyStrong" accessibilityRole="header">
          {t('team.owedTitle')}
        </AppText>
        <AppText
          variant="bodyStrong"
          tone={pendiente > 0 ? 'warning' : 'subtle'}
          tabular
          testID="horas-que-debe-total"
        >
          {pendiente > 0 ? minutesToHHmm(pendiente) : t('team.owedNone')}
        </AppText>
      </Row>
      <AsyncSection
        isPending={consulta.isPending}
        error={consulta.error}
        onRetry={() => void consulta.refetch()}
      >
        {filas.length === 0 ? (
          <AppText variant="help" tone="subtle">
            {t('team.owedEmpty')}
          </AppText>
        ) : (
          <Stack gap={0}>
            {filas.map((fila, indice) => (
              <FilaDeHoras
                key={fila.id}
                fila={fila}
                conRegla={indice > 0}
                language={language}
                ocupada={saldar.isPending && saldar.variables?.id === fila.id}
                onSaldar={(estado) => saldar.mutate({ id: fila.id, estado })}
              />
            ))}
          </Stack>
        )}
      </AsyncSection>
      {saldar.isError ? (
        <AppText variant="help" tone="danger">
          {t('team.owedSettleFailed')}
        </AppText>
      ) : null}
    </Stack>
  );
}

function FilaDeHoras({
  fila,
  conRegla,
  language,
  ocupada,
  onSaldar,
}: {
  fila: HoraDebida;
  conRegla: boolean;
  language: SupportedLanguage;
  ocupada: boolean;
  onSaldar: (estado: 'pending' | 'compensated' | 'forgiven') => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const saldada = fila.status !== 'pending';
  return (
    <View style={[estilos.fila, conRegla ? estilos.regla : null]} testID={`debe-${fila.id}`}>
      <Row justify="space-between" align="center" gap={spacing.md}>
        <Stack gap={0} style={estilos.crece}>
          <AppText variant="body">{formatDateKeyShort(fila.work_date, language)}</AppText>
          <AppText variant="label" tone="subtle">
            {[
              fila.note,
              saldada
                ? fila.status === 'compensated'
                  ? t('team.owedCompensated')
                  : t('team.owedForgiven')
                : null,
            ]
              .filter((parte): parte is string => parte !== null && parte !== '')
              .join(' · ') || t('team.owedPending')}
          </AppText>
        </Stack>
        <AppText variant="bodyStrong" tone={saldada ? 'subtle' : 'default'} tabular>
          {minutesToHHmm(fila.minutes)}
        </AppText>
      </Row>
      <Row gap={spacing.sm} wrap>
        {saldada ? (
          <GhostButton
            label={t('team.owedUndo')}
            onPress={() => onSaldar('pending')}
            loading={ocupada}
            fullWidth={false}
            testID={`debe-${fila.id}-deshacer`}
          />
        ) : (
          <>
            <GhostButton
              label={t('team.owedCompensate')}
              onPress={() => onSaldar('compensated')}
              loading={ocupada}
              fullWidth={false}
              testID={`debe-${fila.id}-compensada`}
            />
            <GhostButton
              label={t('team.owedForgive')}
              onPress={() => onSaldar('forgiven')}
              fullWidth={false}
              testID={`debe-${fila.id}-perdonar`}
            />
          </>
        )}
      </Row>
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  fila: { paddingVertical: spacing.sm, gap: spacing.xs },
  regla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
}));
