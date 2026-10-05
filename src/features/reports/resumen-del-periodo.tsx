import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Medidor } from '@/components/charts/medidor';
import { AppText } from '@/components/ui/app-text';
import { Card, Row, Stack } from '@/components/ui/layout';
import { estilosDelTema } from '@/theme/estilos';
import { chart, radii, spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

import { notaDeEnCurso } from '@/features/timesheets/textos-de-en-curso';

import type { Programado } from './programado';

/**
 * LO PRIMERO DE REPORTES: lo trabajado contra lo programado, y quién está dentro ahora
 * (2-oct).
 *
 * Andree miró el mes de octubre el día 1 y vio «00:00» en todo: «veo que ahora que es
 * octubre no hay nada, no sé si es lo correcto… todas las vistas siempre deben ir de la
 * mano». Lo era a medias. Reportes suma una jornada cuando se marca la salida —igual que
 * Horas—, y ese día las tres personas que habían fichado seguían dentro. Pero Horas y Equipo
 * enseñan lo que va EN CURSO, y Reportes no, así que la misma mañana una pantalla decía
 * «3 trabajando, 5:20» y la otra «nada». Ahora esta lo dice también, con la misma cuenta
 * (`dentroPorEmpleado`), y al lado de lo que se programó, que es lo que hace que una cifra
 * signifique algo.
 *
 * EL NÚMERO GRANDE VA EN VIVO (5-oct): lo cerrado MÁS lo que va en curso. Andree vio
 * «00:00 trabajadas» con una persona dentro desde hacía una hora y, en la misma tarjeta,
 * «Va al 122 %»: el porcentaje contaba lo en curso y el número no. Ahora los dos cuentan lo
 * mismo, y debajo se dice cuánto sigue abierto (`notaDeEnCurso`), sumado a la vista y no en
 * silencio. Lo cerrado —`report-total`, el mismo total de Horas— queda en la leyenda.
 */
export function ResumenDelPeriodo({
  titulo,
  trabajado,
  enCurso,
  programado,
  incluyeHoy,
}: {
  titulo: string;
  /** Jornadas cerradas del periodo: lo mismo que el total de Horas. */
  trabajado: number;
  /** Quién está dentro ahora y cuánto lleva; solo si el periodo incluye hoy. */
  enCurso: { personas: number; minutos: number };
  programado: Programado;
  incluyeHoy: boolean;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const enCursoVisible = incluyeHoy ? enCurso.minutos : 0;
  const referencia = incluyeHoy ? programado.hastaAhora : programado.total;
  const hecho = trabajado + enCursoVisible;

  const veredicto =
    programado.total === 0
      ? t('reports.hero.noPlan')
      : referencia === 0
        ? t('reports.hero.notStarted')
        : incluyeHoy
          ? t('reports.hero.soFar', { percent: Math.round((hecho / referencia) * 100) })
          : t('reports.hero.done', { percent: Math.round((hecho / referencia) * 100) });

  const leyenda = [
    {
      clave: 'trabajado',
      estilo: estilos.muestraTrabajado,
      texto: t('reports.hero.worked', { hours: minutesToHHmm(trabajado) }),
      // Lo cerrado: el que los arneses comparan con «Horas netas» de Horas.
      testID: 'report-total',
    },
    ...(enCursoVisible > 0
      ? [
          {
            clave: 'en-curso',
            estilo: estilos.muestraEnCurso,
            texto: t('reports.hero.live', { hours: minutesToHHmm(enCursoVisible) }),
          },
        ]
      : []),
    {
      clave: 'programado',
      estilo: estilos.muestraProgramado,
      texto: t('reports.hero.planned', { hours: minutesToHHmm(programado.total) }),
    },
    ...(incluyeHoy && programado.hastaAhora > 0 && programado.hastaAhora < programado.total
      ? [
          {
            clave: 'hasta-ahora',
            estilo: estilos.muestraMarca,
            texto: t('reports.hero.plannedSoFar', { hours: minutesToHHmm(programado.hastaAhora) }),
          },
        ]
      : []),
  ];

  return (
    <Card testID="report-hero">
      <Row gap={spacing.md} align="center" justify="space-between" wrap>
        <AppText variant="bodyStrong" accessibilityRole="header" style={estilos.encoge}>
          {titulo}
        </AppText>
        {incluyeHoy && enCurso.personas > 0 ? (
          <View style={estilos.pildora} testID="report-live">
            <View style={estilos.punto} />
            <AppText variant="label" style={estilos.encoge}>
              {t('reports.hero.inside', {
                count: enCurso.personas,
                hours: minutesToHHmm(enCurso.minutos),
              })}
            </AppText>
          </View>
        ) : null}
      </Row>

      <Stack gap={spacing.xs}>
        <Row gap={spacing.sm} align="flex-end" wrap>
          <AppText variant="title" tabular testID="report-total-vivo">
            {minutesToHHmm(hecho)}
          </AppText>
          <AppText variant="body" tone="muted" style={estilos.encoge}>
            {programado.total > 0
              ? t('reports.hero.ofPlanned', { hours: minutesToHHmm(programado.total) })
              : t('reports.hero.workedOnly')}
          </AppText>
        </Row>
        {enCursoVisible > 0 ? (
          <Row gap={spacing.xs} align="center">
            <View style={[estilos.muestra, estilos.muestraEnCurso]} />
            <AppText variant="help" tone="muted" style={estilos.encoge} testID="report-total-nota">
              {notaDeEnCurso(t, { personas: enCurso.personas, minutos: enCursoVisible })}
            </AppText>
          </Row>
        ) : null}
      </Stack>

      <Medidor
        trabajado={trabajado}
        enCurso={enCursoVisible}
        programado={programado.total}
        hastaAhora={incluyeHoy ? programado.hastaAhora : null}
        alto={16}
        accessibilityLabel={[veredicto, ...leyenda.map((item) => item.texto)].join('. ')}
        testID="report-meter"
      />

      <Row gap={spacing.base} wrap>
        {leyenda.map((item) => (
          <Row key={item.clave} gap={spacing.xs} align="center">
            <View style={[estilos.muestra, item.estilo]} />
            <AppText variant="label" tone="muted" tabular testID={item.testID}>
              {item.texto}
            </AppText>
          </Row>
        ))}
      </Row>

      <Stack gap={spacing.xs}>
        <AppText variant="bodyStrong" testID="report-verdict">
          {veredicto}
        </AppText>
        <AppText variant="help" tone="subtle">
          {t('reports.hero.howItCounts')}
        </AppText>
      </Stack>
    </Card>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  encoge: { flexShrink: 1, minWidth: 0 },
  /*
   * «3 DENTRO AHORA» en el verde suave de quien trabaja, con el texto en tinta: es la misma
   * señal que las filas verdes de Horas y Equipo, y la palabra se lee a 4,5:1 o más.
   */
  pildora: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.success600,
    backgroundColor: colors.success50,
    maxWidth: '100%',
  },
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success600 },
  muestra: { width: 14, height: 10, borderRadius: 3 },
  muestraTrabajado: { backgroundColor: chart(colors).series1 },
  muestraEnCurso: { backgroundColor: colors.success600 },
  muestraProgramado: {
    backgroundColor: colors.hundido,
    borderWidth: 1,
    borderColor: colors.reglaFuerte,
  },
  muestraMarca: { width: 2, height: 14, borderRadius: 0, backgroundColor: colors.ink900 },
}));
