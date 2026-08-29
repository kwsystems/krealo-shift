import { useState } from 'react';
import { Linking } from 'react-native';
import Constants from 'expo-constants';
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
import { OrganizationLogoField } from './logo-field';
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
import { env } from '@/lib/env';
import { useSessionStore } from '@/stores/session-store';
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
            <SessionCard canSignOutEverywhere={scope.isAdmin} />
            <AboutCard />
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

      {/*
        El logotipo va justo después del nombre, que es cómo se lee la identidad de
        la organización: cómo se llama y cómo se ve. Los ajustes de idioma, semana y
        zona horaria son otra cosa, y meterlo entre ellos lo escondería.

        No lo cubre el botón Guardar de esta tarjeta: la subida es inmediata, porque
        una imagen ya subida a Storage no puede quedar "pendiente de guardar" sin que
        el archivo y la columna se separen.
      */}
      <OrganizationLogoField
        organizationId={organization.id}
        logoPath={organization.logo_path}
        canEdit={canEdit}
        onChanged={() => scope.refetch()}
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

/**
 * Las claves NUMÉRICAS de `LocationSettings`, DERIVADAS del tipo y no escritas a mano.
 *
 * Antes era una unión copiada a mano de las mismas ocho claves. Una segunda copia de una
 * lista se separa de la primera en cuanto alguien añade un ajuste: el tipo lo aceptaría,
 * el panel no lo mostraría, y el ajuste nuevo quedaría en la base sin forma de cambiarlo.
 * Derivándola, añadir un número a `LocationSettings` obliga a decidir aquí qué etiqueta
 * lleva, porque `NUMERIC_SETTINGS` deja de compilar hasta que se añade.
 */
type ClaveNumerica = {
  [K in keyof LocationSettings]: LocationSettings[K] extends number ? K : never;
}[keyof LocationSettings];

/**
 * `pinLength` es numérico y NO se edita aquí, a propósito.
 *
 * Bajarlo de 6 a 4 deja fuera a TODA la tienda de golpe: los PIN guardados son hashes de
 * seis dígitos y el teclado validaría al cuarto, así que nadie podría volver a fichar
 * hasta que un administrador le pusiera un PIN nuevo a cada persona. Eso no es un campo
 * que se cambia de paso mirando ajustes; necesita un flujo propio que reasigne los PIN, y
 * §11.6 no lo pide entre los ajustes de ubicación.
 *
 * La exclusión es explícita y no un olvido: la lista de abajo es un `Record` exhaustivo,
 * así que sin esta línea el panel no compilaría.
 */
type ClaveNumericaNoEditable = 'pinLength';

type NumericSettingKey = Exclude<ClaveNumerica, ClaveNumericaNoEditable>;

/**
 * Etiqueta de cada ajuste numérico. Es un `Record` y no una lista suelta a propósito: un
 * `Record<NumericSettingKey, string>` no compila si falta una clave, así que un ajuste
 * numérico nuevo NO puede quedarse sin campo en el panel por descuido.
 */
const ETIQUETAS_NUMERICAS: Record<NumericSettingKey, string> = {
  earlyClockInMinutes: 'settings.earlyClockInMinutes',
  lateGraceMinutes: 'settings.lateGraceMinutes',
  requiredBreakMinutes: 'settings.requiredBreakMinutes',
  dailyOvertimeThresholdMinutes: 'settings.dailyOvertimeThreshold',
  weeklyOvertimeThresholdMinutes: 'settings.weeklyOvertimeThreshold',
  minimumRestMinutes: 'settings.minimumRestMinutes',
  photoRetentionDays: 'settings.photoRetentionDays',
  kioskSyncStaleMinutes: 'settings.kioskSyncStaleMinutes',
  overtimeMultiplierPercent: 'settings.overtimeMultiplierPercent',
};

const NUMERIC_SETTINGS: { key: NumericSettingKey; labelKey: string }[] = (
  Object.keys(ETIQUETAS_NUMERICAS) as NumericSettingKey[]
).map((key) => ({ key, labelKey: ETIQUETAS_NUMERICAS[key] }));

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
    overtimeMultiplierPercent: String(location.settings.overtimeMultiplierPercent),
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
    overtimeMultiplierPercent: parseNumber('overtimeMultiplierPercent'),
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

/**
 * Sesión de esta persona: cerrar sesión aquí, y en todos los dispositivos (§8).
 *
 * NO HABÍA NINGÚN CIERRE DE SESIÓN EN LA INTERFAZ. La función existía en el store,
 * pero nada la llamaba: quien entraba al panel no tenía forma de salir, ni de dejar
 * de estar dentro en un iPad compartido. Y "cerrar sesión en todos los dispositivos",
 * que §8 pide explícitamente para administradores, no existía en absoluto —solo su
 * etiqueta traducida, que es lo que delató las dos ausencias—.
 *
 * El global va detrás de una confirmación y el normal no: cerrar aquí se deshace
 * volviendo a entrar, y cerrar en todas partes echa a la persona de su teléfono, del
 * iPad de la oficina y de donde estuviera, y eso no se pulsa por error.
 */
function SessionCard({ canSignOutEverywhere }: { canSignOutEverywhere: boolean }) {
  const { t } = useTranslation();
  const email = useSessionStore((state) => state.user?.email ?? null);
  const role = useSessionStore((state) => state.role);
  const signOut = useSessionStore((state) => state.signOut);
  const signOutEverywhere = useSessionStore((state) => state.signOutEverywhere);

  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /*
   * No se navega a mano al terminar: el cambio de sesión lo recoge la resolución de
   * arranque, que es la única que decide destinos. Y el botón se libera pase lo que
   * pase: las dos funciones no lanzan, pero un botón girando para siempre sería peor
   * que el propio fallo.
   */
  const cerrar = (todos: boolean) => {
    setConfirming(false);
    setWorking(true);
    void (todos ? signOutEverywhere() : signOut()).finally(() => setWorking(false));
  };

  return (
    <FormCard title={t('auth.sessionTitle')} description={email ?? undefined}>
      <Stack gap={spacing.md}>
        {role !== null ? <KeyValueRow label={t('roles.label')} value={t(`roles.${role}`)} /> : null}

        <SecondaryButton
          label={t('auth.signOut')}
          onPress={() => cerrar(false)}
          loading={working}
          testID="settings-sign-out"
        />

        {canSignOutEverywhere ? (
          <Stack gap={spacing.xs}>
            <DangerButton
              label={t('auth.signOutEverywhere')}
              onPress={() => setConfirming(true)}
              loading={working}
              testID="settings-sign-out-everywhere"
            />
            <AppText variant="help" tone="subtle">
              {t('auth.signOutEverywhereHint')}
            </AppText>
          </Stack>
        ) : null}
      </Stack>

      <ConfirmSheet
        visible={confirming}
        title={t('auth.signOutEverywhere')}
        body={t('auth.signOutEverywhereConfirm')}
        confirmLabel={t('auth.signOutEverywhere')}
        destructive
        onConfirm={() => cerrar(true)}
        onCancel={() => setConfirming(false)}
      />
    </FormCard>
  );
}

/**
 * Versión, política de privacidad y soporte.
 *
 * `EXPO_PUBLIC_PRIVACY_URL` y `EXPO_PUBLIC_SUPPORT_EMAIL` estaban declaradas y
 * validadas en `src/lib/env.ts` desde el principio, con valor por defecto, y NO LAS
 * LEÍA NADIE. Una variable de entorno que no se usa es una promesa: alguien la
 * configura, reinicia, y no cambia nada.
 *
 * Y la política de privacidad no es decorativa: App Store la exige para publicar (paso
 * 7 de la lista de la cuenta Apple en el README), y lo normal es poder abrirla desde
 * dentro de la app, no solo desde la ficha de la tienda.
 *
 * Los dos enlaces se abren con `Linking`, que en iOS resuelve `https:` y `mailto:`. Si
 * el sistema no puede abrirlos —un simulador sin cliente de correo— no se hace nada
 * visible; no vale la pena un error para esto.
 */
function AboutCard() {
  const { t } = useTranslation();

  return (
    <FormCard title={t('settings.aboutTitle')}>
      <Stack gap={spacing.md}>
        <KeyValueRow
          label={t('settings.appVersion')}
          value={Constants.expoConfig?.version ?? '—'}
        />
        <SecondaryButton
          label={t('settings.privacy')}
          onPress={() => {
            void Linking.openURL(env.EXPO_PUBLIC_PRIVACY_URL).catch(() => undefined);
          }}
          testID="settings-privacy"
        />
        <SecondaryButton
          label={t('settings.support')}
          hint={env.EXPO_PUBLIC_SUPPORT_EMAIL}
          onPress={() => {
            void Linking.openURL(`mailto:${env.EXPO_PUBLIC_SUPPORT_EMAIL}`).catch(() => undefined);
          }}
          testID="settings-support"
        />
      </Stack>
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

  // El umbral es el MISMO que usa el trabajo de notificaciones (§19): si el panel
  // dijera "sin sincronizar" con otro número, el aviso del teléfono y la pantalla
  // se contradirían sobre el mismo iPad.
  const staleAfterMinutes =
    scope.location?.settings.kioskSyncStaleMinutes ??
    DEFAULT_LOCATION_SETTINGS.kioskSyncStaleMinutes;

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
              <KeyValueRow label={t('settings.kioskLocation')} value={device.location_name} />
              <KeyValueRow
                label={t('settings.kioskLastSeen')}
                value={
                  device.last_seen_at === null
                    ? t('settings.never')
                    : formatClockTime(device.last_seen_at, scope.timezone, scope.timeFormat)
                }
              />
              <KeyValueRow
                label={t('settings.kioskLastContact')}
                value={describeSeen(device.minutes_since_seen, staleAfterMinutes, t)}
              />
              <KeyValueRow
                label={t('settings.kioskLastSync')}
                value={describeQueueFlush(device.minutes_since_sync, t)}
              />
              <KeyValueRow
                label={t('settings.kioskAppVersion')}
                value={device.app_version ?? t('settings.unknownVersion')}
              />
              {isSyncStale(device, staleAfterMinutes) ? (
                <InlineNotice
                  tone="warning"
                  body={t('settings.kioskSyncStaleHint')}
                  testID={`kiosk-sync-stale-${device.id}`}
                />
              ) : null}
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
            {/*
              La séptima alerta de §19 no tiene interruptor, y se DICE. Dejarlo
              implícito significa que llega una notificación que nada en la app
              menciona, y quien busque cómo apagarla no la va a encontrar: no
              existe. Va después de los seis interruptores porque es la respuesta a
              "¿y esto es todo lo que me van a avisar?".
            */}
            <InlineNotice
              tone="info"
              icon="lock-closed-outline"
              title={t('settings.notifyAlwaysOnTitle')}
              body={t('settings.notifyAlwaysOnBody')}
              testID="notify-always-on"
            />
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

/**
 * Un kiosco lleva demasiado sin dar señales (§19).
 *
 * MIDE EL ÚLTIMO CONTACTO, no la última vez que vació la cola, y el cambio arregla
 * un fallo mío: la versión anterior usaba `minutes_since_sync` y trataba `null`
 * —nunca sincronizó— como atrasado, razonando que "un iPad activado que jamás
 * sincronizó es uno que nadie terminó de instalar".
 *
 * El razonamiento era correcto para lo que el campo debería significar, pero ese
 * campo solo lo escribe la función de sincronización offline: en un iPad con buen
 * wifi se queda en `null` para siempre. Así que la pantalla marcaba en ámbar TODOS
 * los kioscos sanos, y la alerta del §19 avisaba todos los días.
 *
 * `minutes_since_seen` sale de `last_seen_at`, que el servidor actualiza en cada
 * petición autenticada del kiosco. Nunca es `null` y significa exactamente lo que
 * hay que saber: si el reloj sigue hablando con nosotros.
 *
 * Solo se avisa de dispositivos activos: uno revocado ya no debe dar señales.
 */
export function isSyncStale(
  device: Pick<KioskDevice, 'status' | 'minutes_since_seen'>,
  staleAfterMinutes: number,
): boolean {
  if (device.status !== 'active') return false;
  return device.minutes_since_seen > staleAfterMinutes;
}

/**
 * Cuánto lleva sin dar señales, en palabras.
 *
 * Minutos por debajo de una hora y horas por encima: "hace 372 min" obliga a
 * dividir mentalmente para saber si eso es mucho. Y cuando pasa del umbral el
 * propio texto lo dice, en vez de dejar el juicio en manos de quien lee un número.
 */
export function describeSeen(
  minutes: number,
  staleAfterMinutes: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (minutes < 60) return t('settings.kioskSyncFresh', { minutes });
  const hours = Math.floor(minutes / 60);
  return minutes > staleAfterMinutes
    ? t('settings.kioskSyncStale', { hours })
    : t('settings.kioskSyncHours', { hours });
}

/**
 * Cuánto lleva sin VACIAR SU COLA, que es otra cosa.
 *
 * `null` significa "nunca ha tenido nada que sincronizar", que en una tienda con red
 * estable es lo normal y lo bueno. Por eso el texto NO dice "nunca sincronizó" a
 * secas, que se lee como un problema: dice que no hubo nada pendiente.
 */
export function describeQueueFlush(
  minutes: number | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (minutes === null) return t('settings.kioskNothingToSync');
  if (minutes < 60) return t('settings.kioskSyncFresh', { minutes });
  return t('settings.kioskSyncHours', { hours: Math.floor(minutes / 60) });
}
