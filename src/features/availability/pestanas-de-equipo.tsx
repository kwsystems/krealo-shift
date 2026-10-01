import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/schedule/fields';
import { useResponsive } from '@/hooks/use-responsive';

/**
 * «PERSONAS | DISPONIBILIDAD» ARRIBA DE EQUIPO, EN EL TELÉFONO (1-oct). En pantalla ancha
 * los dos apartados están en el menú lateral, debajo de Equipo; en el teléfono la barra de
 * abajo ya lleva siete destinos y no cabe un octavo, así que se cambia aquí.
 */
export function PestanasDeEquipo({ activa }: { activa: 'personas' | 'disponibilidad' }) {
  const { t } = useTranslation();
  const { useSidebar } = useResponsive();
  if (useSidebar) return null;
  return (
    <SegmentedControl
      label={t('admin.tabTeam')}
      value={activa}
      options={[
        { value: 'personas', label: t('admin.tabTeamPeople') },
        { value: 'disponibilidad', label: t('admin.tabAvailability') },
      ]}
      onChange={(valor) => {
        if (valor === activa) return;
        router.navigate(valor === 'personas' ? '/(manager)/team' : '/(manager)/availability');
      }}
      testID="equipo-pestanas"
    />
  );
}
