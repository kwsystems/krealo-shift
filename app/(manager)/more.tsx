import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/schedule/fields';
import { AppScreen, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { RequestsPanel } from '@/features/requests/requests-panel';
import { SettingsPanel } from '@/features/settings/settings-panel';
import { spacing } from '@/theme/tokens';

/**
 * Pestaña Más (§6.3): reúne la bandeja de solicitudes (§11.5) y la configuración
 * (§11.6). Son dos secciones de una misma pestaña porque la barra tiene cinco
 * pestañas fijas y ninguna de las dos justifica quitar Horario, Equipo ni Horas.
 */
type Section = 'requests' | 'settings';

export default function ManagerMoreRoute() {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>('requests');

  return (
    <AppScreen tone="canvas" scroll testID="manager-more">
      <ResponsiveContainer>
        <Stack gap={spacing.lg}>
          <SegmentedControl
            label={t('admin.tabMore')}
            value={section}
            options={[
              { value: 'requests', label: t('requests.title') },
              { value: 'settings', label: t('settings.configuration') },
            ]}
            onChange={setSection}
            testID="more-section"
          />
          {section === 'requests' ? <RequestsPanel /> : <SettingsPanel />}
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
