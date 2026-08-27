import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKioskDevices, useNotificationPreferences, useSettingsMutations } from './hooks';
import {
  notificationKeys,
  type KioskDevice,
  type NotificationKey,
  type NotificationPreferences,
  type OrganizationPatch,
} from './api';
import { FormField } from '@app/(auth)/sign-in';
import { AsyncSection } from '@/components/schedule/data-states';
import {
  AdminSheet,
  FormCard,
  InlineNotice,
  KeyValueRow,
  SegmentedControl,
  SelectField,
  ToggleField,
} from '@/components/schedule/fields';
import { ConfirmSheet } from '@/components/attendance/kiosk-sheets';
import { PushPermissionCard } from '@/features/notifications/push-permission-card';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import {
  DEFAULT_LOCATION_SETTINGS,
  useManagerScope,
  type LocationSettings,
  type ManagerLocation,
  type ManagerOrganization,
} from '@/hooks/use-manager-scope';
import { LanguageSwitch } from '@/components/ui/language-switch';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { spacing } from '@/theme/tokens';
import { formatClockTime } from '@/utils/time';

/**
 * Configuración (§11.6): organización, ubicación, relojes y notificaciones.
 *
 * Solo propietario y administrador pueden escribir organización y ubicación; el
 * botón se deshabilita y se explica por qué, pero la barrera real es RLS (§7).
 */

const CODE_VALID_MINUTES = 30;

export function SettingsPanel() {
  const { t } = useTranslation();
  const scope = useManagerScope();

  return (
    <Stack gap={spacing.lg}>
      <AppText variant="section" accessibilityRole="header">
        {t('settings.title')}
      </AppText>

      <AsyncSection
        isPending={scope.isLoading}
        error={scope.error}
        isEmpty={scope.organization === null}
        emptyTitle={t('settings.noOrganization')}
        emptyBody={t('settings.noOrganizationHint')}
        onRetry={scope.refetch}
      >
        {scope.organization !== null ? (
          <Stack gap={spacing.lg}>
            <AppLanguageCard />
            <OrganizationCard
              key={scope.organization.id}
              organization={scope.organization}
              canEdit={scope.isAdmin}
            />
            {scope.location !== null ? (
              <LocationCard
                key={scope.location.id}
                location={scope.location}
                canEdit={scope.isAdmin}
              />
            ) : null}
            <KiosksCard />
            <NotificationsCard key={`notifications-${scope.organization.id}`} />
          </Stack>
        ) : null}
      </AsyncSection>
    </Stack>
  );
}

/** Idioma de esta app en este dispositivo: cambia al instante, sin reiniciar (§18). */
function AppLanguageCard() {
  const { t } = useTranslation();

  return (
    <FormCard title={t('common.language')} description={t('settings.appLanguageHint')}>
      {/*
        El MISMO control que el kiosco y el acceso, en su variante de nombre completo.
        Tres pantallas con tres selectores distintos era pedir que se comportaran
        distinto: aqui es un componente y el estado sale del mismo store.
      */}
      <LanguageSwitch size="full" testID="app-language" />
    </FormCard>
  );
}

function OrganizationCard({
  organization,
  canEdit,
}: {
  organization: ManagerOrganization;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const mutations = useSettingsMutations(organization.id);

  const [name, setName] = useState(organization.name);
  const [timezone, setTimezone] = useState(organization.default_timezone);
  const [locale, setLocale] = useState(organization.default_locale);
  const [weekStartsOn, setWeekStartsOn] = useState(String(organization.week_starts_on));
  const [saved, setSaved] = useState(false);

  const dayOptions = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    value: String(day),
    label: t(`settings.weekDay${day}`),
  }));

  const patch: OrganizationPatch = {
    name: name.trim(),
    default_locale: locale,
    default_timezone: timezone.trim(),
    week_starts_on: Number(weekStartsOn),
  };

  const nameValid = patch.name.length > 1;

  return (
    <FormCard title={t('settings.organization')}>
      <FormField
        label={t('settings.orgName')}
        value={name}
        onChangeText={setName}
        error={nameValid ? undefined : t('settings.orgNameRequired')}
        testID="org-name"
      />

      <SegmentedControl
        label={t('settings.defaultLocale')}
        value={locale}
        options={SUPPORTED_LANGUAGES.map((code) => ({
          value: code,
          label: code === 'es-PE' ? t('common.spanish') : t('common.english'),
        }))}
        onChange={setLocale}
        testID="org-locale"
      />

      <SelectField
        label={t('settings.weekStartsOn')}
        value={weekStartsOn}
        options={dayOptions}
        onChange={setWeekStartsOn}
        testID="org-week-start"
      />

      <FormField
        label={t('settings.timezone')}
        value={timezone}
        onChangeText={setTimezone}
        autoCapitalize="none"
        testID="org-timezone"
      />
      <AppText variant="help" tone="subtle">
        {t('settings.timezoneHint')}
      </AppText>

      {!canEdit ? (
        <InlineNotice
          tone="info"
          icon="lock-closed-outline"
          title={t('settings.onlyAdminTitle')}
          body={t('settings.onlyAdminBody')}
        />
      ) : null}

      {saved ? (
        <InlineNotice tone="working" icon="checkmark-circle" title={t('settings.saved')} />
      ) : null}
      {mutations.saveOrganization.error !== null ? (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          title={t('states.errorTitle')}
          body={t('settings.saveFailed')}
        />
      ) : null}

      <PrimaryButton
        label={t('common.save')}
        onPress={() => {
          setSaved(false);
          mutations.saveOrganization.mutate(patch, {
            onSuccess: () => {
              setSaved(true);
              scope.refetch();
            },
          });
        }}
        disabled={!canEdit || !nameValid}
        loading={mutations.saveOrganization.isPending}
        testID="org-save"
      />
    </FormCard>
  );
}

type NumericSettingKey =
  | 'photoRetentionDays'
  | 'earlyClockInMinutes'
  | 'lateGraceMinutes'
  | 'requiredBreakMinutes'
  | 'dailyOvertimeThresholdMinutes'
  | 'weeklyOvertimeThresholdMinutes'
  | 'minimumRestMinutes'
  | 'kioskSyncStaleMinutes';

const NUMERIC_SETTINGS: { key: NumericSettingKey; labelKey: string }[] = [
  { key: 'earlyClockInMinutes', labelKey: 'settings.earlyClockInMinutes' },
  { key: 'lateGraceMinutes', labelKey: 'settings.lateGraceMinutes' },
  { key: 'requiredBreakMinutes', labelKey: 'settings.requiredBreakMinutes' },
  { key: 'dailyOvertimeThresholdMinutes', labelKey: 'settings.dailyOvertimeThreshold' },
  { key: 'weeklyOvertimeThresholdMinutes', labelKey: 'settings.weeklyOvertimeThreshold' },
  { key: 'minimumRestMinutes', labelKey: 'settings.minimumRestMinutes' },
  { key: 'photoRetentionDays', labelKey: 'settings.photoRetentionDays' },
  { key: 'kioskSyncStaleMinutes', labelKey: 'settings.kioskSyncStaleMinutes' },
];

function LocationCard({ location, canEdit }: { location: ManagerLocation; canEdit: boolean }) {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const mutations = useSettingsMutations(scope.organization?.id ?? null);

  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [settings, setSettings] = useState<LocationSettings>(location.settings);
  const [numbers, setNumbers] = useState<Record<NumericSettingKey, string>>({
    photoRetentionDays: String(location.settings.photoRetentionDays),
    earlyClockInMinutes: String(location.settings.earlyClockInMinutes),
    lateGraceMinutes: String(location.settings.lateGraceMinutes),
    requiredBreakMinutes: String(location.settings.requiredBreakMinutes),
    dailyOvertimeThresholdMinutes: String(location.settings.dailyOvertimeThresholdMinutes),
    weeklyOvertimeThresholdMinutes: String(location.settings.weeklyOvertimeThresholdMinutes),
    minimumRestMinutes: String(location.settings.minimumRestMinutes),
    kioskSyncStaleMinutes: String(location.settings.kioskSyncStaleMinutes),
  });
  const [saved, setSaved] = useState(false);

  const parseNumber = (key: NumericSettingKey): number => {
    const raw = Number(numbers[key].replace(/[^0-9]/g, ''));
    return Number.isFinite(raw) ? raw : DEFAULT_LOCATION_SETTINGS[key];
  };

  const buildSettings = (): LocationSettings => ({
    ...settings,
    photoRetentionDays: parseNumber('photoRetentionDays'),
    earlyClockInMinutes: parseNumber('earlyClockInMinutes'),
    lateGraceMinutes: parseNumber('lateGraceMinutes'),
    requiredBreakMinutes: parseNumber('requiredBreakMinutes'),
    dailyOvertimeThresholdMinutes: parseNumber('dailyOvertimeThresholdMinutes'),
    weeklyOvertimeThresholdMinutes: parseNumber('weeklyOvertimeThresholdMinutes'),
    minimumRestMinutes: parseNumber('minimumRestMinutes'),
    kioskSyncStaleMinutes: parseNumber('kioskSyncStaleMinutes'),
  });

  return (
    <FormCard title={t('settings.locations')} description={location.name}>
      <FormField
        label={t('settings.locationName')}
        value={name}
        onChangeText={setName}
        testID="location-name"
      />
      <FormField
        label={t('settings.locationAddress')}
        value={address}
        onChangeText={setAddress}
        testID="location-address"
      />

      <ToggleField
        label={t('settings.kioskPhoto')}
        hint={t('settings.kioskPhotoOffByDefault')}
        value={settings.photoEnabled}
        onChange={(photoEnabled) => setSettings((current) => ({ ...current, photoEnabled }))}
        disabled={!canEdit}
        testID="location-photo"
      />

      <ToggleField
        label={t('settings.allowUnscheduledShifts')}
        hint={t('settings.allowUnscheduledHint')}
        value={settings.allowUnscheduledShifts}
        onChange={(allowUnscheduledShifts) =>
          setSettings((current) => ({ ...current, allowUnscheduledShifts }))
        }
        disabled={!canEdit}
        testID="location-unscheduled"
      />

      <SegmentedControl
        label={t('settings.timeFormat')}
        value={settings.timeFormat}
        options={[
          { value: '24h', label: t('settings.timeFormat24') },
          { value: '12h', label: t('settings.timeFormat12') },
        ]}
        onChange={(timeFormat) => setSettings((current) => ({ ...current, timeFormat }))}
        testID="location-time-format"
      />

      {NUMERIC_SETTINGS.map((setting) => (
        <FormField
          key={setting.key}
          label={t(setting.labelKey)}
          value={numbers[setting.key]}
          onChangeText={(value) => setNumbers((current) => ({ ...current, [setting.key]: value }))}
          keyboardType="number-pad"
          testID={`location-${setting.key}`}
        />
      ))}

      {!canEdit ? (
        <InlineNotice
          tone="info"
          icon="lock-closed-outline"
          title={t('settings.onlyAdminTitle')}
          body={t('settings.onlyAdminBody')}
        />
      ) : null}
      {saved ? (
        <InlineNotice tone="working" icon="checkmark-circle" title={t('settings.saved')} />
      ) : null}
      {mutations.saveLocation.error !== null ? (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          title={t('states.errorTitle')}
          body={t('settings.saveFailed')}
        />
      ) : null}

      <PrimaryButton
        label={t('common.save')}
        onPress={() => {
          setSaved(false);
          mutations.saveLocation.mutate(
            {
              locationId: location.id,
              name,
              address,
              settings: buildSettings(),
            },
            {
              onSuccess: () => {
                setSaved(true);
                scope.refetch();
              },
            },
          );
        }}
        disabled={!canEdit || name.trim().length < 2}
        loading={mutations.saveLocation.isPending}
        testID="location-save"
      />
    </FormCard>
  );
}

function KiosksCard() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const devices = useKioskDevices(scope.organization?.id ?? null);
  const mutations = useSettingsMutations(scope.organization?.id ?? null);

  const [code, setCode] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<KioskDevice | null>(null);

  return (
    <FormCard title={t('settings.kiosks')} description={t('settings.kiosksHint')}>
      <AsyncSection
        isPending={devices.isPending}
        error={devices.error}
        isEmpty={(devices.data ?? []).length === 0}
        emptyTitle={t('settings.noKiosks')}
        emptyBody={t('settings.noKiosksHint')}
        onRetry={() => void devices.refetch()}
      >
        <Stack gap={spacing.sm}>
          {(devices.data ?? []).map((device) => (
            <Stack key={device.id} gap={spacing.xs}>
              <Row justify="space-between" gap={spacing.md} align="center">
                <AppText variant="bodyStrong">{device.display_name}</AppText>
                <StatusBadge
                  label={
                    device.status === 'active' ? t('team.statusActive') : t('kiosk.revokedTitle')
                  }
                  tone={device.status === 'active' ? 'working' : 'offShift'}
                  compact
                />
              </Row>
              <KeyValueRow
                label={t('settings.kioskLastSeen')}
                value={
                  device.last_seen_at === null
                    ? t('settings.never')
                    : formatClockTime(device.last_seen_at, scope.timezone, scope.timeFormat)
                }
              />
              <KeyValueRow
                label={t('settings.kioskAppVersion')}
                value={device.app_version ?? t('settings.unknownVersion')}
              />
              {device.status === 'active' ? (
                <DangerButton
                  label={t('settings.kioskRevoke')}
                  hint={t('settings.kioskRevokeHint')}
                  onPress={() => setRevoking(device)}
                  fullWidth={false}
                  testID={`kiosk-revoke-${device.id}`}
                />
              ) : null}
            </Stack>
          ))}
        </Stack>
      </AsyncSection>

      <SecondaryButton
        label={t('settings.kioskGenerateCode')}
        onPress={() => {
          const locationId = scope.locationId;
          if (locationId === null) return;
          mutations.generateCode.mutate(
            { locationId, validMinutes: CODE_VALID_MINUTES },
            { onSuccess: setCode },
          );
        }}
        loading={mutations.generateCode.isPending}
        disabled={!scope.isAdmin || scope.locationId === null}
        testID="kiosk-generate-code"
      />
      {mutations.generateCode.error !== null ? (
        <InlineNotice
          tone="late"
          icon="warning-outline"
          title={t('states.errorTitle')}
          body={t('settings.codeFailed')}
        />
      ) : null}

      {code !== null ? (
        <AdminSheet
          visible
          title={t('settings.kioskGenerateCode')}
          onClose={() => setCode(null)}
          testID="activation-code-sheet"
          footer={
            <PrimaryButton
              label={t('team.pinNoted')}
              onPress={() => setCode(null)}
              testID="activation-code-close"
            />
          }
        >
          <AppText variant="title" tabular>
            {code}
          </AppText>
          <AppText variant="help" tone="danger">
            {t('settings.codeShownOnce', { minutes: CODE_VALID_MINUTES })}
          </AppText>
        </AdminSheet>
      ) : null}

      <ConfirmSheet
        visible={revoking !== null}
        title={t('settings.kioskRevoke')}
        body={t('settings.kioskRevokeConfirm')}
        confirmLabel={t('settings.kioskRevoke')}
        destructive
        onConfirm={() => {
          const device = revoking;
          if (device === null) return;
          mutations.revokeKiosk.mutate(
            { deviceId: device.id },
            { onSuccess: () => setRevoking(null) },
          );
        }}
        onCancel={() => setRevoking(null)}
      />
    </FormCard>
  );
}

const NOTIFICATION_LABEL_KEYS: Record<NotificationKey, string> = {
  late: 'settings.notifyLate',
  noShow: 'settings.notifyNoShow',
  earlyClockIn: 'settings.notifyEarlyClockIn',
  nearOvertime: 'settings.notifyNearOvertime',
  incompleteEntry: 'settings.notifyIncompleteEntry',
  newRequest: 'settings.notifyNewRequest',
  scheduleChange: 'settings.notifyScheduleChange',
  kioskNotSyncing: 'settings.notifyKioskNotSyncing',
};

function NotificationsCard() {
  const { t } = useTranslation();
  const scope = useManagerScope();
  const organizationId = scope.organization?.id ?? null;
  const stored = useNotificationPreferences(organizationId);
  const mutations = useSettingsMutations(organizationId);

  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  const values = draft ?? stored.data ?? null;

  return (
    <FormCard title={t('settings.notifications')} description={t('settings.notificationsHint')}>
      {/*
        El estado del dispositivo va antes de los interruptores: si el permiso del
        sistema esta denegado, elegir que avisos quieres recibir no sirve de nada y
        hay que decirlo antes de que la persona los configure (§20).
      */}
      <PushPermissionCard />

      <AsyncSection
        isPending={stored.isPending}
        error={stored.error}
        onRetry={() => void stored.refetch()}
      >
        {values !== null ? (
          <Stack gap={spacing.sm}>
            {notificationKeys.map((key) => (
              <ToggleField
                key={key}
                label={t(NOTIFICATION_LABEL_KEYS[key])}
                value={values[key]}
                onChange={(next) => {
                  setSaved(false);
                  setDraft({ ...values, [key]: next });
                }}
                testID={`notify-${key}`}
              />
            ))}
            {saved ? (
              <InlineNotice tone="working" icon="checkmark-circle" title={t('settings.saved')} />
            ) : null}
            <PrimaryButton
              label={t('common.save')}
              onPress={() =>
                mutations.saveNotifications.mutate(values, {
                  onSuccess: () => setSaved(true),
                })
              }
              loading={mutations.saveNotifications.isPending}
              testID="notifications-save"
            />
          </Stack>
        ) : null}
      </AsyncSection>
    </FormCard>
  );
}
