import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { AppScreen, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { EmptyState } from '@/components/ui/states';
import { spacing } from '@/theme/tokens';

/**
 * Pantalla del panel administrativo. El contenido real depende del backend
 * (tarea P0-2) y de las vistas de la tarea P0-5: hasta que existan, la pantalla
 * muestra un estado vacío honesto en lugar de datos inventados.
 */
export default function ManagerScheduleScreen() {
  const { t } = useTranslation();

  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer>
        <Stack gap={spacing.lg}>
          <AppText variant="title">{t('schedule.title')}</AppText>
          <EmptyState title={t('schedule.noShiftsThisWeek')} body={t('states.emptyTitle')} />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
