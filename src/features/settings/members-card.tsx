import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemberMutations, useMembers } from './hooks';
import { appRoles, type AppRoleName, type Member } from './members';
import { AsyncSection } from '@/components/schedule/data-states';
import { FormCard, InlineNotice, SelectField } from '@/components/schedule/fields';
import { ConfirmSheet } from '@/components/attendance/kiosk-sheets';
import { FormField } from '@/components/ui/form-field';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { spacing } from '@/theme/tokens';

/**
 * Quién tiene acceso al panel, y con qué rol (§7, §11.6).
 *
 * ESTO SOLO EXISTÍA COMO SCRIPT DE TERMINAL. Dar acceso a un encargado nuevo pedía
 * una máquina con credenciales de administrador del proyecto de Google; para un
 * negocio eso no es una herramienta, es una llamada a quien programó la app.
 *
 * INVITAR NO CREA CUENTAS, y por eso la pantalla habla de invitaciones y no de
 * «agregar usuario». La membresía se identifica por el `uid` que Firebase asigna al
 * entrar con Google, y ese `uid` no existe antes de que la persona entre. Fabricarle
 * la cuenta desde el servidor sería crear la identidad de alguien en un sistema donde
 * esa identidad firma horas que se pagan. La invitación espera a que la reclame quien
 * demuestre ser ese correo.
 *
 * Los botones que no se pueden pulsar no se esconden: se desactivan y se dice por
 * qué. Un control que desaparece deja a quien lo buscaba pensando que se rompió algo.
 */

const ROLES_INVITABLES: AppRoleName[] = ['admin', 'manager', 'employee'];

export function MembersCard() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const organizationId = scope.organization?.id ?? null;

  const members = useMembers(organizationId);
  const { invite, changeRole, revoke, cancelInvite } = useMemberMutations(organizationId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRoleName>('manager');
  const [aRetirar, setARetirar] = useState<Member | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ocupado = invite.isPending || changeRole.isPending || revoke.isPending;

  /** El último error de cualquiera de las cuatro, para no repetir el bloque cuatro veces. */
  const error = invite.error ?? changeRole.error ?? revoke.error ?? cancelInvite.error;

  if (!scope.isAdmin) {
    return (
      <FormCard title={t('settings.members')} description={t('settings.membersHint')}>
        <InlineNotice
          tone="info"
          icon="lock-closed-outline"
          title={t('settings.onlyAdminTitle')}
          body={t('settings.membersOnlyAdmin')}
        />
      </FormCard>
    );
  }

  return (
    <FormCard title={t('settings.members')} description={t('settings.membersHint')}>
      <AsyncSection
        isPending={members.isPending}
        error={members.error}
        isEmpty={false}
        onRetry={() => void members.refetch()}
      >
        <Stack gap={spacing.lg}>
          <Stack gap={spacing.sm}>
            {(members.data?.members ?? []).map((member) => (
              <Card key={member.userId} testID={`member-${member.userId}`}>
                <Row justify="space-between" gap={spacing.md} align="center" wrap>
                  <Stack gap={2}>
                    <AppText variant="bodyStrong">
                      {member.email ?? member.displayName ?? t('settings.memberUnknown')}
                    </AppText>
                    {member.isSelf ? (
                      <AppText variant="help" tone="subtle">
                        {t('settings.memberYou')}
                      </AppText>
                    ) : null}
                  </Stack>
                  <StatusBadge
                    compact
                    label={t(`roles.${member.role}`)}
                    tone={member.status === 'active' ? 'info' : 'warning'}
                    icon={member.status === 'active' ? 'person-outline' : 'person-remove-outline'}
                  />
                </Row>

                {/*
                  A UNO MISMO NO SE LE OFRECE NI CAMBIAR EL ROL NI QUITARSE EL ACCESO.
                  El servidor lo rechaza igual —es donde tiene que estar la barrera—
                  pero ofrecer un botón que siempre falla es una trampa: quien lo pulsa
                  cree que la app está rota, no que la acción no tiene sentido.
                */}
                {member.isSelf || member.status !== 'active' ? null : (
                  <Row gap={spacing.sm} wrap align="center">
                    <SelectField
                      label={t('settings.memberRole')}
                      value={member.role}
                      options={appRoles.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
                      onChange={(nuevo) => {
                        setAviso(null);
                        changeRole.mutate({ userId: member.userId, role: nuevo });
                      }}
                      testID={`member-role-${member.userId}`}
                    />
                    {/*
                      FANTASMA Y NO ROJO RELLENO, y el cambio importa. Un botón de
                      peligro a pantalla completa junto a cada persona convierte la
                      lista en un campo de minas: lo primero que se ve de cada fila es
                      la forma de romperla, no quién es. El rojo se gana al pulsarlo
                      —la confirmación SÍ es roja y destructiva—, que es donde de
                      verdad hace falta la advertencia.
                    */}
                    <GhostButton
                      label={t('settings.memberRevoke')}
                      onPress={() => setARetirar(member)}
                      disabled={ocupado}
                      fullWidth={false}
                      testID={`member-revoke-${member.userId}`}
                    />
                  </Row>
                )}
              </Card>
            ))}
          </Stack>

          {(members.data?.invitations ?? []).length > 0 ? (
            <Stack gap={spacing.sm}>
              <AppText variant="label" tone="subtle">
                {t('settings.pendingInvitations')}
              </AppText>
              {(members.data?.invitations ?? []).map((invitacion) => (
                <Row
                  key={invitacion.email}
                  justify="space-between"
                  gap={spacing.md}
                  align="center"
                  wrap
                >
                  <Stack gap={2}>
                    <AppText variant="bodyStrong">{invitacion.email}</AppText>
                    <AppText variant="help" tone="subtle">
                      {t('settings.invitationWaiting', { role: t(`roles.${invitacion.role}`) })}
                    </AppText>
                  </Stack>
                  <GhostButton
                    label={t('settings.invitationCancel')}
                    onPress={() => cancelInvite.mutate({ email: invitacion.email })}
                    disabled={ocupado}
                    fullWidth={false}
                    testID={`invitation-cancel-${invitacion.email}`}
                  />
                </Row>
              ))}
            </Stack>
          ) : null}

          <Stack gap={spacing.sm}>
            <FormField
              label={t('settings.inviteEmail')}
              placeholder={t('settings.inviteEmailPlaceholder')}
              value={email}
              onChangeText={(valor) => {
                setEmail(valor);
                setAviso(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              error={
                email.trim() !== '' && !correoValido ? t('settings.inviteEmailInvalid') : undefined
              }
              testID="invite-email"
            />
            <SelectField
              label={t('settings.inviteRole')}
              value={role}
              options={ROLES_INVITABLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
              onChange={setRole}
              testID="invite-role"
            />
            <PrimaryButton
              label={t('settings.inviteSend')}
              loading={invite.isPending}
              disabled={!correoValido || ocupado}
              onPress={() => {
                invite.mutate(
                  { email: email.trim().toLowerCase(), role },
                  {
                    onSuccess: () => {
                      setAviso(t('settings.inviteSent', { email: email.trim().toLowerCase() }));
                      setEmail('');
                    },
                  },
                );
              }}
              testID="invite-send"
            />
            <AppText variant="help" tone="subtle">
              {t('settings.inviteExplainer')}
            </AppText>
          </Stack>

          {aviso !== null ? (
            <InlineNotice tone="working" icon="checkmark-circle" title={aviso} />
          ) : null}

          {/*
            El mensaje del servidor se muestra TAL CUAL, y es lo correcto aquí. Estos
            errores no son técnicos: «Es la única persona que administra esta
            organización» o «No puedes dar un rol superior al tuyo» explican una regla
            del negocio mejor de lo que puede hacerlo un texto genérico de la pantalla.
          */}
          {error !== null && error !== undefined ? (
            <InlineNotice
              tone="late"
              icon="alert-circle"
              title={t('settings.memberActionFailed')}
              body={error instanceof Error ? error.message : undefined}
            />
          ) : null}
        </Stack>
      </AsyncSection>

      <ConfirmSheet
        visible={aRetirar !== null}
        title={t('settings.memberRevokeTitle')}
        body={t('settings.memberRevokeBody', {
          email: aRetirar?.email ?? aRetirar?.displayName ?? '',
        })}
        confirmLabel={t('settings.memberRevoke')}
        destructive
        onConfirm={() => {
          if (aRetirar !== null) revoke.mutate({ userId: aRetirar.userId });
          setARetirar(null);
        }}
        onCancel={() => setARetirar(null)}
      />
    </FormCard>
  );
}
