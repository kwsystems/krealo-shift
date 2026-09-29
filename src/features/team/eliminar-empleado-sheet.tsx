import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { previewDeleteEmployee } from './api';
import type { TeamMember } from './hooks';
import { AsyncSection } from '@/components/schedule/data-states';
import { AdminSheet, InlineNotice, KeyValueRow } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Stack } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/**
 * «Eliminar definitivamente»: para el empleado de PRUEBA, no para quien se fue.
 *
 * Borra a la persona y todo su historial, y no tiene vuelta atrás. Por eso, antes de
 * pedir nada, esta hoja pregunta al servidor cuánto se va a borrar —sin borrar— y lo
 * enseña: «2 jornadas, 5 fichajes, 3 turnos». Y el botón no se habilita hasta escribir el
 * nombre completo, que es lo que separa «elimino a Ana, la de prueba» de un toque en la
 * fila equivocada. El resto del equipo ya está usando la app.
 */
export function EliminarEmpleadoSheet({
  member,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  member: TeamMember;
  busy: boolean;
  error: unknown;
  onConfirm: (confirmName: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [escrito, setEscrito] = useState('');
  const vista = useQuery({
    queryKey: ['team', 'borrado', member.id],
    queryFn: () => previewDeleteEmployee(member.id),
    staleTime: 0,
  });

  const coincide =
    escrito.trim().toLocaleLowerCase() === member.full_name.trim().toLocaleLowerCase();

  return (
    <AdminSheet
      visible
      title={t('team.deleteTitle', { name: member.displayName })}
      onClose={onClose}
      testID="employee-delete-sheet"
      footer={
        <Stack gap={spacing.sm}>
          <DangerButton
            label={t('team.deleteConfirm', { name: member.displayName })}
            onPress={() => onConfirm(escrito)}
            disabled={!coincide || vista.data === undefined}
            loading={busy}
            testID="employee-delete-confirm"
          />
          <SecondaryButton
            label={t('common.cancel')}
            onPress={onClose}
            testID="employee-delete-cancel"
          />
        </Stack>
      }
    >
      <AppText variant="body">{t('team.deleteBody')}</AppText>

      <AsyncSection
        isPending={vista.isPending}
        error={vista.error}
        onRetry={() => void vista.refetch()}
      >
        {vista.data === undefined ? null : (
          <Stack gap={spacing.xs} testID="employee-delete-counts">
            <AppText variant="bodyStrong">{t('team.deleteWillRemove')}</AppText>
            <KeyValueRow
              label={t('team.deleteSessions')}
              value={String(vista.data.recuento.jornadas)}
            />
            <KeyValueRow
              label={t('team.deleteEvents')}
              value={String(vista.data.recuento.fichajes)}
            />
            <KeyValueRow
              label={t('team.deleteShifts')}
              value={String(vista.data.recuento.turnos)}
            />
            <KeyValueRow
              label={t('team.deleteRestDays')}
              value={String(vista.data.recuento.descansosLibres)}
            />
            <KeyValueRow
              label={t('team.deleteRequests')}
              value={String(vista.data.recuento.solicitudes)}
            />
          </Stack>
        )}
      </AsyncSection>

      <FormField
        label={t('team.deleteTypeName', { name: member.full_name })}
        value={escrito}
        onChangeText={setEscrito}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder={member.full_name}
        testID="employee-delete-name"
      />

      {error === null || error === undefined ? null : (
        <InlineNotice
          tone="late"
          icon="alert-circle"
          title={t('team.deleteFailed')}
          body={t('team.deleteFailedBody')}
        />
      )}
    </AdminSheet>
  );
}
