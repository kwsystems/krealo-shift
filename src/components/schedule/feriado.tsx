import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import { fechaComercialDe, esTemporada, type TipoDeTienda } from '@/domain/fechas-comerciales';
import { feriadoDe } from '@/domain/feriados-peru';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * «Feriado · Combate de Angamos», con su bandera, donde se mira un día: la cabecera de la
 * rejilla de Horario, la lista del día en el teléfono y la vista de cada vendedor. Nada si
 * el día no es feriado en esa sede. Ver `src/domain/feriados-peru.ts`.
 *
 * EN ROJO, como en cualquier calendario impreso, y con palabra: el color solo no dice
 * qué feriado es ni que lo sea (§21).
 *
 * CON SU REGLA DE PAGO (4-oct, Andree: «las fechas donde es feriado y se paga doble o
 * triple»): trabajarlo sin otro día de descanso a cambio se paga triple (D.L. 713, art. 9).
 * Se dice donde se arma el horario y donde se mira el día, en una línea corta; la regla
 * entera va en la etiqueta accesible y en Reportes.
 */
export function EtiquetaDeFeriado({
  dateKey,
  timezone,
  soloPalabra = false,
  conPago = false,
}: {
  dateKey: string;
  timezone: string;
  /** «Feriado» sin el nombre, para donde no cabe: la cabecera de una columna estrecha. */
  soloPalabra?: boolean;
  /** Añade «Pago triple si se trabaja» debajo. */
  conPago?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const feriado = feriadoDe(dateKey, timezone);
  if (feriado === null) return null;
  const nombre = t(`holidays.pe.${feriado}`);
  return (
    <Stack gap={0}>
      <Row
        gap={spacing.xs}
        align="center"
        accessibilityLabel={`${t('holidays.labelWithName', { name: nombre })}. ${t('holidays.payRule')}`}
        testID={`feriado-${dateKey}`}
      >
        <Ionicons name="flag" size={12} color={colors.danger600} />
        <AppText variant="label" tone="danger">
          {soloPalabra ? t('holidays.label') : t('holidays.labelWithName', { name: nombre })}
        </AppText>
      </Row>
      {conPago ? (
        // Del tamaño del nombre del feriado: es su segunda línea, no un aviso aparte.
        <AppText variant="label" tone="danger" testID={`feriado-pago-${dateKey}`}>
          {t('holidays.payShort')}
        </AppText>
      ) : null}
    </Stack>
  );
}

/**
 * «Día del Niño Peruano», con su chispa, el día que la tienda espera más clientes según su
 * tipo (Ajustes → Tipo de tienda). Nada sin tipo elegido. Ver `fechas-comerciales.ts`.
 *
 * EN VIOLETA, el acento de la app, y no en rojo ni en ámbar: el rojo es el feriado (se
 * paga distinto) y el ámbar es el descanso. Una fecha comercial no cambia lo que se paga;
 * solo avisa de que conviene más gente.
 */
export function EtiquetaDeFechaComercial({
  dateKey,
  timezone,
  tipo,
}: {
  dateKey: string;
  timezone: string;
  tipo: TipoDeTienda | null | undefined;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const fecha = fechaComercialDe(dateKey, timezone, tipo);
  if (fecha === null) return null;
  const nombre = t(`commercialDates.dates.${fecha}`);
  return (
    <Row
      gap={spacing.xs}
      align="center"
      accessibilityLabel={`${nombre}. ${t('commercialDates.hint')}`}
      testID={`fecha-comercial-${dateKey}`}
    >
      <Ionicons
        name={esTemporada(fecha) ? 'trending-up' : 'sparkles'}
        size={12}
        color={colors.primary600}
      />
      <AppText variant="label" tone="primary">
        {nombre}
      </AppText>
    </Row>
  );
}

/** Las dos a la vez, en el orden en que importan: lo que se paga distinto va primero. */
export function EtiquetasDelDia({
  dateKey,
  timezone,
  tipo,
  soloPalabra = false,
  conPago = false,
}: {
  dateKey: string;
  timezone: string;
  tipo: TipoDeTienda | null | undefined;
  soloPalabra?: boolean;
  conPago?: boolean;
}) {
  return (
    <>
      <EtiquetaDeFeriado
        dateKey={dateKey}
        timezone={timezone}
        soloPalabra={soloPalabra}
        conPago={conPago}
      />
      <EtiquetaDeFechaComercial dateKey={dateKey} timezone={timezone} tipo={tipo} />
    </>
  );
}
