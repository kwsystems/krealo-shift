import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ChartCard } from '@/components/charts/chart-frame';
import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Row, Stack, useRespuestaAlPuntero } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import { formatDateKeyShort, formatWeekdayShort, type DateKey } from '@/features/schedules/week';
import { duracion } from '@/features/timesheets/duracion';
import { etiquetaDeCumplido } from '@/features/timesheets/textos-de-cumplido';
import { etiquetaDeFalta, tonoDeFalta } from '@/features/timesheets/textos-de-falta';
import type { SupportedLanguage } from '@/i18n';
import { departureReasonLabelKey } from '@/i18n/break-reason-labels';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, sizes, spacing, type StatusTone } from '@/theme/tokens';
import { formatClockTime, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';

import { resumirIncidencias, type Incidencia, type ResumenDeIncidencias } from './incidencias';

/**
 * FALTAS, TARDANZAS Y LO DEMÁS DEL PERIODO, Y CÓMO QUEDÓ CADA COSA (4-oct).
 *
 * Andree: «tiene que haber un resumen en Reportes de todo esto, de las faltas, llegadas
 * tarde y todo eso». Horas enseña la semana y lo que está por arreglar; esto enseña el
 * periodo entero CON lo ya arreglado, que es lo que se mira a fin de mes: cuántas faltas tuvo
 * cada uno y cuántas justificó, cuánto llegó tarde, cuánto se fue antes, cuánto debe.
 *
 * TRES ALTURAS, de lo general a lo concreto: las cifras del periodo, una fila por persona
 * —tocarla filtra el tablero, como «Asistencia por persona»— y, si se pide, día por día con
 * el estado de cada cosa. Los textos de cada caso son los de Horas, Horario y Equipo
 * (`textos-de-falta.ts`, `textos-de-cumplido.ts`): una falta se llama igual en todas partes.
 */

/** Lo que pide la tabla para que sus seis columnas no se aprieten. */
const ANCHO_DE_LA_TABLA = 760;

const TONO_DE_LO_QUE_DEBE: Record<'pending' | 'compensated' | 'forgiven', StatusTone> = {
  pending: 'warning',
  compensated: 'working',
  forgiven: 'info',
};

const ROTULO_DE_LO_QUE_DEBE = {
  pending: 'team.owedPending',
  compensated: 'team.owedCompensated',
  forgiven: 'team.owedForgiven',
} as const;

export function IncidenciasDelPeriodo({
  incidencias,
  nombre,
  timezone,
  timeFormat,
  language,
  elegida,
  onElegir,
}: {
  /** Ya filtradas por los días y por la persona elegida, como el resto del tablero. */
  incidencias: readonly Incidencia[];
  nombre: (employeeId: string) => string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  elegida: string | null;
  onElegir: (employeeId: string) => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const [ancho, setAncho] = useState(0);
  const [diaPorDia, setDiaPorDia] = useState(false);
  const { total, porPersona } = resumirIncidencias(incidencias);
  const tabla = ancho >= ANCHO_DE_LA_TABLA;
  const textos = useTextosDeResumen();

  const cifras: {
    clave: string;
    rotulo: string;
    valor: string;
    detalle: string | null;
    tono?: 'danger' | 'warning';
  }[] = [
    {
      clave: 'absences',
      rotulo: t('reports.incidents.absences'),
      valor: String(total.faltas),
      detalle: textos.faltas(total),
      tono: total.faltasEnContra > 0 ? 'danger' : total.faltas > 0 ? 'warning' : undefined,
    },
    {
      clave: 'late',
      rotulo: t('reports.incidents.late'),
      valor: t('reports.incidents.times', { count: total.tardanzas }),
      detalle:
        total.minutosTarde > 0
          ? t('reports.incidents.inTotal', { time: duracion(t, total.minutosTarde) })
          : null,
    },
    {
      clave: 'early',
      rotulo: t('reports.incidents.early'),
      valor: t('reports.incidents.times', { count: total.salidasAntes }),
      detalle:
        total.minutosAntes > 0
          ? t('reports.incidents.inTotal', { time: duracion(t, total.minutosAntes) })
          : null,
    },
    {
      clave: 'owed',
      rotulo: t('reports.incidents.owed'),
      valor: minutesToHHmm(total.debePendiente),
      detalle: textos.debe(total),
      tono: total.debePendiente > 0 ? 'warning' : undefined,
    },
    {
      clave: 'credited',
      rotulo: t('reports.incidents.credited'),
      valor: String(total.cumplidos),
      detalle:
        total.minutosCumplidos > 0
          ? t('reports.incidents.counted', { time: duracion(t, total.minutosCumplidos) })
          : null,
    },
  ];

  const porDia = new Map<DateKey, Incidencia[]>();
  for (const incidencia of incidencias) {
    porDia.set(incidencia.dia, [...(porDia.get(incidencia.dia) ?? []), incidencia]);
  }
  const hora = (iso: string) => formatClockTime(iso, timezone, timeFormat, language);

  return (
    <ChartCard
      title={t('reports.incidents.title')}
      subtitle={t('reports.incidents.hint')}
      testID="report-incidents"
    >
      <View
        onLayout={(evento: LayoutChangeEvent) => setAncho(evento.nativeEvent.layout.width)}
        style={estilos.medida}
      />
      <Row gap={spacing.lg} wrap>
        {cifras.map((cifra) => (
          <Stack
            key={cifra.clave}
            gap={0}
            style={estilos.cifra}
            testID={`report-incidents-${cifra.clave}`}
          >
            <AppText variant="label" tone="subtle">
              {cifra.rotulo}
            </AppText>
            <AppText variant="section" tone={cifra.tono ?? 'default'} tabular>
              {cifra.valor}
            </AppText>
            {cifra.detalle === null ? null : (
              <AppText variant="label" tone="muted">
                {cifra.detalle}
              </AppText>
            )}
          </Stack>
        ))}
      </Row>

      {incidencias.length === 0 ? (
        <AppText variant="help" tone="subtle" testID="report-incidents-empty">
          {t('reports.incidents.empty')}
        </AppText>
      ) : (
        <>
          {tabla ? (
            <View>
              <Row gap={spacing.md} style={estilos.cabecera}>
                <AppText variant="label" tone="subtle" style={estilos.columnaPersona}>
                  {t('reports.attendance.person')}
                </AppText>
                {[
                  t('reports.incidents.absences'),
                  t('reports.incidents.late'),
                  t('reports.incidents.early'),
                  t('reports.incidents.owed'),
                  t('reports.incidents.credited'),
                ].map((rotulo) => (
                  <AppText key={rotulo} variant="label" tone="subtle" style={estilos.columnaCifra}>
                    {rotulo}
                  </AppText>
                ))}
              </Row>
              {porPersona.map((fila) => (
                <FilaDePersona
                  key={fila.employeeId}
                  fila={fila}
                  nombre={nombre(fila.employeeId)}
                  ancha
                  elegida={elegida === fila.employeeId}
                  onPress={() => onElegir(fila.employeeId)}
                />
              ))}
            </View>
          ) : (
            <Stack gap={spacing.sm}>
              {porPersona.map((fila) => (
                <FilaDePersona
                  key={fila.employeeId}
                  fila={fila}
                  nombre={nombre(fila.employeeId)}
                  ancha={false}
                  elegida={elegida === fila.employeeId}
                  onPress={() => onElegir(fila.employeeId)}
                />
              ))}
            </Stack>
          )}

          <GhostButton
            label={
              diaPorDia
                ? t('reports.incidents.hideDays')
                : t('reports.incidents.showDays', { count: incidencias.length })
            }
            onPress={() => setDiaPorDia((abierto) => !abierto)}
            testID="report-incidents-toggle"
          />

          {diaPorDia ? (
            <Stack gap={spacing.md} testID="report-incidents-days">
              {[...porDia.entries()].map(([dia, delDia]) => (
                <Stack key={dia} gap={spacing.xs}>
                  <AppText variant="label" tone="subtle">
                    {`${formatWeekdayShort(dia, language)} ${formatDateKeyShort(dia, language)}`}
                  </AppText>
                  {delDia.map((incidencia) => {
                    const { texto, sello } = describir(t, incidencia, hora);
                    return (
                      <Row
                        key={incidencia.id}
                        gap={spacing.sm}
                        align="center"
                        wrap
                        style={estilos.lineaDelDia}
                        testID={`report-incident-${incidencia.tipo}-${incidencia.employeeId}-${dia}`}
                      >
                        <AppText variant="bodyStrong">{nombre(incidencia.employeeId)}</AppText>
                        <AppText variant="body" style={estilos.encoge}>
                          {texto}
                        </AppText>
                        {sello === null ? null : (
                          <StatusBadge label={sello.texto} tone={sello.tono} compact />
                        )}
                      </Row>
                    );
                  })}
                </Stack>
              ))}
            </Stack>
          ) : null}
        </>
      )}
    </ChartCard>
  );
}

function useTextosDeResumen() {
  const { t } = useTranslation();
  return {
    faltas: (fila: ResumenDeIncidencias): string | null =>
      fila.faltas === 0
        ? null
        : [
            fila.faltasEnContra > 0
              ? t('reports.incidents.against', { count: fila.faltasEnContra })
              : null,
            fila.faltasJustificadas > 0
              ? t('absence.justifiedCount', { count: fila.faltasJustificadas })
              : null,
          ]
            .filter((parte): parte is string => parte !== null)
            .join(' · '),
    debe: (fila: ResumenDeIncidencias): string | null => {
      const partes = [
        fila.debeCompensado > 0
          ? t('reports.incidents.compensated', { time: minutesToHHmm(fila.debeCompensado) })
          : null,
        fila.debePerdonado > 0
          ? t('reports.incidents.forgiven', { time: minutesToHHmm(fila.debePerdonado) })
          : null,
      ].filter((parte): parte is string => parte !== null);
      return partes.length === 0 ? null : partes.join(' · ');
    },
  };
}

function FilaDePersona({
  fila,
  nombre,
  ancha,
  elegida,
  onPress,
}: {
  fila: ResumenDeIncidencias;
  nombre: string;
  ancha: boolean;
  elegida: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const respuesta = useRespuestaAlPuntero();
  const textos = useTextosDeResumen();
  const vecesYTiempo = (veces: number, minutos: number) =>
    veces === 0 ? '—' : minutos > 0 ? `${veces} · ${duracion(t, minutos)}` : String(veces);

  const celdas: {
    rotulo: string;
    valor: string;
    detalle: string | null;
    tono?: 'danger' | 'warning' | 'muted';
  }[] = [
    {
      rotulo: t('reports.incidents.absences'),
      valor: fila.faltas === 0 ? '—' : String(fila.faltas),
      detalle: textos.faltas(fila),
      tono: fila.faltasEnContra > 0 ? 'danger' : fila.faltas > 0 ? 'warning' : 'muted',
    },
    {
      rotulo: t('reports.incidents.late'),
      valor: vecesYTiempo(fila.tardanzas, fila.minutosTarde),
      detalle: null,
      tono: fila.tardanzas === 0 ? 'muted' : undefined,
    },
    {
      rotulo: t('reports.incidents.early'),
      valor: vecesYTiempo(fila.salidasAntes, fila.minutosAntes),
      detalle: null,
      tono: fila.salidasAntes === 0 ? 'muted' : undefined,
    },
    {
      rotulo: t('reports.incidents.owed'),
      valor:
        fila.debePendiente + fila.debeCompensado + fila.debePerdonado === 0
          ? '—'
          : minutesToHHmm(fila.debePendiente),
      detalle: textos.debe(fila),
      tono: fila.debePendiente > 0 ? 'warning' : 'muted',
    },
    {
      rotulo: t('reports.incidents.credited'),
      valor: fila.cumplidos === 0 ? '—' : String(fila.cumplidos),
      detalle: null,
      tono: fila.cumplidos === 0 ? 'muted' : undefined,
    },
  ];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: elegida }}
      accessibilityLabel={[
        nombre,
        ...celdas.map((celda) => `${celda.rotulo}: ${celda.valor}`),
      ].join('. ')}
      testID={`report-incidents-row-${fila.employeeId}`}
      {...respuesta.props}
      style={({ pressed }) => [
        ancha ? estilos.fila : estilos.ficha,
        elegida ? estilos.filaElegida : null,
        ...respuesta.estilo(pressed),
      ]}
    >
      {ancha ? (
        <Row gap={spacing.md} align="center">
          <AppText variant="bodyStrong" numberOfLines={1} style={estilos.columnaPersona}>
            {nombre}
          </AppText>
          {celdas.map((celda) => (
            <View key={celda.rotulo} style={[estilos.columnaCifra, estilos.derecha]}>
              <AppText variant="body" tone={celda.tono ?? 'default'} tabular>
                {celda.valor}
              </AppText>
              {celda.detalle === null ? null : (
                <AppText variant="label" tone="muted">
                  {celda.detalle}
                </AppText>
              )}
            </View>
          ))}
        </Row>
      ) : (
        <>
          <AppText variant="bodyStrong">{nombre}</AppText>
          <Row gap={spacing.base} wrap>
            {celdas.map((celda) => (
              <Stack key={celda.rotulo} gap={0}>
                <AppText variant="label" tone="subtle">
                  {celda.rotulo}
                </AppText>
                <AppText variant="body" tone={celda.tono ?? 'default'} tabular>
                  {celda.detalle === null ? celda.valor : `${celda.valor} · ${celda.detalle}`}
                </AppText>
              </Stack>
            ))}
          </Row>
        </>
      )}
    </Pressable>
  );
}

/** Lo que pasó, en una frase, y cómo quedó, en un sello. */
function describir(
  t: ReturnType<typeof useTranslation>['t'],
  incidencia: Incidencia,
  hora: (iso: string) => string,
): { texto: string; sello: { texto: string; tono: StatusTone } | null } {
  switch (incidencia.tipo) {
    case 'falta':
      return {
        texto: t('reports.incidents.absenceLine', {
          start: hora(incidencia.falta.turno.starts_at),
          end: hora(incidencia.falta.turno.ends_at),
        }),
        sello: { texto: etiquetaDeFalta(t, incidencia.falta), tono: tonoDeFalta(incidencia.falta) },
      };
    case 'tarde':
      return {
        texto:
          incidencia.minutos === null || incidencia.inicioDelTurno === null
            ? t('reports.incidents.lateLineNoShift', { in: hora(incidencia.entrada) })
            : t('reports.incidents.lateLine', {
                time: duracion(t, incidencia.minutos),
                in: hora(incidencia.entrada),
                start: hora(incidencia.inicioDelTurno),
              }),
        sello: null,
      };
    case 'salioAntes': {
      const base =
        incidencia.minutos === null || incidencia.finDelTurno === null
          ? t('reports.incidents.earlyLineNoShift', { out: hora(incidencia.salida) })
          : t('reports.incidents.earlyLine', {
              time: duracion(t, incidencia.minutos),
              out: hora(incidencia.salida),
              end: hora(incidencia.finDelTurno),
            });
      return {
        texto:
          incidencia.motivo === null
            ? base
            : `${base} · ${t(departureReasonLabelKey(incidencia.motivo))}`,
        sello: null,
      };
    }
    case 'cumplido':
      return {
        texto: t('reports.incidents.creditedLine', {
          time: duracion(t, incidencia.minutos),
        }),
        sello: {
          texto: etiquetaDeCumplido(
            t,
            { credit_reason: incidencia.motivo, credit_note: incidencia.nota },
            true,
          ),
          tono: 'working',
        },
      };
    case 'debe':
      return {
        texto:
          incidencia.nota === null || incidencia.nota.trim() === ''
            ? t('reports.incidents.owesLine', { time: duracion(t, incidencia.minutos) })
            : `${t('reports.incidents.owesLine', { time: duracion(t, incidencia.minutos) })}: «${incidencia.nota}»`,
        sello: {
          texto: t(ROTULO_DE_LO_QUE_DEBE[incidencia.estado]),
          tono: TONO_DE_LO_QUE_DEBE[incidencia.estado],
        },
      };
  }
}

const useEstilos = estilosDelTema((colors) => ({
  medida: { height: 0, width: '100%' },
  encoge: { flexShrink: 1, minWidth: 0 },
  derecha: { alignItems: 'flex-end' },
  cifra: { minWidth: 120 },
  cabecera: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.reglaFuerte,
  },
  columnaPersona: { flex: 2, minWidth: 0 },
  columnaCifra: { flex: 1, minWidth: 0, textAlign: 'right' },
  fila: {
    minHeight: sizes.touchTargetPreferred,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.regla,
    justifyContent: 'center',
  },
  filaElegida: { backgroundColor: colors.primary50 },
  ficha: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
    borderColor: colors.regla,
  },
  lineaDelDia: {
    paddingVertical: spacing.xs,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.regla,
  },
}));
