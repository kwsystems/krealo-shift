import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, SeparadorDeRegistro, Stack } from '@/components/ui/layout';
import type { SueldoEstimado } from '@/domain/sueldo-estimado';
import { duracion } from '@/features/timesheets/duracion';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';

import type { SueldoDelMes } from './hooks';

/** Soles como se escriben en Perú: «S/ 1,500.00». */
export function soles(monto: number): string {
  const texto = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(monto));
  return `S/ ${texto}`;
}

/** «octubre»: el nombre suelto del mes en es-PE sale con mayúscula, y en una frase no la lleva. */
const NOMBRE_DEL_MES = (desde: string, language: SupportedLanguage) => {
  const nombre = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-PE', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${desde}T12:00:00Z`));
  return language === 'en' ? nombre : nombre.toLocaleLowerCase('es-PE');
};

type Linea = {
  clave: string;
  etiqueta: string;
  detalle?: string | null;
  monto: number;
  signo: '+' | '−' | '';
  tono?: 'danger' | 'success' | 'muted';
};

/**
 * EL SUELDO APROXIMADO DEL MES, con su desglose (13-oct). La misma tarjeta en el celular de
 * la persona («Tu sueldo…») y en su ficha de Equipo: la cuenta es `sueldo-estimado.ts`, aquí
 * solo se dice. Cada línea dice de dónde sale —«2 faltas sin justificar»—, y abajo, siempre,
 * que es un aproximado y que lo que vale es la boleta.
 */
export function TarjetaDelSueldo({
  sueldo,
  propia,
  language,
}: {
  sueldo: SueldoDelMes;
  /** En su celular: «Tu sueldo». En Equipo: «Sueldo». */
  propia: boolean;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();

  if (sueldo.estado === 'sinSueldo' || sueldo.estado === 'cargando') return null;
  if (sueldo.estado === 'error') {
    return (
      <Card style={estilos.caja} testID="sueldo-error">
        <Stack gap={spacing.sm}>
          <AppText variant="help" tone="danger">
            {t('pay.error')}
          </AppText>
          <SecondaryButton
            label={t('common.retry')}
            onPress={sueldo.reintentar}
            fullWidth={false}
            testID="sueldo-reintentar"
          />
        </Stack>
      </Card>
    );
  }

  const { cuenta, mes } = sueldo;
  const lineas = lineasDe(t, cuenta);
  const total = cuenta.neto ?? cuenta.bruto;

  return (
    <Card style={estilos.caja} testID="sueldo-del-mes">
      <Stack gap={spacing.sm}>
        <Row justify="space-between" align="flex-start" gap={spacing.md} wrap>
          <Stack gap={0} style={estilos.crece}>
            <AppText variant="section" accessibilityRole="header">
              {t(propia ? 'pay.titleOwn' : 'pay.title', {
                month: NOMBRE_DEL_MES(mes.desde, language),
              })}
            </AppText>
            <AppText variant="label" tone="subtle">
              {cuenta.neto === null ? t('pay.grossLabel') : t('pay.netLabel')}
            </AppText>
          </Stack>
          <AppText variant="title" tabular testID="sueldo-total">
            {soles(total)}
          </AppText>
        </Row>

        <Stack gap={0}>
          {lineas.map((linea, i) => (
            <View key={linea.clave} testID={`sueldo-linea-${linea.clave}`}>
              {i > 0 ? <SeparadorDeRegistro /> : null}
              <Row justify="space-between" align="center" gap={spacing.md} style={estilos.fila}>
                <Stack gap={0} style={estilos.crece}>
                  <AppText variant={linea.signo === '' ? 'bodyStrong' : 'body'}>
                    {linea.etiqueta}
                  </AppText>
                  {linea.detalle ? (
                    <AppText variant="label" tone="subtle">
                      {linea.detalle}
                    </AppText>
                  ) : null}
                </Stack>
                <AppText
                  variant={linea.signo === '' ? 'bodyStrong' : 'body'}
                  tone={linea.tono ?? 'default'}
                  tabular
                >
                  {`${linea.signo === '' ? '' : `${linea.signo} `}${soles(linea.monto)}`}
                </AppText>
              </Row>
            </View>
          ))}
        </Stack>

        {cuenta.faltasJustificadas > 0 ? (
          <AppText variant="help" tone="muted" testID="sueldo-justificadas">
            {t('pay.justifiedNote', { count: cuenta.faltasJustificadas })}
          </AppText>
        ) : null}
        {cuenta.feriados.dias > 0 ? (
          <AppText variant="help" tone="muted">
            {t('pay.holidayNote')}
          </AppText>
        ) : null}
        {cuenta.menorQueLaRmv ? (
          <AppText variant="help" tone="danger" testID="sueldo-menor-rmv">
            {t('pay.belowMinimum', { rmv: soles(cuenta.rmv.valor) })}
          </AppText>
        ) : null}
        <AppText variant="help" tone="subtle" testID="sueldo-aviso">
          {t(propia ? 'pay.disclaimerOwn' : 'pay.disclaimer', {
            rmv: soles(cuenta.rmv.valor),
            norma: cuenta.rmv.norma,
          })}
        </AppText>
      </Stack>
    </Card>
  );
}

function lineasDe(t: ReturnType<typeof useTranslation>['t'], cuenta: SueldoEstimado): Linea[] {
  const lineas: Linea[] = [
    {
      clave: 'base',
      etiqueta: t('pay.base'),
      detalle: cuenta.diasPagados < 30 ? t('pay.baseDays', { days: cuenta.diasPagados }) : null,
      monto: cuenta.base,
      signo: '+',
    },
  ];
  if (cuenta.asignacionFamiliar > 0) {
    lineas.push({
      clave: 'asignacion',
      etiqueta: t('pay.familyAllowance'),
      monto: cuenta.asignacionFamiliar,
      signo: '+',
    });
  }
  if (cuenta.horasExtra.monto > 0) {
    lineas.push({
      clave: 'extra',
      etiqueta: t('pay.overtime'),
      detalle: duracion(t, cuenta.horasExtra.minutos),
      monto: cuenta.horasExtra.monto,
      signo: '+',
      tono: 'success',
    });
  }
  if (cuenta.feriados.monto > 0) {
    lineas.push({
      clave: 'feriados',
      etiqueta: t('pay.holidays', { count: cuenta.feriados.dias }),
      monto: cuenta.feriados.monto,
      signo: '+',
      tono: 'success',
    });
  }
  if (cuenta.faltas.dias > 0) {
    lineas.push({
      clave: 'faltas',
      etiqueta: t('pay.absences', { count: cuenta.faltas.dias }),
      detalle: t('pay.absencesDetail'),
      monto: cuenta.faltas.monto,
      signo: '−',
      tono: 'danger',
    });
  }
  if (cuenta.faltasSinRevisar.dias > 0) {
    lineas.push({
      clave: 'sin-revisar',
      etiqueta: t('pay.absencesPending', { count: cuenta.faltasSinRevisar.dias }),
      detalle: t('pay.absencesPendingDetail'),
      monto: cuenta.faltasSinRevisar.monto,
      signo: '−',
      tono: 'danger',
    });
  }
  if (cuenta.horasQueDebe.monto > 0) {
    lineas.push({
      clave: 'debe',
      etiqueta: t('pay.owed'),
      detalle: `${duracion(t, cuenta.horasQueDebe.minutos)} · ${t('pay.owedDetail')}`,
      monto: cuenta.horasQueDebe.monto,
      signo: '−',
      tono: 'danger',
    });
  }
  lineas.push({ clave: 'bruto', etiqueta: t('pay.gross'), monto: cuenta.bruto, signo: '' });
  if (cuenta.pension !== null && cuenta.neto !== null) {
    lineas.push({
      clave: 'pension',
      etiqueta: t(cuenta.pension.sistema === 'onp' ? 'pay.onp' : 'pay.afp'),
      monto: cuenta.pension.monto,
      signo: '−',
      tono: 'muted',
    });
    lineas.push({ clave: 'neto', etiqueta: t('pay.net'), monto: cuenta.neto, signo: '' });
  }
  return lineas;
}

const useEstilos = estilosDelTema(() => ({
  caja: { gap: spacing.sm },
  fila: { paddingVertical: spacing.xs },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
}));
