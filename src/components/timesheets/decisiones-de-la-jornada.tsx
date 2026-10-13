import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Row, SeparadorDeRegistro, Stack } from '@/components/ui/layout';
import {
  textoDeDecision,
  type ClaveDeDecision,
  type DecisionDeLaJornada,
} from '@/features/timesheets/decisiones-de-la-jornada';
import { spacing } from '@/theme/tokens';

/**
 * «LO QUE SE DECIDIÓ» EN LA HOJA DE LA JORNADA, con su «Cambiar» (13-oct). Lo pidió Andree
 * tras un «No es extra» equivocado: «necesito que haya opción para poder arreglar estas
 * cosas». Cambiar deja el día como estaba antes de decidir y el caso vuelve a «Por resolver»;
 * la hora extra se cambia en su sección, justo debajo.
 */
export function DecisionesDeLaJornada({
  decisiones,
  cambiando,
  error,
  onCambiar,
}: {
  decisiones: readonly DecisionDeLaJornada[];
  /** La que se está cambiando ahora, para su carga. */
  cambiando: ClaveDeDecision | null;
  error: string | null;
  onCambiar: (clave: ClaveDeDecision) => void;
}) {
  const { t } = useTranslation();
  if (decisiones.length === 0) return null;
  return (
    <Stack gap={spacing.xs} testID="decisiones-de-la-jornada">
      <AppText variant="bodyStrong">{t('timesheet.decisions.title')}</AppText>
      <Stack gap={0}>
        {decisiones.map((decision, i) => (
          <Stack key={decision.clave} gap={0}>
            {i > 0 ? <SeparadorDeRegistro /> : null}
            <Row
              justify="space-between"
              align="center"
              gap={spacing.sm}
              wrap
              testID={`decision-${decision.clave}`}
            >
              <Stack gap={0} style={{ flexShrink: 1, flexGrow: 1, minWidth: 0 }}>
                <AppText variant="body">{textoDeDecision(t, decision)}</AppText>
                {decision.nota !== null ? (
                  <AppText variant="label" tone="subtle">
                    {decision.nota}
                  </AppText>
                ) : null}
              </Stack>
              <GhostButton
                label={t('timesheet.decisions.change')}
                onPress={() => onCambiar(decision.clave)}
                loading={cambiando === decision.clave}
                disabled={cambiando !== null && cambiando !== decision.clave}
                fullWidth={false}
                testID={`decision-${decision.clave}-cambiar`}
              />
            </Row>
          </Stack>
        ))}
      </Stack>
      <AppText variant="help" tone="subtle">
        {t('timesheet.decisions.hint')}
      </AppText>
      {error !== null ? (
        <AppText variant="help" tone="danger" accessibilityRole="alert" testID="decisiones-error">
          {error}
        </AppText>
      ) : null}
    </Stack>
  );
}
