import { useMemo } from 'react';
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
import { LoImportanteDeHoy } from '@/components/dashboard/lo-importante';
import { prioridadDelDia } from '@/features/dashboard/prioridad';
import { FilaDeFranja, FranjaDeUnDia } from '@/components/franja/franja-del-dia';
import { ventanaDelDia } from '@/domain/franja-del-dia';
import {
  useManagerDashboard,
  type FranjaDeHoy,
  type RightNowEntry,
} from '@/hooks/use-manager-dashboard';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { useNetworkStore } from '@/stores/network-store';
import { spacing } from '@/theme/tokens';
import { currentLanguage } from '@/i18n';
import {
  formatClockTime,
  formatLongDate,
  minutesToHHmm,
  type TimeFormatPreference,
} from '@/utils/time';

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

  /*
   * LA VENTANA DE LA FRANJA SALE DE LA JORNADA REAL, no de «las 24 horas del día». Una
   * tienda que abre de 8 a 18 gastaría dos tercios de la franja en horas en las que no
   * pasa nada, y comprimiría los turnos justo en la parte que importa.
   */
  const franjasDeHoy = dashboard.franjas;
  /*
   * `ahora` SE MEMORIZA, y no es una micro-optimización: `new Date(now)` crea un objeto
   * nuevo en cada render, así que usarlo como dependencia de la ventana la recalcularía
   * siempre y el `useMemo` no serviría de nada. `now` viene del reloj vivo y cambia una
   * vez por minuto, que es exactamente cada cuánto tiene sentido mover la marca.
   */
  const ahora = useMemo(() => new Date(now), [now]);
  const ventana = useMemo(() => {
    const intervalos = franjasDeHoy.flatMap((franja) =>
      [franja.turno, franja.trabajado].filter((i) => i !== null),
    );
    return ventanaDelDia(intervalos, ahora) ?? { desde: ahora, hasta: ahora };
  }, [franjasDeHoy, ahora]);

  /*
   * Los cinco conteos que piden una acción, ordenados por lo que cuesta ignorarlos.
   * La regla vive en `prioridadDelDia`, aparte y probada: si estuviera aquí dentro, la
   * única forma de comprobar que un día con ausentes se ve distinto de un día tranquilo
   * sería montar la pantalla entera y mirarla.
   */
  const prioridad = prioridadDelDia({
    absent: dashboard.absentCount,
    late: dashboard.lateCount,
    incomplete: dashboard.incompleteCount,
    requests: dashboard.pendingRequestCount,
    pendingSync: dashboard.pendingSyncCount,
  });

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
                {/*
                  LO PRIMERO DE LA PANTALLA ES LO QUE DECIDE EL DÍA, y cambia según el
                  día. Antes aquí había ocho casillas del mismo tamaño y en el mismo
                  orden siempre: había que leerlas las ocho para saber si pasaba algo, y
                  un «0 atrasados» ocupaba lo mismo que un «3 ausentes».
                */}
                <LoImportanteDeHoy
                  prioridad={prioridad}
                  trabajando={dashboard.workingCount}
                  enDescanso={dashboard.onBreakCount}
                />

                {/*
                  Y ESTO SOLO INFORMA, así que va debajo y en pequeño: quién está dentro
                  y quién entra luego. No desaparece —es lo que se mira cuando no hay
                  nada urgente— pero deja de competir con lo que sí pide una acción.
                */}
                <Stack gap={spacing.sm}>
                  <AppText variant="label" tone="subtle" accessibilityRole="header">
                    {t('home.justSoYouKnow')}
                  </AppText>
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
                  </Row>
                </Stack>

                {/*
                  LA FRANJA DEL DÍA, en el sitio donde antes había una barra de progreso
                  sin escala: «80:03 / 132:00» y un relleno morado que no decía contra qué
                  se medía. La franja sí lo dice, porque enseña el turno y lo fichado sobre
                  la MISMA regla: tarde es que el macizo empiece más adentro, y no vino es
                  un carril vacío.

                  El total de la semana se queda debajo, en texto: sigue haciendo falta,
                  pero es un dato de cierre de semana y no lo que se mira a media mañana.
                */}
                <Card>
                  <AppText variant="bodyStrong">{t('band.title')}</AppText>
                  <AppText variant="help" tone="subtle">
                    {t('band.hint')}
                  </AppText>

                  {franjasDeHoy.length === 0 ? (
                    <AppText variant="help" tone="subtle" testID="band-empty">
                      {t('band.empty')}
                    </AppText>
                  ) : (
                    <Stack gap={spacing.sm} testID="band-list">
                      {franjasDeHoy.map((franja) => (
                        <FilaDeFranja
                          key={franja.employeeId}
                          nombre={names.get(franja.employeeId) ?? t('common.unknown')}
                          detalle={detalleDeFranja(franja, scope.timezone, scope.timeFormat)}
                          testID={`band-row-${franja.employeeId}`}
                        >
                          <FranjaDeUnDia
                            ventana={ventana}
                            turno={franja.turno}
                            trabajado={franja.trabajado}
                            ahora={ahora}
                            estado={franja.estado}
                            testID={`band-${franja.employeeId}`}
                          />
                        </FilaDeFranja>
                      ))}
                    </Stack>
                  )}

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

/**
 * La hora que hay que leer en una fila de la franja.
 *
 * NO REPITE LO QUE LA FRANJA YA DICE. La forma enseña si llegó tarde o si no vino; lo que
 * el texto añade es el dato exacto que hace falta para actuar —a qué hora entró, o a qué
 * hora tenía que haber entrado— porque para llamar a alguien no sirve «más adentro».
 */
function detalleDeFranja(
  franja: FranjaDeHoy,
  zona: string,
  timeFormat: TimeFormatPreference,
): string | undefined {
  /*
   * LA ZONA VA SEGUNDA, no el formato. La primera versión pasaba «24h» donde iba la zona
   * horaria, así que `inZone` recibía una zona inválida y todas las filas enseñaban
   * «--:--». Compilaba —los dos parámetros son `string`— y solo se vio mirando la
   * pantalla: es justo el fallo que ningún tipo atrapa.
   */
  const hora = (fecha: Date) => formatClockTime(fecha.toISOString(), zona, timeFormat);
  if (franja.trabajado !== null) return hora(franja.trabajado.desde);
  if (franja.turno !== null) return hora(franja.turno.desde);
  return undefined;
}
