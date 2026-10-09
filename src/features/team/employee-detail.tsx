import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { HorasDeLaPersona } from './horas-de-la-persona';
import { HorasQueDebe } from './horas-que-debe';
import { useUpcomingShifts, type TeamMember } from './hooks';
import { AsyncSection } from '@/components/schedule/data-states';
import { AdminSheet, InlineNotice, KeyValueRow } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import type { TimeEditRequest } from '@/features/requests/api';
import type { DentroDeLaPersona } from '@/features/timesheets/en-curso';
import type { SupportedLanguage } from '@/i18n';
import { formatDateKeyShort } from '@/features/schedules/week';
import { spacing } from '@/theme/tokens';
import { formatShiftRange, type TimeFormatPreference } from '@/utils/time';

/**
 * Ficha del empleado (§11.2): datos básicos, ubicaciones, puestos, estado,
 * próximos turnos y horas recientes.
 *
 * El PIN existente NO aparece aquí y no hay forma de consultarlo: solo se puede
 * generar uno nuevo, que se muestra una única vez.
 */
export function EmployeeDetailSheet({
  organizationId,
  member,
  locationNames,
  jobRoleNames,
  locationId,
  nowISO,
  weekStartsOn,
  enCurso,
  requests,
  timezone,
  timeFormat,
  language,
  busy,
  activando = false,
  errorDeAccion = null,
  onEdit,
  onToggleStatus,
  onDischarge,
  accesoAlCelular = null,
  onResetPin,
  onDelete,
  onClose,
}: {
  /**
   * Va como prop y no sale de `member` porque `TeamMember` no trae la organización:
   * la lista de equipo ya viene acotada a una, así que la fila no repite el dato. Lo
   * necesita `useUpcomingShifts` para poder acotar su consulta —una consulta que no
   * acota por organización la deniegan las reglas entera—.
   */
  organizationId: string | null;
  member: TeamMember;
  locationNames: Map<string, string>;
  jobRoleNames: Map<string, string>;
  /** La sede que se mira: las horas son las de esta sede, como en Horas y Reportes. */
  locationId: string | null;
  nowISO: string;
  weekStartsOn: number;
  /** Su jornada abierta, si está dentro ahora: se suma al día en que entró. */
  enCurso?: DentroDeLaPersona;
  /** Solicitudes de esta persona, para no tener que buscarlas en otra pestaña. */
  requests: TimeEditRequest[];
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  busy: boolean;
  /** «Activar» en curso (8-oct): antes no tenía carga y se podía pulsar varias veces. */
  activando?: boolean;
  /** Por qué falló «Reiniciar PIN» o «Activar» (8-oct): antes no se decía nada. */
  errorDeAccion?: unknown;
  onEdit: () => void;
  onToggleStatus: () => void;
  /** «Dejó de trabajar»: abre la hoja que pide su último día. Ver `dar-de-baja-sheet.tsx`. */
  onDischarge: () => void;
  /**
   * Si ya entró al celular con su correo (4-oct): sin entrar no ve su horario ni puede poner
   * su disponibilidad. `null` si no se sabe —quien gestiona sin ser administrador—.
   */
  accesoAlCelular?: 'entro' | 'noEntro' | 'sinCorreo' | null;
  onResetPin: () => void;
  /**
   * Eliminar definitivamente. Solo llega para dueño o administrador, y solo se ofrece con
   * la persona ya inactiva: primero se desactiva, luego se elimina.
   */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upcoming = useUpcomingShifts(organizationId, member.id);

  const statusLabel =
    member.status === 'active'
      ? t('team.statusActive')
      : member.status === 'inactive'
        ? member.end_date === null
          ? t('team.statusInactive')
          : t('team.statusLeft', { day: formatDateKeyShort(member.end_date, language) })
        : t('team.statusInvited');

  return (
    <AdminSheet
      visible
      title={member.displayName}
      onClose={onClose}
      testID="employee-detail-sheet"
      footer={
        <Stack gap={spacing.sm}>
          {errorDeAccion === null || errorDeAccion === undefined ? null : (
            <InlineNotice
              tone="late"
              icon="warning-outline"
              title={t('team.saveFailed')}
              body={errorDeAccion instanceof Error ? errorDeAccion.message : undefined}
              testID="employee-detail-error"
            />
          )}
          <PrimaryButton
            label={t('team.resetPin')}
            hint={t('team.resetPinHint')}
            onPress={onResetPin}
            loading={busy}
            testID="employee-reset-pin"
          />
          {/*
            A MEDIAS IGUALES, y antes cada uno medía lo que medía su palabra: «Editar»
            salía a 87 px y «Desactivar» a 139, debajo de un «Reiniciar PIN» de 512.
            Tres botones de tres anchos distintos en un pie de nueve centímetros no se
            leen como tres opciones de la misma decisión, se leen como tres controles
            que acabaron ahí por casualidad. El primario sigue midiendo el doble que
            cada uno de estos dos, que es la jerarquía que sí hay que ver.
          */}
          <Row gap={spacing.sm} align="flex-start">
            <View style={estilos.mitad}>
              <SecondaryButton label={t('common.edit')} onPress={onEdit} testID="employee-edit" />
            </View>
            <View style={estilos.mitad}>
              {member.status === 'active' ? (
                <DangerButton
                  label={t('team.discharge')}
                  hint={t('team.deactivateHint')}
                  onPress={onDischarge}
                  testID="employee-deactivate"
                />
              ) : (
                <SecondaryButton
                  label={t('team.activate')}
                  onPress={onToggleStatus}
                  loading={activando}
                  testID="employee-activate"
                />
              )}
            </View>
          </Row>
          {member.status === 'inactive' && onDelete !== undefined ? (
            <GhostButton
              label={t('team.deleteAction')}
              hint={t('team.deleteActionHint')}
              onPress={onDelete}
              testID="employee-delete"
            />
          ) : null}
        </Stack>
      }
    >
      <StatusBadge
        label={statusLabel}
        // `info` y no `working`: el verde es «Trabajando ahora», no «sigue en la empresa».
        tone={member.status === 'active' ? 'info' : 'offShift'}
        icon={member.status === 'active' ? 'checkmark-circle' : 'pause-circle-outline'}
      />

      <Stack gap={spacing.xs}>
        <KeyValueRow label={t('team.fullName')} value={member.full_name} />
        {member.employee_number !== null ? (
          <KeyValueRow label={t('team.employeeNumber')} value={member.employee_number} />
        ) : null}
        <KeyValueRow label={t('team.emailOptional')} value={member.email ?? t('team.noEmail')} />
        {accesoAlCelular === null ? null : (
          <KeyValueRow
            label={t('team.phoneAccess')}
            value={
              accesoAlCelular === 'entro'
                ? t('team.phoneAccessYes')
                : accesoAlCelular === 'noEntro'
                  ? t('team.phoneAccessNotYet')
                  : t('team.phoneAccessNoEmail')
            }
            testID="employee-phone-access"
          />
        )}
        <KeyValueRow
          label={t('team.locations')}
          value={
            member.locationIds.length === 0
              ? t('team.noLocations')
              : member.locationIds
                  .map((id) => locationNames.get(id) ?? '')
                  .filter((name) => name !== '')
                  .join(', ')
          }
        />
        <KeyValueRow
          label={t('team.jobRoles')}
          value={
            member.jobRoleIds.length === 0
              ? t('team.noJobRolesAssigned')
              : member.jobRoleIds
                  .map((id) => jobRoleNames.get(id) ?? '')
                  .filter((name) => name !== '')
                  .join(', ')
          }
        />
      </Stack>

      <AppText variant="bodyStrong">{t('team.upcomingShifts')}</AppText>
      <AsyncSection
        isPending={upcoming.isPending}
        error={upcoming.error}
        isEmpty={(upcoming.data ?? []).length === 0}
        emptyTitle={t('team.noUpcomingShifts')}
        onRetry={() => void upcoming.refetch()}
      >
        <Stack gap={spacing.xs}>
          {(upcoming.data ?? []).map((shift) => (
            <KeyValueRow
              key={shift.id}
              label={
                shift.status === 'draft'
                  ? `${t('schedule.statusDraft')} · ${locationNames.get(shift.location_id) ?? ''}`
                  : (locationNames.get(shift.location_id) ?? '')
              }
              value={formatShiftRange(
                shift.starts_at,
                shift.ends_at,
                timezone,
                timeFormat,
                language,
              )}
            />
          ))}
        </Stack>
      </AsyncSection>

      {/*
        LAS HORAS, DÍA POR DÍA Y SEMANA POR SEMANA (30-sep). Antes era una lista de siete
        fechas con un número; ahora es su tarjeta de la semana, con entrada y salida, y
        las semanas del mes con su promedio. Ver `HorasDeLaPersona`.
      */}
      <HorasDeLaPersona
        employeeId={member.id}
        organizationId={organizationId}
        locationId={locationId}
        enCurso={enCurso}
        nowISO={nowISO}
        timezone={timezone}
        timeFormat={timeFormat}
        weekStartsOn={weekStartsOn}
        language={language}
      />

      {/* Lo que debe a la tienda, registrado desde «Por resolver» en Horas (1-oct). */}
      <HorasQueDebe
        organizationId={organizationId}
        locationId={locationId}
        employeeId={member.id}
        language={language}
      />

      <AppText variant="bodyStrong">{t('requests.title')}</AppText>
      {requests.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('requests.noRequests')}
        </AppText>
      ) : (
        <Stack gap={spacing.xs}>
          {requests.map((request) => (
            <KeyValueRow
              key={request.id}
              label={
                request.target_date ?? formatDateKeyShort(request.created_at.slice(0, 10), language)
              }
              value={
                request.status === 'pending'
                  ? t('requests.statusPending')
                  : request.status === 'approved'
                    ? t('requests.statusApproved')
                    : t('requests.statusRejected')
              }
              tone={request.status === 'pending' ? 'danger' : 'default'}
            />
          ))}
        </Stack>
      )}
    </AdminSheet>
  );
}

/** El PIN temporal se muestra una sola vez y no se guarda en ningún sitio (§11.2). */
export function TemporaryPinSheet({
  pin,
  employeeName,
  onClose,
}: {
  pin: string;
  employeeName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AdminSheet
      visible
      title={t('team.resetPin')}
      onClose={onClose}
      testID="temporary-pin-sheet"
      footer={
        <PrimaryButton label={t('team.pinNoted')} onPress={onClose} testID="temporary-pin-close" />
      }
    >
      <AppText variant="bodyStrong">{employeeName}</AppText>
      <AppText variant="title" tabular accessibilityLabel={t('team.temporaryPin', { pin })}>
        {pin}
      </AppText>
      <AppText variant="help" tone="danger">
        {t('team.pinShownOnce')}
      </AppText>
    </AdminSheet>
  );
}

const estilos = StyleSheet.create({
  mitad: { flex: 1 },
});
