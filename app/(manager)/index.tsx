import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { AsyncSection } from '@/components/schedule/data-states';
import { InlineNotice, LimitBar, StatTile } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { OfflineBanner, StatusBadge, SyncIndicator } from '@/components/ui/states';
import { useEmployeeNames } from '@/features/team/hooks';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useManagerDashboard, type RightNowEntry } from '@/hooks/use-manager-dashboard';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { useNetworkStore } from '@/stores/network-store';
import { spacing } from '@/theme/tokens';
import { currentLanguage } from '@/i18n';
import { formatClockTime, formatLongDate, minutesToHHmm } from '@/utils/time';

/**
 * Inicio administrativo (§11.1).
 *
 * Encabezado con ubicación y fecha, tarjetas compactas con las cifras que un
 * gerente necesita ver de un vistazo, y la lista "Ahora mismo". Se actualiza por
 * sondeo: si Realtime falla, esta pantalla sigue siendo correcta (§11.1).
 */
export default function ManagerHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scope = useManagerScope();
  const language = currentLanguage();
  const now = useLiveClock('minute');
  const { isWide } = useResponsive();

  const online = useNetworkStore((state) => state.online);
  const syncing = useNetworkStore((state) => state.syncing);
  const pendingCount = useNetworkStore((state) => state.pendingCount);

  const dashboard = useManagerDashboard({
    organizationId: scope.organization?.id ?? null,
    locationId: scope.locationId,
    timezone: scope.timezone,
    weekStartsOn: scope.weekStartsOn,
    lateGraceMinutes: scope.settings.lateGraceMinutes,
    now,
  });

  const names = useEmployeeNames(scope.organization?.id ?? null);

  /**
   * `since` NO significa lo mismo en los cinco estados: es la entrada de quien está
   * trabajando, el inicio del descanso de quien descansa, y el INICIO DEL TURNO de
   * quien todavía no ha llegado o no llegó. Ver `RightNowEntry.since`.
   *
   * Una sola etiqueta para los cinco mentía: «Desde las 09:00 · Lleva 08:34» junto a
   * «No se presentó» decía que alguien que no vino llevaba ocho horas dentro. El
   * dato era correcto y la frase era falsa, que es la peor combinación.
   */
  const timeLabelKey = (estado: RightNowEntry['state']): string => {
    switch (estado) {
      case 'working':
        return 'admin.sinceLabel';
      case 'onBreak':
        return 'admin.sinceBreakLabel';
      case 'upcoming':
        return 'admin.dueAtLabel';
      default:
        return 'admin.shouldHaveEnteredLabel';
    }
  };

  /** Solo se lleva tiempo dentro quien está dentro. */
  const cuentaTiempo = (estado: RightNowEntry['state']): boolean =>
    estado === 'working' || estado === 'onBreak';

  const stateLabel = (entry: RightNowEntry): string => {
    switch (entry.state) {
      case 'working':
        return t('attendance.statusWorking');
      case 'onBreak':
        return t('attendance.statusOnBreak');
      case 'upcoming':
        return t('admin.upcoming');
      case 'late':
        return t('attendance.statusLate');
      default:
        return t('attendance.statusNoShow');
    }
  };

  return (
    <AppScreen tone="canvas" scroll testID="manager-home">
      <ResponsiveContainer>
        <Stack gap={spacing.lg}>
          <Row justify="space-between" align="flex-start" gap={spacing.md} wrap>
            <Stack gap={spacing.xs}>
              <AppText variant="title" accessibilityRole="header">
                {scope.location?.name ?? t('admin.homeTitle')}
              </AppText>
              <AppText variant="help" tone="subtle">
                {formatLongDate(now, scope.timezone, language)}
              </AppText>
            </Stack>
            <SyncIndicator online={online} syncing={syncing} pendingCount={pendingCount} />
          </Row>

          {!online ? <OfflineBanner pendingCount={pendingCount} /> : null}

          <AsyncSection
            isPending={scope.isLoading}
            error={scope.error}
            isEmpty={scope.locations.length === 0}
            emptyTitle={t('settings.noLocations')}
            emptyBody={t('settings.noLocationsHint')}
            onRetry={scope.refetch}
          >
            <AsyncSection
              isPending={dashboard.isPending}
              error={dashboard.error}
              onRetry={dashboard.refetch}
            >
              <Stack gap={spacing.lg}>
                <Row gap={spacing.sm} wrap align="flex-start">
                  <StatTile
                    label={t('admin.workingNow')}
                    value={String(dashboard.workingCount)}
                    tone="working"
                    icon="checkmark-circle"
                    testID="tile-working"
                  />
                  <StatTile
                    label={t('admin.onBreakNow')}
                    value={String(dashboard.onBreakCount)}
                    tone="onBreak"
                    icon="cafe-outline"
                    testID="tile-on-break"
                  />
                  <StatTile
                    label={t('admin.upcoming')}
                    value={String(dashboard.upcomingCount)}
                    tone="info"
                    icon="log-in-outline"
                    testID="tile-upcoming"
                  />
                  <StatTile
                    label={t('admin.late')}
                    value={String(dashboard.lateCount)}
                    tone={dashboard.lateCount > 0 ? 'late' : 'offShift'}
                    icon="alert-circle"
                    testID="tile-late"
                  />
                  <StatTile
                    label={t('admin.absent')}
                    value={String(dashboard.absentCount)}
                    tone={dashboard.absentCount > 0 ? 'late' : 'offShift'}
                    icon="person-remove-outline"
                    testID="tile-absent"
                  />
                  <StatTile
                    label={t('admin.incompleteEntries')}
                    value={String(dashboard.incompleteCount)}
                    tone={dashboard.incompleteCount > 0 ? 'late' : 'offShift'}
                    icon="help-circle-outline"
                    onPress={() => router.push('/(manager)/hours')}
                    testID="tile-incomplete"
                  />
                  <StatTile
                    label={t('admin.pendingSync')}
                    value={String(dashboard.pendingSyncCount)}
                    tone={dashboard.pendingSyncCount > 0 ? 'onBreak' : 'offShift'}
                    icon="cloud-offline-outline"
                    testID="tile-pending-sync"
                  />
                  <StatTile
                    label={t('admin.pendingRequests')}
                    value={String(dashboard.pendingRequestCount)}
                    tone={dashboard.pendingRequestCount > 0 ? 'info' : 'offShift'}
                    icon="mail-unread-outline"
                    onPress={() => router.push('/(manager)/more')}
                    testID="tile-pending-requests"
                  />
                </Row>

                <Card>
                  <AppText variant="bodyStrong">{t('admin.scheduledVsWorked')}</AppText>
                  <LimitBar
                    label={`${t('admin.workedHours')} · ${t('admin.scheduledHours')}`}
                    value={dashboard.workedMinutesThisWeek}
                    limit={dashboard.scheduledMinutesThisWeek}
                    valueLabel={`${minutesToHHmm(dashboard.workedMinutesThisWeek)} / ${minutesToHHmm(
                      dashboard.scheduledMinutesThisWeek,
                    )}`}
                    testID="scheduled-vs-worked"
                  />
                  <SecondaryButton
                    label={t('admin.openSchedule')}
                    onPress={() => router.push('/(manager)/schedule')}
                    fullWidth={false}
                    testID="home-open-schedule"
                  />
                </Card>

                <Stack gap={spacing.sm}>
                  <AppText variant="section" accessibilityRole="header">
                    {t('admin.rightNow')}
                  </AppText>
                  {dashboard.rightNow.length === 0 ? (
                    <InlineNotice
                      tone="offShift"
                      icon="moon-outline"
                      title={t('admin.nobodyRightNow')}
                      body={t('admin.nobodyRightNowHint')}
                    />
                  ) : (
                    <Stack gap={spacing.sm}>
                      {dashboard.rightNow.map((entry) => (
                        <Card key={`${entry.state}-${entry.employeeId}-${entry.since}`}>
                          <Row justify="space-between" gap={spacing.md} align="center">
                            <Stack gap={spacing.xs}>
                              <AppText variant="bodyStrong">
                                {entry.name !== ''
                                  ? entry.name
                                  : (names.get(entry.employeeId) ?? t('team.unknownEmployee'))}
                              </AppText>
                              {/*
                                La hora suelta —"14:23"— no dice de qué. Con la
                                etiqueta se lee sin tener que deducirla del estado.
                              */}
                              <AppText variant="help" tone="subtle" tabular>
                                {t(timeLabelKey(entry.state), {
                                  time: formatClockTime(
                                    entry.since,
                                    scope.timezone,
                                    scope.timeFormat,
                                    language,
                                  ),
                                })}
                              </AppText>
                            </Stack>

                            {/*
                              El tiempo transcurrido solo en pantalla ancha.
                              En un monitor la fila tenía el nombre a la izquierda y la
                              etiqueta de estado a 1.100 px de distancia, con el medio
                              vacío: eso es lo que hace que una app se lea como un
                              móvil estirado. Y no es relleno: cuánto lleva dentro
                              alguien es el dato que decide si mandarlo a descansar.
                              En teléfono no se pinta, porque ahí el ancho es el
                              recurso escaso y la fila ya va justa. Y solo para quien
                              está DENTRO: ver `cuentaTiempo`.
                            */}
                            {isWide && cuentaTiempo(entry.state) ? (
                              <AppText variant="help" tone="subtle" tabular>
                                {t('admin.elapsedLabel', {
                                  duration: minutesToHHmm(
                                    Math.max(
                                      0,
                                      Math.round((now.getTime() - Date.parse(entry.since)) / 60000),
                                    ),
                                  ),
                                })}
                              </AppText>
                            ) : null}
                            <StatusBadge
                              label={stateLabel(entry)}
                              tone={
                                entry.state === 'working'
                                  ? 'working'
                                  : entry.state === 'onBreak'
                                    ? 'onBreak'
                                    : entry.state === 'upcoming'
                                      ? 'info'
                                      : 'late'
                              }
                              icon={
                                entry.state === 'working'
                                  ? 'checkmark-circle'
                                  : entry.state === 'onBreak'
                                    ? 'cafe-outline'
                                    : entry.state === 'upcoming'
                                      ? 'log-in-outline'
                                      : 'alert-circle'
                              }
                              compact
                            />
                          </Row>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Stack>
            </AsyncSection>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}
