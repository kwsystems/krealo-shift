import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { InlineNotice, SegmentedControl } from '@/components/schedule/fields';
import { ChartCard } from '@/components/charts/chart-frame';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import {
  claveDeCelda,
  type AnalisisDeOrdenes,
  type Celda,
  type EstadoDeShopify,
} from './ordenes-por-hora';

type Modo = 'ordenes' | 'porPersona';

/** Un domingo cualquiera: de él salen los nombres de los siete días en el idioma de la app. */
const DOMINGO = Date.UTC(2026, 10, 8);
const nombreDelDia = (dia: number, language: SupportedLanguage, weekday: 'short' | 'long') =>
  new Intl.DateTimeFormat(language, { weekday, timeZone: 'UTC' }).format(
    new Date(DOMINGO + dia * 864e5),
  );

/**
 * «ÓRDENES POR HORA» EN REPORTES (13-nov): el mapa de día de la semana por hora, con la media
 * del periodo, y lo que dice en frases. Los números salen de `analizarOrdenes`; aquí solo se
 * pintan. Ver `ordenes-por-hora.ts`.
 *
 * UN SOLO TONO, de claro a oscuro: es una magnitud, no categorías. El modo «por persona»
 * marca en rojo las horas con órdenes y nadie en turno, que es lo único que pide una acción.
 */
export function OrdenesPorHoraCard({
  analisis,
  estado,
  weekStartsOn,
  language,
  esAdmin,
}: {
  analisis: AnalisisDeOrdenes | null;
  estado: EstadoDeShopify | null;
  weekStartsOn: number;
  language: SupportedLanguage;
  esAdmin: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const [modo, setModo] = useState<Modo>('ordenes');
  const [señalada, setSeñalada] = useState<Celda | null>(null);

  const numero = (n: number) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(n);
  const dinero = (n: number, moneda: string | null) =>
    moneda === null
      ? numero(n)
      : new Intl.NumberFormat(language, {
          style: 'currency',
          currency: moneda,
          maximumFractionDigits: 0,
        }).format(n);
  const hora = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const dondeCuando = (celda: Celda) =>
    t('reports.orders.at', {
      day: nombreDelDia(celda.diaSemana, language, 'long'),
      hour: hora(celda.hora),
    });

  const sinDatos = analisis === null || analisis.dias === 0 || analisis.horas.length === 0;
  const pie =
    estado === null || estado.last_sync_at === null
      ? undefined
      : t('reports.orders.footnote', {
          shop: estado.shop_name ?? estado.shop,
          when: new Intl.DateTimeFormat(language, {
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(new Date(estado.last_sync_at)),
        });

  if (sinDatos) {
    return (
      <ChartCard
        title={t('reports.orders.title')}
        subtitle={t('reports.orders.hint')}
        testID="chart-orders"
      >
        <InlineNotice
          tone="info"
          icon="storefront-outline"
          title={estado === null ? t('reports.orders.notConnected') : t('reports.orders.empty')}
          body={
            estado === null
              ? esAdmin
                ? t('reports.orders.notConnectedAdmin')
                : t('reports.orders.notConnectedOther')
              : undefined
          }
          testID={estado === null ? 'orders-not-connected' : 'orders-empty'}
        />
      </ChartCard>
    );
  }

  const valor = (celda: Celda | undefined): number | null => {
    if (celda === undefined) return null;
    if (modo === 'ordenes') return celda.ordenes;
    if (celda.personas === 0) return celda.ordenes > 0 ? Number.POSITIVE_INFINITY : null;
    return celda.ordenes / celda.personas;
  };
  const maximo = Math.max(
    0,
    ...[...analisis.celdas.values()]
      .map((celda) => valor(celda) ?? 0)
      .filter((n) => Number.isFinite(n)),
  );
  const RAMPA = [
    colors.surface,
    colors.primary100,
    colors.primary200,
    colors.primary500,
    colors.primary700,
  ];
  const pintar = (n: number | null) => {
    if (n === null || n <= 0) return { fondo: RAMPA[0], tinta: colors.ink500, paso: 0 };
    if (!Number.isFinite(n)) return { fondo: colors.danger50, tinta: colors.danger600, paso: -1 };
    const paso = Math.min(4, Math.max(1, Math.ceil((n / (maximo || 1)) * 4)));
    return { fondo: RAMPA[paso], tinta: paso >= 3 ? colors.onPrimary : colors.ink900, paso };
  };

  const dias = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  const frases = frasesDelAnalisis(analisis, {
    t,
    numero,
    dondeCuando,
    dia: (d) => nombreDelDia(d, language, 'long'),
  });
  const lectura =
    señalada === null
      ? null
      : t('reports.orders.readout', {
          where: dondeCuando(señalada),
          orders: numero(señalada.ordenes),
          people: numero(señalada.personas),
          sales: dinero(señalada.ventas, analisis.moneda),
        });

  return (
    <ChartCard
      title={t('reports.orders.title')}
      subtitle={t('reports.orders.hint')}
      readout={lectura}
      footnote={pie}
      testID="chart-orders"
    >
      <Stack gap={spacing.md}>
        <AppText variant="bodyStrong" testID="orders-total">
          {t('reports.orders.total', {
            count: analisis.totalOrdenes,
            orders: numero(analisis.totalOrdenes),
            sales: dinero(analisis.totalVentas, analisis.moneda),
            days: analisis.dias,
          })}
        </AppText>

        <SegmentedControl<Modo>
          label={t('reports.orders.mode')}
          value={modo}
          options={[
            { value: 'ordenes', label: t('reports.orders.modeOrders') },
            { value: 'porPersona', label: t('reports.orders.modePerPerson') },
          ]}
          onChange={setModo}
          testID="orders-mode"
        />

        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View testID="orders-heatmap">
            <Row gap={GAP}>
              <View style={estilos.rotulo} />
              {analisis.horas.map((h) => (
                <View key={h} style={estilos.columna}>
                  <AppText variant="label" tone="subtle" tabular>
                    {String(h)}
                  </AppText>
                </View>
              ))}
              <View style={estilos.total}>
                <AppText variant="label" tone="subtle">
                  {t('reports.orders.perDay')}
                </AppText>
              </View>
            </Row>
            {dias.map((dia) => (
              <Row key={dia} gap={GAP} style={estilos.fila}>
                <View style={estilos.rotulo}>
                  <AppText variant="label" tone="muted">
                    {nombreDelDia(dia, language, 'short')}
                  </AppText>
                </View>
                {analisis.horas.map((h) => {
                  const celda = analisis.celdas.get(claveDeCelda(dia, h));
                  const n = valor(celda);
                  const { fondo, tinta, paso } = pintar(n);
                  return (
                    <Pressable
                      key={h}
                      onPress={() => setSeñalada(celda ?? null)}
                      onHoverIn={() => setSeñalada(celda ?? null)}
                      accessibilityLabel={
                        celda === undefined
                          ? undefined
                          : t('reports.orders.readout', {
                              where: dondeCuando(celda),
                              orders: numero(celda.ordenes),
                              people: numero(celda.personas),
                              sales: dinero(celda.ventas, analisis.moneda),
                            })
                      }
                      style={[estilos.celda, { backgroundColor: fondo }]}
                      testID={`orders-cell-${dia}-${h}`}
                    >
                      <AppText variant="label" tabular style={{ color: tinta }}>
                        {paso === -1 ? '!' : n === null || n <= 0 ? '' : numero(n)}
                      </AppText>
                    </Pressable>
                  );
                })}
                <View style={estilos.total}>
                  <AppText variant="label" tabular testID={`orders-day-${dia}`}>
                    {numero(analisis.porDia.get(dia) ?? 0)}
                  </AppText>
                </View>
              </Row>
            ))}
          </View>
        </ScrollView>

        <Row gap={spacing.xs} align="center" wrap>
          <AppText variant="label" tone="subtle">
            {t('reports.orders.less')}
          </AppText>
          {RAMPA.slice(1).map((color) => (
            <View key={color} style={[estilos.muestra, { backgroundColor: color }]} />
          ))}
          <AppText variant="label" tone="subtle">
            {t('reports.orders.more')}
          </AppText>
          {modo === 'porPersona' ? (
            <AppText variant="label" tone="subtle" style={estilos.aparte}>
              {t('reports.orders.nobodyLegend')}
            </AppText>
          ) : null}
        </Row>

        <Stack gap={spacing.xs} testID="orders-analysis">
          <AppText variant="bodyStrong">{t('reports.orders.analysisTitle')}</AppText>
          {frases.map((frase) => (
            <AppText key={frase.id} variant="body" testID={`orders-insight-${frase.id}`}>
              {`• ${frase.texto}`}
            </AppText>
          ))}
        </Stack>
      </Stack>
    </ChartCard>
  );
}

/** Lo que dice el mapa, en frases. Solo las que tienen algo que decir. */
export function frasesDelAnalisis(
  analisis: AnalisisDeOrdenes,
  {
    t,
    numero,
    dondeCuando,
    dia,
  }: {
    t: (clave: string, valores?: Record<string, unknown>) => string;
    numero: (n: number) => string;
    dondeCuando: (celda: Celda) => string;
    dia: (diaSemana: number) => string;
  },
): { id: string; texto: string }[] {
  const frases: { id: string; texto: string }[] = [];
  const [punta, ...siguientes] = analisis.puntas;
  if (punta !== undefined) {
    frases.push({
      id: 'peak',
      texto: t('reports.orders.peak', { where: dondeCuando(punta), orders: numero(punta.ordenes) }),
    });
    if (siguientes.length > 0) {
      frases.push({
        id: 'next',
        texto: t('reports.orders.next', {
          list: siguientes
            .map((celda) => `${dondeCuando(celda)} (${numero(celda.ordenes)})`)
            .join(' · '),
        }),
      });
    }
  }
  if (analisis.diaFuerte !== null) {
    frases.push({
      id: 'day',
      texto: t('reports.orders.strongDay', {
        day: dia(analisis.diaFuerte.diaSemana),
        orders: numero(analisis.diaFuerte.ordenes),
      }),
    });
  }
  const falta = analisis.masPorPersona[0];
  if (falta !== undefined) {
    frases.push({
      id: 'busiest',
      texto: t('reports.orders.perPerson', {
        where: dondeCuando(falta),
        ratio: numero(falta.ordenes / falta.personas),
      }),
    });
  }
  if (analisis.sinNadie.length > 0) {
    frases.push({
      id: 'nobody',
      texto: t('reports.orders.nobody', {
        list: analisis.sinNadie
          .map((celda) => `${dondeCuando(celda)} (${numero(celda.ordenes)})`)
          .join(' · '),
      }),
    });
  }
  const sobra = analisis.conPocas[0];
  if (sobra !== undefined) {
    frases.push({
      id: 'quiet',
      texto: t('reports.orders.quiet', {
        where: dondeCuando(sobra),
        people: numero(sobra.personas),
        orders: numero(sobra.ordenes),
      }),
    });
  }
  return frases;
}

const GAP = 2;
const ANCHO = 40;

const useEstilos = estilosDelTema((colors) => ({
  fila: { marginTop: GAP },
  rotulo: { width: 44, justifyContent: 'center' as const },
  columna: { width: ANCHO, alignItems: 'center' as const },
  total: { width: 56, alignItems: 'flex-end' as const, justifyContent: 'center' as const },
  celda: {
    width: ANCHO,
    height: 30,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  muestra: { width: 18, height: 12, borderRadius: 4 },
  aparte: { marginLeft: spacing.md },
}));
