import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AsyncSection } from '@/components/schedule/data-states';
import { FormCard, InlineNotice } from '@/components/schedule/fields';
import { FormField } from '@/components/ui/form-field';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { useJobRoles, useTeamMutations } from '@/features/team/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { spacing } from '@/theme/tokens';

/**
 * Los puestos: Cajero, Barista, Almacén.
 *
 * ASIGNARLOS YA SE PODÍA, CREARLOS NO. El formulario del empleado tiene su selector
 * múltiple desde siempre, pero los puestos tenían que existir antes y solo los plantaba
 * `configurar-empresa.mjs` desde una terminal con credenciales del proyecto de Google.
 * En una empresa recién abierta ese selector salía vacío y no había forma de añadir el
 * primero: la regla de Firestore sí lo permitía, lo que faltaba era la pantalla.
 *
 * LOS NOMBRES SE EDITAN EN SITIO Y SE GUARDAN DE UNA VEZ, en vez de un editor por fila.
 * Un puesto es una palabra, y una tienda tiene cinco o seis: montar un modo edición por
 * cada uno para corregir una errata en «Cajero» es más ceremonia que el cambio. Con un
 * solo borrador y un solo botón, escribir y guardar es lo mismo que en la tarjeta de la
 * sede, que está dos secciones más arriba.
 */
export function JobRolesCard() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const organizationId = scope.organization?.id ?? null;

  const jobRoles = useJobRoles(organizationId);
  const { addJobRole, renameRole, toggleJobRole } = useTeamMutations(organizationId);

  const [nuevo, setNuevo] = useState('');
  /** Solo lo que se ha tocado: lo que no está aquí no se envía al guardar. */
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  const puestos = jobRoles.data ?? [];
  const ocupado = addJobRole.isPending || renameRole.isPending || toggleJobRole.isPending;
  const error = addJobRole.error ?? renameRole.error ?? toggleJobRole.error;

  /** Un nombre repetido no lo impide la base: se avisa aquí, que es donde se escribe. */
  const repetido = puestos.some(
    (puesto) => puesto.name.trim().toLowerCase() === nuevo.trim().toLowerCase(),
  );

  const cambiados = Object.entries(borradores).filter(([id, nombre]) => {
    const original = puestos.find((puesto) => puesto.id === id);
    return original !== undefined && nombre.trim() !== '' && nombre.trim() !== original.name;
  });

  if (!scope.isAdmin) {
    return (
      <FormCard collapsible title={t('settings.jobRoles')} description={t('settings.jobRolesHint')}>
        <InlineNotice
          tone="info"
          icon="lock-closed-outline"
          title={t('settings.onlyAdminTitle')}
          body={t('settings.jobRolesOnlyAdmin')}
        />
      </FormCard>
    );
  }

  return (
    <FormCard
      collapsible
      title={t('settings.jobRoles')}
      description={t('settings.jobRolesHint')}
      testID="job-roles-card"
    >
      <AsyncSection
        isPending={jobRoles.isPending}
        error={jobRoles.error}
        isEmpty={false}
        onRetry={() => void jobRoles.refetch()}
      >
        <Stack gap={spacing.lg}>
          {puestos.length === 0 ? (
            <AppText variant="help" tone="subtle">
              {t('settings.jobRolesEmpty')}
            </AppText>
          ) : (
            <Stack gap={spacing.sm}>
              {puestos.map((puesto) => (
                <Card key={puesto.id} testID={`job-role-${puesto.id}`}>
                  <Row justify="space-between" align="center" gap={spacing.md} wrap>
                    <StatusBadge
                      compact
                      label={
                        puesto.is_active
                          ? t('settings.jobRoleActive')
                          : t('settings.jobRoleInactive')
                      }
                      tone={puesto.is_active ? 'working' : 'offShift'}
                      icon={puesto.is_active ? 'briefcase-outline' : 'lock-closed-outline'}
                    />
                    <GhostButton
                      label={
                        puesto.is_active ? t('settings.jobRoleClose') : t('settings.jobRoleReopen')
                      }
                      onPress={() =>
                        toggleJobRole.mutate({
                          jobRoleId: puesto.id,
                          isActive: !puesto.is_active,
                        })
                      }
                      disabled={ocupado}
                      fullWidth={false}
                      testID={`job-role-toggle-${puesto.id}`}
                    />
                  </Row>
                  <FormField
                    label={t('settings.jobRoleName')}
                    value={borradores[puesto.id] ?? puesto.name}
                    onChangeText={(valor) => {
                      setAviso(null);
                      setBorradores((actual) => ({ ...actual, [puesto.id]: valor }));
                    }}
                    testID={`job-role-name-${puesto.id}`}
                  />
                </Card>
              ))}

              {cambiados.length > 0 ? (
                <SecondaryButton
                  label={t('settings.jobRolesSave', { count: cambiados.length })}
                  loading={renameRole.isPending}
                  onPress={() => {
                    for (const [jobRoleId, nombre] of cambiados) {
                      renameRole.mutate({ jobRoleId, name: nombre.trim() });
                    }
                    setBorradores({});
                    setAviso(t('settings.jobRolesSaved'));
                  }}
                  testID="job-roles-save"
                />
              ) : null}
            </Stack>
          )}

          <Stack gap={spacing.sm}>
            <AppText variant="bodyStrong">{t('settings.addJobRole')}</AppText>
            <FormField
              label={t('settings.addJobRoleName')}
              placeholder={t('settings.addJobRolePlaceholder')}
              value={nuevo}
              onChangeText={(valor) => {
                setNuevo(valor);
                setAviso(null);
              }}
              error={repetido ? t('settings.jobRoleDuplicate') : undefined}
              testID="job-role-new"
            />
            <PrimaryButton
              label={t('settings.addJobRoleSubmit')}
              disabled={nuevo.trim() === '' || repetido || ocupado}
              loading={addJobRole.isPending}
              onPress={() => {
                const nombre = nuevo.trim();
                addJobRole.mutate(
                  { name: nombre, existentes: puestos.length },
                  {
                    onSuccess: () => {
                      setAviso(t('settings.addJobRoleDone', { name: nombre }));
                      setNuevo('');
                    },
                  },
                );
              }}
              testID="job-role-create"
            />
            {/*
              Se dice aquí que no se borran, por lo mismo que en la tarjeta de sedes: es
              la pregunta que se hace todo el mundo al ver solo «cerrar».
            */}
            <AppText variant="help" tone="subtle">
              {t('settings.jobRoleNoDelete')}
            </AppText>
          </Stack>

          {aviso === null ? null : (
            <InlineNotice tone="working" icon="checkmark-circle" title={aviso} />
          )}
          {error === null || error === undefined ? null : (
            <InlineNotice
              tone="late"
              icon="warning-outline"
              title={t('settings.jobRoleFailed')}
              body={error instanceof Error ? error.message : undefined}
            />
          )}
        </Stack>
      </AsyncSection>
    </FormCard>
  );
}
