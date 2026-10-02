import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ChartCard } from '@/components/charts/chart-frame';
import { Medidor } from '@/components/charts/medidor';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack, useRespuestaAlPuntero } from '@/components/ui/layout';

import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * LA ASISTENCIA DE CADA PERSONA, en una tabla (2-oct).
 *
 * Es el reporte que Homebase llama «attendance»: por persona, lo que se le programó, lo
 * que trabajó, la diferencia, cuántas veces llegó tarde y cuántas faltó. Hasta hoy esas
 * cinco cosas estaban en cinco gráficos distintos, cada uno con su orden, y para saber cómo
 * le fue a UNA persona había que buscarla cinco veces.
 *
 * LAS CIFRAS SON LAS DE LAS OTRAS VISTAS, no unas nuevas: lo trabajado es el ranking —el
 * total de Horas—, lo en curso es `dentroPorEmpleado` —lo de Horas y Equipo—, las tardanzas
 * son la marca del servidor y las faltas, `timesheets/faltas.ts`.
 *
 * LA DIFERENCIA ES CONTRA LO PROGRAMADO HASTA AHORA, no contra el periodo entero: el día 3
 * del mes nadie «debe» las horas del día 25. En rojo solo cuando faltan quince minutos o
 * más, el mismo umbral que «Faltan horas» en Horas: cinco minutos no son algo que mirar.
 *
 * ANCHA, UNA TABLA; ESTRECHA, UNA FICHA POR PERSONA. La decisión se toma midiendo lo que
 * mide la tarjeta, no la ventana: es lo que ya aprendió la tabla de Disponibilidad.
 */

export type FilaDeAsistencia = {
  employeeId: string;
  nombre: string;
  trabajado: number;
  enCurso: number;
  programado: number;
  programadoHastaAhora: number;
  medidos: number;
  tardanzas: number;
  faltas: number;
  /** De esas, las justificadas (2-oct): no cuentan en contra. */
  faltasJustificadas: number;
  extra: number;
};

const UMBRAL_DE_DIFERENCIA = 15;
/** Lo que pide la tabla para que sus siete columnas no se aprieten. */
const ANCHO_DE_LA_TABLA = 880;

export function AsistenciaPorPersona({
  filas,
  incluyeHoy,
  elegida,
  onElegir,
}: {
  filas: readonly FilaDeAsistencia[];
  incluyeHoy: boolean;
  elegida: string | null;
  onElegir: (employeeId: string) => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const [ancho, setAncho] = useState(0);
  const tabla = ancho >= ANCHO_DE_LA_TABLA;

  const diferenciaDe = (fila: FilaDeAsistencia) =>
    fila.trabajado + fila.enCurso - (incluyeHoy ? fila.programadoHastaAhora : fila.programado);

  return (
    <ChartCard
      title={t('reports.attendance.title')}
      subtitle={t('reports.attendance.hint')}
      testID="report-attendance"
    >
      <View
        onLayout={(evento: LayoutChangeEvent) => setAncho(evento.nativeEvent.layout.width)}
        style={estilos.medida}
      />
      {filas.length === 0 ? (
        <AppText variant="help" tone="subtle">
          {t('reports.attendance.empty')}
        </AppText>
      ) : tabla ? (
        <View>
          <Row gap={spacing.md} style={estilos.cabecera}>
            <AppText variant="label" tone="subtle" style={estilos.columnaPersona}>
              {t('reports.attendance.person')}
            </AppText>
            {[
              t('reports.attendance.worked'),
              t('reports.attendance.planned'),
              t('reports.attendance.difference'),
              t('reports.attendance.onTime'),
              t('reports.attendance.absences'),
              t('reports.attendance.overtime'),
            ].map((rotulo) => (
              <AppText key={rotulo} variant="label" tone="subtle" style={estilos.columnaCifra}>
                {rotulo}
              </AppText>
            ))}
          </Row>
          {filas.map((fila) => (
            <FilaAncha
              key={fila.employeeId}
              fila={fila}
              diferencia={diferenciaDe(fila)}
              incluyeHoy={incluyeHoy}
              elegida={elegida === fila.employeeId}
              onPress={() => onElegir(fila.employeeId)}
            />
          ))}
        </View>
      ) : (
        <Stack gap={spacing.sm}>
          {filas.map((fila) => (
            <FichaEstrecha
              key={fila.employeeId}
              fila={fila}
              diferencia={diferenciaDe(fila)}
              incluyeHoy={incluyeHoy}
              elegida={elegida === fila.employeeId}
              onPress={() => onElegir(fila.employeeId)}
            />
          ))}
        </Stack>
      )}
    </ChartCard>
  );
}

function useTextos(fila: FilaDeAsistencia, diferencia: number, incluyeHoy: boolean) {
  const { t } = useTranslation();
  const signo = diferencia > 0 ? '+' : diferencia < 0 ? '−' : '';
  return {
    trabajado: minutesToHHmm(fila.trabajado),
    enCurso:
      fila.enCurso > 0
        ? t('reports.attendance.live', { hours: minutesToHHmm(fila.enCurso) })
        : null,
    programado: fila.programado > 0 ? minutesToHHmm(fila.programado) : '—',
    diferencia: fila.programado === 0 ? '—' : `${signo}${minutesToHHmm(Math.abs(diferencia))}`,
    faltanMuchas: fila.programado > 0 && diferencia <= -UMBRAL_DE_DIFERENCIA,
    aTiempo:
      fila.medidos === 0
        ? '—'
        : t('reports.attendance.onTimeOf', {
            onTime: fila.medidos - fila.tardanzas,
            count: fila.medidos,
          }),
    faltas: String(fila.faltas),
    faltasJustificadas:
      fila.faltasJustificadas > 0
        ? t('absence.justifiedCount', { count: fila.faltasJustificadas })
        : null,
    faltasEnContra: fila.faltas - fila.faltasJustificadas > 0,
    extra: fila.extra > 0 ? minutesToHHmm(fila.extra) : '—',
    medidor: t('reports.attendance.meterLabel', {
      name: fila.nombre,
      worked: minutesToHHmm(fila.trabajado + fila.enCurso),
      planned: minutesToHHmm(incluyeHoy ? fila.programadoHastaAhora : fila.programado),
    }),
  };
}

function FilaAncha({
  fila,
  diferencia,
  incluyeHoy,
  elegida,
  onPress,
}: {
  fila: FilaDeAsistencia;
  diferencia: number;
  incluyeHoy: boolean;
  elegida: boolean;
  onPress: () => void;
}) {
  const estilos = useEstilos();
  const textos = useTextos(fila, diferencia, incluyeHoy);
  const respuesta = useRespuestaAlPuntero();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: elegida }}
      accessibilityLabel={[
        textos.medidor,
        textos.diferencia,
        textos.aTiempo,
        `${textos.faltas}`,
      ].join('. ')}
      testID={`report-attendance-row-${fila.employeeId}`}
      {...respuesta.props}
      style={({ pressed }) => [
        estilos.fila,
        elegida ? estilos.filaElegida : null,
        ...respuesta.estilo(pressed),
      ]}
    >
      <Row gap={spacing.md} align="center">
        <Stack gap={spacing.xs} style={estilos.columnaPersona}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {fila.nombre}
          </AppText>
          <Medidor
            trabajado={fila.trabajado}
            enCurso={fila.enCurso}
            programado={fila.programado}
            hastaAhora={incluyeHoy ? fila.programadoHastaAhora : null}
            alto={8}
            accessibilityLabel={textos.medidor}
          />
        </Stack>
        <Stack gap={0} style={estilos.columnaCifra}>
          <AppText variant="bodyStrong" tabular>
            {textos.trabajado}
          </AppText>
          {textos.enCurso === null ? null : (
            <AppText variant="label" tone="success" tabular>
              {textos.enCurso}
            </AppText>
          )}
        </Stack>
        <AppText variant="body" tone="muted" tabular style={estilos.columnaCifra}>
          {textos.programado}
        </AppText>
        <AppText
          variant="body"
          tone={textos.faltanMuchas ? 'danger' : 'default'}
          tabular
          style={estilos.columnaCifra}
          testID={`report-attendance-row-${fila.employeeId}-diferencia`}
        >
          {textos.diferencia}
        </AppText>
        <AppText variant="body" tabular style={estilos.columnaCifra}>
          {textos.aTiempo}
        </AppText>
        <View
          style={[estilos.columnaCifra, estilos.derecha]}
          testID={`report-attendance-row-${fila.employeeId}-faltas`}
        >
          <AppText
            variant="body"
            tone={textos.faltasEnContra ? 'danger' : fila.faltas > 0 ? 'warning' : 'muted'}
            tabular
          >
            {textos.faltas}
          </AppText>
          {textos.faltasJustificadas === null ? null : (
            <AppText variant="label" tone="warning">
              {textos.faltasJustificadas}
            </AppText>
          )}
        </View>
        <AppText variant="body" tone="muted" tabular style={estilos.columnaCifra}>
          {textos.extra}
        </AppText>
      </Row>
    </Pressable>
  );
}

function FichaEstrecha({
  fila,
  diferencia,
  incluyeHoy,
  elegida,
  onPress,
}: {
  fila: FilaDeAsistencia;
  diferencia: number;
  incluyeHoy: boolean;
  elegida: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const textos = useTextos(fila, diferencia, incluyeHoy);
  const respuesta = useRespuestaAlPuntero();
  const datos: { rotulo: string; valor: string; peligro?: boolean }[] = [
    { rotulo: t('reports.attendance.planned'), valor: textos.programado },
    {
      rotulo: t('reports.attendance.difference'),
      valor: textos.diferencia,
      peligro: textos.faltanMuchas,
    },
    { rotulo: t('reports.attendance.onTime'), valor: textos.aTiempo },
    {
      rotulo: t('reports.attendance.absences'),
      valor:
        textos.faltasJustificadas === null
          ? textos.faltas
          : `${textos.faltas} · ${textos.faltasJustificadas}`,
      peligro: textos.faltasEnContra,
    },
  ];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: elegida }}
      accessibilityLabel={[textos.medidor, textos.diferencia, textos.aTiempo].join('. ')}
      testID={`report-attendance-row-${fila.employeeId}`}
      {...respuesta.props}
      style={({ pressed }) => [
        estilos.ficha,
        elegida ? estilos.filaElegida : null,
        ...respuesta.estilo(pressed),
      ]}
    >
      <Row gap={spacing.sm} align="center" justify="space-between">
        <AppText variant="bodyStrong" style={estilos.encoge}>
          {fila.nombre}
        </AppText>
        <Stack gap={0} style={estilos.derecha}>
          <AppText variant="bodyStrong" tabular>
            {textos.trabajado}
          </AppText>
          {textos.enCurso === null ? null : (
            <AppText variant="label" tone="success" tabular>
              {textos.enCurso}
            </AppText>
          )}
        </Stack>
      </Row>
      <Medidor
        trabajado={fila.trabajado}
        enCurso={fila.enCurso}
        programado={fila.programado}
        hastaAhora={incluyeHoy ? fila.programadoHastaAhora : null}
        alto={8}
        accessibilityLabel={textos.medidor}
      />
      <Row gap={spacing.base} wrap>
        {datos.map((dato) => (
          <Stack key={dato.rotulo} gap={0}>
            <AppText variant="label" tone="subtle">
              {dato.rotulo}
            </AppText>
            <AppText variant="body" tone={dato.peligro === true ? 'danger' : 'default'} tabular>
              {dato.valor}
            </AppText>
          </Stack>
        ))}
      </Row>
    </Pressable>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  medida: { height: 0, width: '100%' },
  encoge: { flexShrink: 1, minWidth: 0 },
  derecha: { alignItems: 'flex-end' },
  cabecera: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.reglaFuerte,
  },
  columnaPersona: { flex: 2.4, minWidth: 0 },
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
}));
