import { useTranslation } from 'react-i18next';

import { AdminSheet, InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Stack } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/**
 * Antes de mandar nada, decir QUÉ se manda y DE CUÁNDO.
 *
 * POR QUÉ NO ES UN BOTÓN DIRECTO
 * Un reporte de horas lleva nombres de personas y su jornada: es dato laboral, y
 * compartirlo por accidente en el grupo equivocado no se deshace ni se olvida. Un
 * botón que abre la hoja del sistema en un toque convierte un resbalón del dedo en
 * una fuga. Así que: primero se ve la frase que dice «las horas de 7 personas, de la
 * semana del 14 al 20», y luego se elige formato. Dos toques, uno de ellos informado.
 *
 * Y LOS DOS FORMATOS NO SON EL MISMO DATO
 * El CSV lleva el detalle por persona; el resumen NO lleva nombres salvo el de quien
 * encabeza el ranking. La hoja lo dice en cada opción, porque la diferencia entre los
 * dos es justamente cuánto se está exponiendo.
 */
export function ShareReportSheet({
  visible,
  onClose,
  periodo,
  personas,
  compartiendo,
  onCsv,
  onResumen,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  /** El periodo ya escrito, tal cual lo lee una persona: «14 al 20 de septiembre». */
  periodo: string;
  personas: number;
  compartiendo: 'csv' | 'resumen' | null;
  onCsv: () => void;
  onResumen: () => void;
  error: unknown;
}) {
  const { t } = useTranslation();

  return (
    <AdminSheet
      visible={visible}
      title={t('reports.shareTitle')}
      onClose={onClose}
      testID="report-share-sheet"
      footer={<GhostButton label={t('common.cancel')} onPress={onClose} />}
    >
      <Stack gap={spacing.base}>
        {/*
          La frase que dice exactamente qué sale de aquí. Va ARRIBA y en tono de aviso,
          no de nota al pie: es la única oportunidad de que alguien se dé cuenta de que
          está a punto de mandar la jornada de doce personas.
        */}
        <InlineNotice
          tone="info"
          icon="document-text-outline"
          body={t('reports.shareWhat', { count: personas, period: periodo })}
          testID="report-share-what"
        />

        <Stack gap={spacing.sm}>
          <PrimaryButton
            label={t('reports.shareCsv')}
            hint={t('reports.shareCsvHint')}
            onPress={onCsv}
            loading={compartiendo === 'csv'}
            disabled={compartiendo !== null}
            testID="report-share-csv"
          />
          <SecondaryButton
            label={t('reports.shareSummary')}
            hint={t('reports.shareSummaryHint')}
            onPress={onResumen}
            loading={compartiendo === 'resumen'}
            disabled={compartiendo !== null}
            testID="report-share-summary"
          />
        </Stack>

        {error !== null && error !== undefined ? (
          <InlineNotice
            tone="late"
            icon="alert-circle-outline"
            title={t('reports.shareFailedTitle')}
            body={t('reports.shareFailedBody')}
            testID="report-share-error"
          />
        ) : null}

        <AppText variant="label" tone="subtle">
          {t('reports.shareFootnote')}
        </AppText>
      </Stack>
    </AdminSheet>
  );
}
