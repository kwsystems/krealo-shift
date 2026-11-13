import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { InlineNotice, SegmentedControl } from '@/components/schedule/fields';
import { ChartCard } from '@/components/charts/chart-frame';
import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import {
  claveDeCelda,
  planDePersonal,
  type AnalisisDeOrdenes,
  type Celda,
  type EstadoDeShopify,
} from './ordenes-por-hora';

/**
 * LA ESCALA DE CALOR (Andree, 13-nov: «no se nota mucho la diferencia»). Antes iba en el morado
 * de la marca, de `primary100` a `primary700`; en el tema oscuro los tres primeros pasos eran
 * casi el mismo violeta oscuro y el mapa se leía plano. Ahora es de amarillo a rojo, igual en
 * los dos temas —un mapa de calor se lee por el color, no por el tema—, cada paso con su tinta
 * propia para que el número se lea (oscura en los claros, blanca en el último).
 */
const CALOR = [
  { fondo: '#FFF1B8', tinta: '#3D2B00' },
  { fondo: '#FFD166', tinta: '#3D2B00' },
  { fondo: '#FF9F43', tinta: '#2A1600' },
  { fondo: '#F2542D', tinta: '#2A0A00' },
  { fondo: '#B3122E', tinta: '#FFFFFF' },
] as const;

/**
 * LOS PASOS POR QUINTILES, NO POR FRACCIÓN DEL MÁXIMO. Con la fracción, una sola hora muy alta
 * (el sábado a las 16:00) aplastaba todas las demás en los dos primeros pasos. Por quintiles
 * cada color tiene más o menos el mismo número de casillas, y lo flojo y lo fuerte se separan.
 */
function cortesPorQuintil(valores: number[]): number[] {
  // Sobre los valores DISTINTOS: con medias que se repiten mucho (0.5, 1…), los quintiles de
  // todas las casillas caían en el mismo valor y 0.5 y 1 salían del mismo color.
  const orden = [...new Set(valores.filter((n) => n > 0 && Number.isFinite(n)))].sort(
    (a, b) => a - b,
  );
  if (orden.length === 0) return [];
  return [1, 2, 3, 4].map((q) => orden[Math.min(orden.length - 1, Math.floor((orden.length * q) / 5))] ?? 0);
}

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
 * UNA SOLA ESCALA, de amarillo a rojo (`CALOR`): es una magnitud, no categorías. El modo «por
 * persona» marca con borde rojo y «!» las horas con órdenes y nadie en turno, que es lo único que
 * pide una acción. Debajo, el plan de personal: `planDePersonal`.
 */
export function OrdenesPorHoraCard({
  analisis,
  estado,
  weekStartsOn,
  language,
  esAdmin,
  equipo,
}: {
  analisis: AnalisisDeOrdenes | null;
  estado: EstadoDeShopify | null;
  weekStartsOn: number;
  language: SupportedLanguage;
  esAdmin: boolean;
  /** Personas activas en el equipo: el plan de personal lo dice al lado de lo que reparte. */
  equipo: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const [modo, setModo] = useState<Modo>('ordenes');
  const [señalada, setSeñalada] = useState<Celda | null>(null);
  // En el teléfono no caben siete casillas de 44 px: ahí el mapa se lee sin tocar.
  const tocable = useResponsive().density !== 'compact';

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
  const cortes = cortesPorQuintil(
    [...analisis.celdas.values()].map((celda) => valor(celda) ?? 0),
  );
  const pintar = (n: number | null) => {
    if (n === null || n <= 0) return { fondo: colors.surface, tinta: colors.ink500, paso: 0, borde: null };
    // Órdenes y nadie en turno: sin color de calor (sería un rojo más) sino con borde de alerta.
    if (!Number.isFinite(n))
      return { fondo: colors.surface, tinta: colors.danger600, paso: -1, borde: colors.danger600 };
    const paso = cortes.filter((corte) => n > corte).length; // 0…4
    const { fondo, tinta } = CALOR[paso] ?? CALOR[0];
    return { fondo, tinta, paso: paso + 1, borde: null };
  };
  const plan = planDePersonal(analisis, equipo);

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
        {/* Lo que dice cada modo, en una línea: «por persona en turno» no se entendía solo. */}
        <AppText variant="label" tone="muted" testID="orders-mode-help">
          {modo === 'ordenes'
            ? t('reports.orders.modeOrdersHelp')
            : t('reports.orders.modePerPersonHelp')}
        </AppText>

        {/*
          DÍAS EN COLUMNAS Y HORAS EN FILAS, como la rejilla de Horario, y casillas que se
          estiran hasta llenar el ancho: así cabe en un teléfono sin esconder nada en una zona
          que se desliza de lado (`responsive-check`). En pantalla ancha cada casilla se toca
          para ver su detalle y mide lo que pide el dedo; en el teléfono no hay sitio para 44 px
          por día, y ahí se lee sin tocar.
        */}
        <View testID="orders-heatmap">
          <Row gap={GAP}>
            <View style={estilos.rotulo} />
            {dias.map((dia) => (
              <View key={dia} style={estilos.columna}>
                <AppText variant="label" tone="muted">
                  {nombreDelDia(dia, language, 'short')}
                </AppText>
              </View>
            ))}
          </Row>
          {analisis.horas.map((h) => (
            <Row key={h} gap={GAP} style={estilos.fila}>
              <View style={estilos.rotulo}>
                <AppText variant="label" tone="subtle" tabular>
                  {hora(h)}
                </AppText>
              </View>
              {dias.map((dia) => {
                const celda = analisis.celdas.get(claveDeCelda(dia, h));
                const n = valor(celda);
                const { fondo, tinta, paso, borde } = pintar(n);
                const etiqueta =
                  celda === undefined
                    ? undefined
                    : t('reports.orders.readout', {
                        where: dondeCuando(celda),
                        orders: numero(celda.ordenes),
                        people: numero(celda.personas),
                        sales: dinero(celda.ventas, analisis.moneda),
                      });
                const texto = (
                  <AppText variant="label" tabular style={{ color: tinta }}>
                    {paso === -1 ? '!' : n === null || n <= 0 ? '' : numero(n)}
                  </AppText>
                );
                const estilo = [
                  estilos.celda,
                  tocable ? estilos.celdaTocable : null,
                  { backgroundColor: fondo },
                  borde === null ? null : { borderColor: borde, borderWidth: 2 },
                ];
                return tocable ? (
                  <Pressable
                    key={dia}
                    onPress={() => setSeñalada(celda ?? null)}
                    onHoverIn={() => setSeñalada(celda ?? null)}
                    accessibilityLabel={etiqueta}
                    style={estilo}
                    testID={`orders-cell-${dia}-${h}`}
                  >
                    {texto}
                  </Pressable>
                ) : (
                  <View
                    key={dia}
                    accessibilityLabel={etiqueta}
                    style={estilo}
                    testID={`orders-cell-${dia}-${h}`}
                  >
                    {texto}
                  </View>
                );
              })}
            </Row>
          ))}
          <Row gap={GAP} style={estilos.fila}>
            <View style={estilos.rotulo}>
              <AppText variant="label" tone="subtle">
                {t('reports.orders.perDay')}
              </AppText>
            </View>
            {dias.map((dia) => (
              <View key={dia} style={estilos.columna}>
                <AppText variant="label" tabular testID={`orders-day-${dia}`}>
                  {numero(analisis.porDia.get(dia) ?? 0)}
                </AppText>
              </View>
            ))}
          </Row>
        </View>

        <Row gap={spacing.xs} align="center" wrap>
          <AppText variant="label" tone="subtle">
            {t('reports.orders.less')}
          </AppText>
          {CALOR.map(({ fondo }) => (
            <View key={fondo} style={[estilos.muestra, { backgroundColor: fondo }]} />
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

        {plan === null ? null : (
          <Stack gap={spacing.xs} testID="orders-staffing">
            <AppText variant="bodyStrong">{t('reports.orders.staffTitle')}</AppText>
            <AppText variant="label" tone="muted">
              {t('reports.orders.staffIntro', {
                hours: numero(Math.round(plan.horasSemana)),
                team: plan.equipo,
                shift: numero(plan.turnoMedio),
              })}
            </AppText>
            {dias
              .map((dia) => plan.dias.find((d) => d.diaSemana === dia))
              .filter((d) => d !== undefined)
              .map((d) => {
                const cambio = d.personasSugeridas - Math.round(d.personasAhora);
                const flecha = cambio > 0 ? '↑' : cambio < 0 ? '↓' : '=';
                return (
                  <AppText
                    key={d.diaSemana}
                    variant="body"
                    testID={`orders-staff-${d.diaSemana}`}
                  >
                    {`${flecha} ${t('reports.orders.staffDay', {
                      day: nombreDelDia(d.diaSemana, language, 'long'),
                      orders: numero(d.ordenes),
                      // Media de personas por día, redondeada: «3.5 personas» no se entiende.
                      now: Math.round(d.personasAhora),
                      nowHours: numero(Math.round(d.horasAhora)),
                      suggested: d.personasSugeridas,
                      suggestedHours: numero(Math.round(d.horasSugeridas)),
                    })}${
                      d.refuerzo === null
                        ? ''
                        : ` ${t('reports.orders.staffPeak', {
                            from: hora(d.refuerzo.desde),
                            to: hora(d.refuerzo.hasta),
                          })}`
                    }`}
                  </AppText>
                );
              })}
            <AppText variant="label" tone="subtle">
              {t('reports.orders.staffNote')}
            </AppText>
          </Stack>
        )}
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
/** 44: el mínimo táctil del proyecto (`responsive-check`). */
const TACTIL = 44;

const useEstilos = estilosDelTema((colors) => ({
  fila: { marginTop: GAP },
  rotulo: { width: 44, justifyContent: 'center' as const },
  columna: { flex: 1, minWidth: 0, alignItems: 'center' as const },
  celda: {
    flex: 1,
    minWidth: 0,
    height: 30,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  celdaTocable: { height: TACTIL, minWidth: TACTIL },
  muestra: { width: 18, height: 12, borderRadius: 4 },
  aparte: { marginLeft: spacing.md },
}));
