import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  fetchMiFicha,
  fetchMisJornadas,
  fetchMisTurnos,
  fetchRelojDesdeDeMisSedes,
  type MiFicha,
} from './api';
import {
  diasDelVendedor,
  jornadaOlvidada,
  minutosDeLaJornada,
  resumenDelMes,
  type DiaDelVendedor,
  type EstadoDelDia,
} from './resumen';
import { AdminErrorState } from '@/components/schedule/data-states';
import { SegmentedControl, StatTile } from '@/components/schedule/fields';
import { MonthNavigator } from '@/components/schedule/week-tools';
import { EtiquetaDeFeriado } from '@/components/schedule/feriado';
import { feriadoDe } from '@/domain/feriados-peru';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { LanguageSwitch } from '@/components/ui/language-switch';
import {
  AppScreen,
  Card,
  ResponsiveContainer,
  Row,
  SeparadorDeRegistro,
  Stack,
} from '@/components/ui/layout';
import { EmptyState, LoadingState, StatusBadge } from '@/components/ui/states';
import { periodoDe } from '@/features/reports/periodo';
import {
  addWeeks,
  currentWeekStart,
  dateKeyOf,
  formatDateKeyShort,
  formatWeekdayShort,
  weekDays,
  weekRangeInstants,
} from '@/features/schedules/week';
import { fetchTimeEvents } from '@/features/timesheets/api';
import {
  useMisJustificaciones,
  type ResolucionDeFalta,
} from '@/features/timesheets/justificaciones';
import { etiquetaDeFalta, motivoDeFalta } from '@/features/timesheets/textos-de-falta';
import { esCumplidoEspecial, etiquetaDeCumplido } from '@/features/timesheets/textos-de-cumplido';
import { useLiveClock } from '@/hooks/use-live-clock';
import { currentLanguage, type SupportedLanguage } from '@/i18n';
import { useSessionStore } from '@/stores/session-store';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';
import { radii, spacing, type StatusTone } from '@/theme/tokens';
import { formatClockTime } from '@/utils/time';
import { HorasQueDebes } from './horas-que-debes';
import { MiDisponibilidad } from './mi-disponibilidad';
import { ChipDeDisponibilidad } from '@/components/availability/chip-de-disponibilidad';
import { useMiDisponibilidad } from '@/features/availability/api';
import { disponibilidadDelDia, type Disponibilidad } from '@/features/availability/disponibilidad';

/**
 * LA VISTA DEL VENDEDOR, en su celular (30-sep).
 *
 * Lo pidió Andree: que cada persona del equipo entre con su correo y vea SOLO lo suyo —qué
 * horario le toca esta semana y la siguiente, cuánto lleva trabajado en el mes, si llegó
 * tarde o temprano—. Nada que editar y nada de los demás: las reglas de Firestore ya no le
 * dejan leer otra cosa (`isSelfEmployee`), así que esta pantalla no podría enseñarlo aunque
 * quisiera.
 *
 * SE LEE DE ARRIBA ABAJO EN EL ORDEN EN QUE SE PREGUNTA:
 *   1. Hoy: ¿estoy dentro?, ¿a qué hora entro?, ¿hoy libro?
 *   2. La semana —esta o la siguiente—, día por día, con lo que marcó al lado del turno.
 *   3. El mes: horas, días, a tiempo, tarde; y abajo, cada día con marca.
 *
 * UNA COLUMNA, del ancho de un teléfono también en el ordenador: es una vista personal, no
 * un tablero, y en pantalla ancha una tira centrada se lee mejor que cuatro columnas vacías.
 */

/**
 * UNA DURACIÓN COMO LA DIRÍA UNA PERSONA: «8 h 25 min», no «08:25». En el panel las horas
 * van en reloj porque se suman en columnas; aquí las lee quien las trabajó, y «12:15 h» se
 * confunde con la hora del día.
 */
export function duracion(minutos: number, t: TFunction): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return t('portal.durationMinutes', { m });
  if (m === 0) return t('portal.durationHours', { h });
  return t('portal.durationHoursMinutes', { h, m });
}

export function MiHorarioScreen() {
  const { t } = useTranslation();
  const ficha = useQuery({ queryKey: ['portal', 'ficha'], queryFn: fetchMiFicha });

  if (ficha.isPending) {
    return (
      <AppScreen tone="canvas">
        <LoadingState label={t('portal.loading')} />
      </AppScreen>
    );
  }
  if (ficha.error !== null) {
    return (
      <AppScreen tone="canvas">
        <AdminErrorState error={ficha.error} onRetry={() => void ficha.refetch()} />
      </AppScreen>
    );
  }
  if (ficha.data === null || !ficha.data.activo) {
    return (
      <AppScreen tone="canvas" scroll testID="mi-horario">
        <ResponsiveContainer width="form">
          <Stack gap={spacing.lg}>
            <EmptyState
              icon="person-outline"
              title={ficha.data === null ? t('portal.noFileTitle') : t('portal.inactiveTitle')}
              body={ficha.data === null ? t('portal.noFileBody') : t('portal.inactiveBody')}
              testID="mi-horario-sin-ficha"
            />
            <Pie />
          </Stack>
        </ResponsiveContainer>
      </AppScreen>
    );
  }
  return <Contenido ficha={ficha.data} />;
}

function Contenido({ ficha }: { ficha: MiFicha }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const estilos = useEstilos();
  const now = useLiveClock('minute');
  const nowISO = now.toISOString();
  const tz = ficha.timezone;
  const formato = ficha.sede?.settings.timeFormat;
  const hora = (instante: string) => formatClockTime(instante, tz, formato, language);

  const [semana, setSemana] = useState<'esta' | 'proxima'>('esta');
  const [mesOffset, setMesOffset] = useState(0);

  // Las dos semanas en una sola consulta: cambiar de una a otra no espera a la red.
  const inicio = currentWeekStart(nowISO, ficha.weekStartsOn, tz);
  const desdeSemanas = weekRangeInstants(inicio, tz).fromISO;
  const hastaSemanas = weekRangeInstants(addWeeks(inicio, 1), tz).toISO;
  const periodo = periodoDe({
    tipo: 'mes',
    offset: mesOffset,
    nowISO,
    weekStartsOn: ficha.weekStartsOn,
    timezone: tz,
  });

  const base = { organizationId: ficha.organizationId, employeeId: ficha.employeeId };
  const turnosSemanas = useQuery({
    queryKey: ['portal', 'turnos', ficha.employeeId, desdeSemanas, hastaSemanas],
    queryFn: () => fetchMisTurnos({ ...base, fromISO: desdeSemanas, toISO: hastaSemanas }),
  });
  const jornadasSemanas = useQuery({
    queryKey: ['portal', 'jornadas', ficha.employeeId, desdeSemanas, hastaSemanas],
    queryFn: () => fetchMisJornadas({ ...base, fromISO: desdeSemanas, toISO: hastaSemanas }),
    // Lo de hoy cambia mientras trabaja: se refresca solo cada minuto.
    refetchInterval: 60_000,
  });
  const turnosMes = useQuery({
    queryKey: ['portal', 'turnos', ficha.employeeId, periodo.fromISO, periodo.toISO],
    queryFn: () => fetchMisTurnos({ ...base, fromISO: periodo.fromISO, toISO: periodo.toISO }),
  });
  const jornadasMes = useQuery({
    queryKey: ['portal', 'jornadas', ficha.employeeId, periodo.fromISO, periodo.toISO],
    queryFn: () => fetchMisJornadas({ ...base, fromISO: periodo.fromISO, toISO: periodo.toISO }),
  });

  /*
   * DESDE CUÁNDO SU TIENDA USA EL RELOJ (1-oct): lo que separa una FALTA de un turno de antes
   * de la app. Una fecha por sede donde tiene turnos; mientras no llega, nada se llama falta.
   */
  const sedesConTurno = [
    ...new Set(
      [...(turnosSemanas.data ?? []), ...(turnosMes.data ?? [])].map((tt) => tt.location_id),
    ),
  ].sort();
  const relojDesdeQuery = useQuery({
    queryKey: ['portal', 'reloj-desde', sedesConTurno.join(',')],
    queryFn: () => fetchRelojDesdeDeMisSedes(sedesConTurno),
    enabled: sedesConTurno.length > 0,
    staleTime: 10 * 60 * 1000,
  });
  const relojDesde = (locationId: string) => relojDesdeQuery.data?.get(locationId);

  // Lo que dijo quien administra de sus faltas (2-oct): justificada o no, y por qué.
  const misJustificaciones = useMisJustificaciones(base);
  const resoluciones = misJustificaciones.data ?? [];

  /*
   * SOLO SI ESTÁ DENTRO: ¿trabajando o en su descanso? Lo dice la última marca. Se mira
   * ANTES de contar los días (2-oct), porque durante el refrigerio el reloj se para: con
   * la cuenta de Horas y Equipo (`minutosEnCurso`), sus horas de hoy no siguen subiendo
   * mientras come. Antes el celular las seguía sumando y bajaban de golpe al volver.
   */
  const abierta = (jornadasSemanas.data ?? []).find(
    (j) => j.ends_at === null && !jornadaOlvidada(j, nowISO),
  );
  const marcasDeHoy = useQuery({
    queryKey: ['portal', 'marcas', ficha.employeeId, abierta?.id ?? 'ninguna'],
    queryFn: () =>
      fetchTimeEvents({
        ...base,
        fromISO: abierta?.starts_at ?? nowISO,
        toISO: new Date(Date.parse(nowISO) + 60_000).toISOString(),
      }),
    enabled: abierta !== undefined,
    refetchInterval: 60_000,
  });
  const ultima = marcasDeHoy.data?.at(-1);
  const enDescanso = abierta !== undefined && ultima?.event_type === 'break_start';
  const descansoDesde = enDescanso && ultima !== undefined ? ultima.occurred_at : null;

  const hoy = dateKeyOf(nowISO, tz);
  const miDisponibilidad = useMiDisponibilidad(base);
  const diasSemana = diasDelVendedor({
    dias: weekDays(semana === 'esta' ? inicio : addWeeks(inicio, 1)),
    turnos: turnosSemanas.data ?? [],
    jornadas: jornadasSemanas.data ?? [],
    timezone: tz,
    nowISO,
    relojDesde,
    resoluciones,
    descansoDesde,
  });
  const diaDeHoy = diasDelVendedor({
    dias: [hoy],
    turnos: turnosSemanas.data ?? [],
    jornadas: jornadasSemanas.data ?? [],
    timezone: tz,
    nowISO,
    relojDesde,
    resoluciones,
    descansoDesde,
  })[0];
  const diasMes = diasDelVendedor({
    dias: periodo.dias,
    turnos: turnosMes.data ?? [],
    jornadas: jornadasMes.data ?? [],
    timezone: tz,
    nowISO,
    relojDesde,
    resoluciones,
    descansoDesde,
  });
  const mes = resumenDelMes(diasMes);
  const diasConAlgo = diasMes.filter(
    (d) => d.jornadas.length > 0 || d.estado === 'sinMarca' || d.faltas.length > 0,
  );

  const cargandoSemana = turnosSemanas.isPending || jornadasSemanas.isPending;
  /** Ni un turno publicado, ni uno cambiando, ni una marca: esa semana no se ha publicado. */
  const semanaSinPublicar = diasSemana.every(
    (d) => d.turnos.length === 0 && d.porConfirmar.length === 0 && d.jornadas.length === 0,
  );
  const fallo =
    turnosSemanas.error ?? jornadasSemanas.error ?? turnosMes.error ?? jornadasMes.error;

  return (
    <AppScreen tone="canvas" scroll testID="mi-horario">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <Stack gap={spacing.xs}>
            <AppText variant="label" tone="primary">
              {ficha.sede === null
                ? ficha.organizacion
                : `${ficha.organizacion} · ${ficha.sede.name}`}
            </AppText>
            <AppText variant="title" testID="mi-horario-hola">
              {t('portal.hello', { name: ficha.nombre })}
            </AppText>
          </Stack>

          {fallo !== null ? (
            <AdminErrorState
              error={fallo}
              onRetry={() => {
                void turnosSemanas.refetch();
                void jornadasSemanas.refetch();
                void turnosMes.refetch();
                void jornadasMes.refetch();
              }}
            />
          ) : null}

          {/* 1. HOY */}
          {diaDeHoy === undefined || cargandoSemana ? null : (
            <Hoy
              dia={diaDeHoy}
              enDescanso={enDescanso}
              desdeDescanso={descansoDesde === null ? null : hora(descansoDesde)}
              descansoDesdeISO={descansoDesde}
              hora={hora}
              nowISO={nowISO}
              zona={tz}
            />
          )}

          {/* LO QUE DEBE, si debe algo: registrado por quien gestiona (1-oct). */}
          <HorasQueDebes
            organizationId={ficha.organizationId}
            employeeId={ficha.employeeId}
            language={language}
          />

          {/*
            MI DISPONIBILIDAD (1-oct): qué días no puede, qué horas prefiere o un
            comentario. Antes de la semana, que es donde se piensa en ella.
          */}
          <MiDisponibilidad
            organizationId={ficha.organizationId}
            employeeId={ficha.employeeId}
            hoy={hoy}
            weekStartsOn={ficha.weekStartsOn}
            language={language}
          />

          {/* 2. LA SEMANA */}
          <Stack gap={spacing.sm}>
            <AppText variant="section">{t('portal.weekTitle')}</AppText>
            <SegmentedControl
              label={t('portal.weekTitle')}
              value={semana}
              options={[
                { value: 'esta', label: t('portal.thisWeek') },
                { value: 'proxima', label: t('portal.nextWeek') },
              ]}
              onChange={setSemana}
              testID="mi-horario-semana"
            />
            <Card style={estilos.lista} testID="mi-horario-dias">
              {cargandoSemana ? (
                <LoadingState />
              ) : semanaSinPublicar ? (
                /*
                  UNA SEMANA SIN NADA PUBLICADO NO SON SIETE DÍAS LIBRES (4-oct). Se enseñaban
                  siete filas «Libre» y debajo, en pequeño, que el horario no estaba publicado:
                  lo primero que se lee dice lo contrario de lo que pasa.
                */
                <Stack gap={spacing.sm}>
                  <EmptyState
                    icon="calendar-outline"
                    title={
                      semana === 'proxima' ? t('portal.nextWeekEmpty') : t('portal.thisWeekEmpty')
                    }
                    body={t('portal.weekEmptyBody')}
                    testID="mi-horario-semana-sin-publicar"
                  />
                  {/*
                    LOS FERIADOS DE ESA SEMANA SIGUEN DICHOS aunque no haya turnos: iban en la
                    fila de su día, y sin filas se perdían. Es justo lo que alguien mira cuando
                    piensa en la semana que viene.
                  */}
                  {diasSemana
                    .filter((d) => feriadoDe(d.dia, tz) !== null)
                    .map((d) => (
                      <Row key={d.dia} gap={spacing.sm} align="center">
                        <AppText variant="label" tone="muted" tabular>
                          {`${formatWeekdayShort(d.dia, language)} ${formatDateKeyShort(d.dia, language)}`}
                        </AppText>
                        <EtiquetaDeFeriado dateKey={d.dia} timezone={tz} />
                      </Row>
                    ))}
                </Stack>
              ) : (
                diasSemana.map((dia, i) => (
                  <View key={dia.dia}>
                    {i > 0 ? <SeparadorDeRegistro /> : null}
                    <FilaDelDia
                      dia={dia}
                      esHoy={dia.dia === hoy}
                      hora={hora}
                      language={language}
                      zona={tz}
                      loQueDije={disponibilidadDelDia(
                        miDisponibilidad.data ?? [],
                        ficha.employeeId,
                        dia.dia,
                      )}
                    />
                  </View>
                ))
              )}
            </Card>
          </Stack>

          {/* 3. EL MES */}
          <Stack gap={spacing.sm}>
            <AppText variant="section">{t('portal.monthTitle')}</AppText>
            <MonthNavigator
              monthStart={periodo.from}
              language={language}
              isCurrentMonth={mesOffset === 0}
              onPrevious={() => setMesOffset((m) => m - 1)}
              onNext={() => setMesOffset((m) => Math.min(0, m + 1))}
              onGoToCurrent={() => setMesOffset(0)}
            />
            <View style={estilos.fichas} testID="mi-horario-mes">
              <View style={estilos.ficha}>
                <StatTile
                  label={t('portal.statHours')}
                  value={duracion(mes.minutosNetos, t)}
                  icon="time-outline"
                  testID="mi-horario-horas"
                />
              </View>
              <View style={estilos.ficha}>
                <StatTile
                  label={t('portal.statDays')}
                  value={String(mes.diasTrabajados)}
                  icon="calendar-outline"
                />
              </View>
              <View style={estilos.ficha}>
                <StatTile
                  label={t('portal.statOnTime')}
                  value={String(mes.aTiempo)}
                  detalle={
                    mes.antesDeHora > 0
                      ? t('portal.statEarly', { count: mes.antesDeHora })
                      : undefined
                  }
                  icon="checkmark-circle-outline"
                  testID="mi-horario-a-tiempo"
                />
              </View>
              <View style={estilos.ficha}>
                <StatTile
                  label={t('portal.statLate')}
                  value={String(mes.tarde)}
                  tone={mes.tarde > 0 ? 'late' : undefined}
                  icon="alert-circle-outline"
                  testID="mi-horario-tarde"
                />
              </View>
              <View style={estilos.ficha}>
                <StatTile
                  label={t('portal.statAbsences')}
                  value={String(mes.faltas)}
                  detalle={
                    mes.faltasJustificadas > 0
                      ? t('absence.justifiedCount', { count: mes.faltasJustificadas })
                      : undefined
                  }
                  tone={
                    mes.faltas > mes.faltasJustificadas
                      ? 'late'
                      : mes.faltas > 0
                        ? 'warning'
                        : undefined
                  }
                  icon="person-remove-outline"
                  testID="mi-horario-faltas"
                />
              </View>
            </View>
            {mes.faltas > mes.faltasJustificadas ? (
              <AppText variant="help" tone="muted" testID="mi-horario-faltas-aviso">
                {t('portal.absenceNotice', { count: mes.faltas - mes.faltasJustificadas })}
              </AppText>
            ) : mes.faltas > 0 ? (
              <AppText variant="help" tone="muted" testID="mi-horario-faltas-aviso">
                {t('portal.absenceAllJustified', { count: mes.faltas })}
              </AppText>
            ) : mes.sinMarca > 0 ? (
              <AppText variant="help" tone="muted" testID="mi-horario-sin-marca">
                {t('portal.noMarkNotice', { count: mes.sinMarca })}
              </AppText>
            ) : null}

            {diasConAlgo.length === 0 ? (
              <AppText variant="help" tone="subtle">
                {t('portal.monthEmpty')}
              </AppText>
            ) : (
              <Card style={estilos.lista} testID="mi-horario-dias-mes">
                {diasConAlgo.map((dia, i) => (
                  <View key={dia.dia}>
                    {i > 0 ? <SeparadorDeRegistro /> : null}
                    <FilaDelDia
                      dia={dia}
                      esHoy={dia.dia === hoy}
                      hora={hora}
                      language={language}
                      zona={tz}
                      loQueDije={disponibilidadDelDia(
                        miDisponibilidad.data ?? [],
                        ficha.employeeId,
                        dia.dia,
                      )}
                    />
                  </View>
                ))}
              </Card>
            )}
          </Stack>

          <Pie />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

/** Lo de hoy, en una frase y con su color: es lo primero que se mira. */
function Hoy({
  dia,
  enDescanso,
  desdeDescanso,
  descansoDesdeISO,
  hora,
  nowISO,
  zona,
}: {
  dia: DiaDelVendedor;
  enDescanso: boolean;
  desdeDescanso: string | null;
  /** El instante en que empezó su pausa: con él, sus horas no suben mientras descansa. */
  descansoDesdeISO: string | null;
  hora: (instante: string) => string;
  nowISO: string;
  /** La de su sede: los feriados del Perú solo salen en sedes del Perú. */
  zona: string;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const turno = dia.turnos[0];
  const abierta = dia.jornadas.find((j) => j.ends_at === null && !jornadaOlvidada(j, nowISO));
  const rango =
    turno === undefined
      ? null
      : `${hora(turno.starts_at)}\u00a0–\u2060\u00a0${hora(turno.ends_at)}`;

  const { tono, titulo, detalle } = ((): {
    tono: StatusTone;
    titulo: string;
    detalle: string | null;
  } => {
    if (abierta !== undefined && enDescanso) {
      return {
        tono: 'onBreak',
        titulo: t('portal.nowOnBreak', { time: desdeDescanso ?? '' }),
        detalle: rango === null ? null : t('portal.todayShift', { range: rango }),
      };
    }
    if (abierta !== undefined) {
      return {
        tono: 'working',
        titulo: t('portal.nowWorking', { time: hora(abierta.starts_at) }),
        detalle:
          dia.jornadas.length > 1
            ? t('portal.nowSoFarDay', {
                hours: duracion(minutosDeLaJornada(abierta, nowISO, descansoDesdeISO), t),
                day: duracion(dia.minutosNetos, t),
              })
            : t('portal.nowSoFar', {
                hours: duracion(minutosDeLaJornada(abierta, nowISO, descansoDesdeISO), t),
              }),
      };
    }
    if (dia.jornadas.length > 0) {
      return {
        tono: 'offShift',
        titulo: t('portal.todayDone', { hours: duracion(dia.minutosNetos, t) }),
        detalle: rango === null ? null : t('portal.todayShift', { range: rango }),
      };
    }
    // Hoy tenía turno y se lo están cambiando (4-oct): ni «libre» ni la hora de antes.
    if (turno === undefined && dia.porConfirmar[0] !== undefined) {
      return {
        tono: 'info',
        titulo: t('portal.todayPendingChange', {
          range: `${hora(dia.porConfirmar[0].starts_at)} – ${hora(dia.porConfirmar[0].ends_at)}`,
        }),
        detalle: t('portal.pendingChangeBody'),
      };
    }
    if (turno === undefined) {
      return { tono: 'offShift', titulo: t('portal.todayFree'), detalle: null };
    }
    if (dia.estado === 'faltaJustificada') {
      return {
        tono: 'warning',
        titulo: t('portal.todayAbsentJustified', { range: rango ?? '' }),
        detalle: dichoDeLaFalta(t, dia.justificaciones[0]),
      };
    }
    if (dia.estado === 'falta') {
      return {
        tono: 'late',
        titulo: t('portal.todayAbsent', { range: rango ?? '' }),
        detalle:
          dia.justificaciones[0] === undefined
            ? t('portal.todayAbsentDetail')
            : dichoDeLaFalta(t, dia.justificaciones[0]),
      };
    }
    if (Date.parse(turno.ends_at) <= Date.parse(nowISO)) {
      return {
        tono: 'warning',
        titulo: t('portal.todayNoMark', { range: rango ?? '' }),
        detalle: null,
      };
    }
    /*
     * YA EMPEZÓ Y NO HA MARCADO (2-oct): lo mismo que ve quien administra —«No ha llegado»
     * en Horario e Inicio—, dicho a la persona. Antes, pasada la hora, seguía diciendo
     * «Hoy te toca de 13:00 a 22:00» como si no hubiera empezado.
     */
    if (Date.parse(turno.starts_at) <= Date.parse(nowISO)) {
      return {
        tono: 'late',
        titulo: t('portal.todayNotArrived', { time: hora(turno.starts_at) }),
        detalle: t('portal.todayNotArrivedDetail'),
      };
    }
    return {
      tono: 'info',
      titulo: t('portal.todayUpcoming', { range: rango ?? '' }),
      detalle: null,
    };
  })();

  return (
    <Card style={{ ...estilos.hoy, ...estilos[`hoy_${tono}`] }} testID="mi-horario-hoy">
      <AppText variant="label" tone="muted">
        {t('portal.today')}
      </AppText>
      <EtiquetaDeFeriado dateKey={dia.dia} timezone={zona} />
      <AppText variant="section" testID={`mi-horario-hoy-${tono}`}>
        {titulo}
      </AppText>
      {detalle === null ? null : (
        <AppText variant="body" tone="muted" tabular>
          {detalle}
        </AppText>
      )}
    </Card>
  );
}

/** El motivo y el comentario de una falta, para la tarjeta de hoy. */
function dichoDeLaFalta(t: TFunction, dicho: ResolucionDeFalta | undefined): string | null {
  if (dicho === undefined) return null;
  const motivo = motivoDeFalta(t, dicho.reason);
  return dicho.note === null ? motivo : `${motivo}: «${dicho.note}»`;
}

const INSIGNIA: Partial<
  Record<
    EstadoDelDia,
    {
      tono: StatusTone;
      icono:
        | 'checkmark-circle'
        | 'alert-circle'
        | 'radio-button-on'
        | 'help-circle-outline'
        | 'person-remove-outline'
        | 'document-text-outline'
        | 'time-outline';
      clave: string;
    }
  >
> = {
  aTiempo: { tono: 'working', icono: 'checkmark-circle', clave: 'portal.badgeOnTime' },
  tarde: { tono: 'late', icono: 'alert-circle', clave: 'portal.badgeLate' },
  enCurso: { tono: 'working', icono: 'radio-button-on', clave: 'portal.badgeWorking' },
  falta: { tono: 'late', icono: 'person-remove-outline', clave: 'portal.badgeAbsent' },
  faltaJustificada: {
    tono: 'warning',
    icono: 'document-text-outline',
    clave: 'portal.badgeAbsentJustified',
  },
  sinMarca: { tono: 'warning', icono: 'help-circle-outline', clave: 'portal.badgeNoMark' },
  porConfirmar: { tono: 'info', icono: 'time-outline', clave: 'portal.badgePendingChange' },
  // La misma palabra que Horas para la salida olvidada.
  sinSalida: { tono: 'warning', icono: 'alert-circle', clave: 'portal.badgeNoClockOut' },
};

/** Un día: a la izquierda cuándo, en medio el turno y lo que marcó, a la derecha cómo fue. */
function FilaDelDia({
  dia,
  esHoy,
  hora,
  language,
  zona,
  loQueDije = [],
}: {
  dia: DiaDelVendedor;
  esHoy: boolean;
  hora: (instante: string) => string;
  language: SupportedLanguage;
  zona: string;
  /** Lo que dijo de ese día en «Mi disponibilidad» (1-oct): se ve al lado de su turno. */
  loQueDije?: readonly Disponibilidad[];
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const insignia = INSIGNIA[dia.estado];
  const faltasJustificadas = dia.faltas.every((tt) =>
    dia.justificaciones.some((dicho) => dicho.shift_id === tt.id && dicho.kind === 'justified'),
  );
  // EL RANGO DE HORAS NO SE PARTE: espacios que no se parten (U+00A0) y un WORD JOINER
  // (U+2060) tras el guion, porque el navegador corta DESPUÉS de un guion aunque el espacio
  // que sigue no se parta. En 390 px se leía «03:00 –» / «12:10», dos datos sueltos.
  const rango = (lista: readonly { starts_at: string; ends_at: string }[]) =>
    lista.map((tt) => `${hora(tt.starts_at)}\u00a0–\u2060\u00a0${hora(tt.ends_at)}`).join(' · ');
  const turnos = rango(dia.turnos);
  /*
   * «MARCASTE» SOLO SI MARCÓ. Una jornada registrada desde el horario —las semanas de
   * antes del reloj— no la fichó nadie, y decirle «Marcaste 10:00 – 19:00» a quien nunca
   * tocó el reloj ese día sería contarle algo que no pasó.
   */
  const marcas = dia.jornadas.map((j) =>
    // Cumplido por un motivo especial (4-oct): su motivo, y el comentario si lo hay.
    esCumplidoEspecial(j)
      ? etiquetaDeCumplido(t, j, true)
      : j.source === 'import'
        ? t('portal.markFromSchedule')
        : j.ends_at === null
          ? t('portal.markOpen', { from: hora(j.starts_at) })
          : t('portal.markRange', { from: hora(j.starts_at), to: hora(j.ends_at) }),
  );
  const rotuloDelTurno =
    dia.turnos.length > 0
      ? turnos
      : dia.porConfirmar.length > 0
        ? rango(dia.porConfirmar)
        : dia.jornadas.length > 0
          ? t('portal.noShift')
          : t('portal.free');

  return (
    <Row
      gap={spacing.md}
      align="center"
      style={esHoy ? { ...estilos.fila, ...estilos.filaHoy } : estilos.fila}
      testID={`mi-horario-dia-${dia.dia}`}
    >
      <View style={estilos.fecha}>
        <AppText variant="label" tone={esHoy ? 'primary' : 'muted'}>
          {esHoy ? t('portal.todayShort') : formatWeekdayShort(dia.dia, language)}
        </AppText>
        <AppText variant="bodyStrong" tone={esHoy ? 'primary' : 'default'} tabular>
          {formatDateKeyShort(dia.dia, language)}
        </AppText>
      </View>
      <Stack gap={0} style={estilos.centro}>
        {/* El feriado ENCIMA del turno: es lo primero que alguien quiere saber de ese día. */}
        <EtiquetaDeFeriado dateKey={dia.dia} timezone={zona} />
        <AppText
          variant="bodyStrong"
          tabular
          tone={dia.turnos.length === 0 && dia.porConfirmar.length === 0 ? 'subtle' : 'default'}
        >
          {rotuloDelTurno}
        </AppText>
        {/*
          UN TURNO QUE SE ESTÁ CAMBIANDO (4-oct). Se dice qué es en vez de callarlo: antes el
          día pasaba a «Libre» mientras quien gestiona lo editaba sin volver a publicar.
        */}
        {dia.porConfirmar.length > 0 ? (
          <AppText variant="help" tone="primary" testID={`mi-horario-por-confirmar-${dia.dia}`}>
            {dia.turnos.length > 0
              ? t('portal.pendingChangeExtra', { range: rango(dia.porConfirmar) })
              : t('portal.pendingChangeBody')}
          </AppText>
        ) : null}
        {/*
          LA NOTA DE SU TURNO (3-oct): «Nota para el empleado» se escribe en Horario para
          ella, y solo se veía en el reloj de la tienda. La privada de quien gestiona, no.
        */}
        {[...dia.turnos, ...dia.porConfirmar]
          .filter((tt) => tt.employee_note !== null && tt.employee_note.trim() !== '')
          .map((tt) => (
            <Row
              key={tt.id}
              gap={spacing.xs}
              align="flex-start"
              testID={`mi-horario-nota-${dia.dia}`}
            >
              <Ionicons name="chatbubble-outline" size={13} color={colors.ink500} />
              <AppText variant="help" tone="muted" style={estilos.centro}>
                {tt.employee_note}
              </AppText>
            </Row>
          ))}
        {loQueDije.map((fila) => (
          <ChipDeDisponibilidad
            key={fila.id}
            fila={fila}
            primera
            testID={`mi-disponibilidad-del-dia-${dia.dia}`}
          />
        ))}
        {marcas.map((marca, i) => (
          <AppText key={i} variant="help" tone="muted" tabular>
            {marca}
          </AppText>
        ))}
        {/* Vino a un turno y no al otro del mismo día: la falta se dice aunque marcara. */}
        {dia.estado !== 'falta' && dia.estado !== 'faltaJustificada' && dia.faltas.length > 0 ? (
          <AppText
            variant="help"
            // Ámbar si está justificada: sigue siendo falta, pero ya no cuenta en contra.
            tone={faltasJustificadas ? 'warning' : 'danger'}
            testID={`mi-horario-falta-${dia.dia}`}
          >
            {t('portal.missedShift', {
              range: dia.faltas
                .map((tt) => `${hora(tt.starts_at)}\u00a0–\u2060\u00a0${hora(tt.ends_at)}`)
                .join(' · '),
            })}
          </AppText>
        ) : null}
        {/* Lo que dijo quien administra: «Justificada · Descanso médico: "trajo certificado"». */}
        {dia.justificaciones.map((dicho) => (
          <AppText
            key={dicho.id}
            variant="help"
            tone={dicho.kind === 'justified' ? 'warning' : 'danger'}
            testID={`mi-horario-motivo-${dia.dia}`}
          >
            {etiquetaDeFalta(t, { resolucion: dicho })}
            {dicho.note === null ? '' : `: «${dicho.note}»`}
          </AppText>
        ))}
        {dia.estado === 'aTiempo' && dia.minutosAntes !== null ? (
          <AppText variant="help" tone="success">
            {t('portal.early', { count: dia.minutosAntes })}
          </AppText>
        ) : null}
      </Stack>
      {insignia === undefined && dia.minutosNetos === 0 ? null : (
        <View style={estilos.derecha}>
          {insignia === undefined ? null : (
            <StatusBadge
              label={t(insignia.clave)}
              tone={insignia.tono}
              icon={insignia.icono}
              compact
            />
          )}
          {dia.minutosNetos > 0 ? (
            <AppText variant="label" tone="muted" tabular>
              {duracion(dia.minutosNetos, t)}
            </AppText>
          ) : null}
        </View>
      )}
    </Row>
  );
}

/** Idioma, el manual y salir. Sin sesión que cerrar, un celular prestado se queda dentro. */
function Pie() {
  const { t } = useTranslation();
  const salir = useSessionStore((s) => s.signOut);
  return (
    <Stack gap={spacing.sm}>
      <AppText variant="help" tone="subtle">
        {t('portal.footer')}
      </AppText>
      <Row justify="space-between" align="center" gap={spacing.sm} wrap>
        <Row gap={spacing.sm} wrap>
          <GhostButton
            label={t('portal.manual')}
            onPress={() => router.push('/manual')}
            fullWidth={false}
            testID="mi-horario-manual"
          />
          <GhostButton
            label={t('portal.signOut')}
            onPress={() => void salir()}
            fullWidth={false}
            testID="mi-horario-salir"
          />
        </Row>
        <LanguageSwitch />
      </Row>
    </Stack>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  lista: { paddingVertical: 0, paddingHorizontal: 0, overflow: 'hidden' as const },
  fila: { paddingVertical: spacing.md, paddingHorizontal: spacing.base, minHeight: 64 },
  /* Hoy se distingue con una franja y el color del texto: dos señales, no solo color. */
  filaHoy: {
    backgroundColor: colors.primary50,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary500,
  },
  fecha: { width: 64, flexShrink: 0 },
  centro: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  derecha: { alignItems: 'flex-end' as const, gap: spacing.xs, flexShrink: 0 },
  fichas: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  /* Dos por fila en el teléfono, cuatro caben en pantalla ancha: la base es media fila. */
  ficha: { flexBasis: '46%' as const, flexGrow: 1, minWidth: 140 },
  hoy: { gap: spacing.xs, borderWidth: 1, borderRadius: radii.card },
  hoy_working: { backgroundColor: colors.success50, borderColor: colors.success600 },
  hoy_onBreak: { backgroundColor: colors.warning50, borderColor: colors.warning600 },
  hoy_warning: { backgroundColor: colors.warning50, borderColor: colors.warning600 },
  hoy_info: { backgroundColor: colors.info50, borderColor: colors.info600 },
  hoy_offShift: { borderColor: colors.border },
  hoy_late: { backgroundColor: colors.danger50, borderColor: colors.danger600 },
}));
