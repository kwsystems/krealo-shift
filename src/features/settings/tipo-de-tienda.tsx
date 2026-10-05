import { useTranslation } from 'react-i18next';

import { SelectField } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { Stack } from '@/components/ui/layout';
import {
  FECHAS_POR_TIPO,
  TIPOS_DE_TIENDA,
  diasDeLaFecha,
  esTemporada,
  type TipoDeTienda,
} from '@/domain/fechas-comerciales';
import { formatDateKeyShort } from '@/features/schedules/week';
import { currentLanguage } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** «Sin elegir» viaja como esta palabra por el desplegable y se guarda como `null`. */
const NINGUNO = 'ninguno';

/**
 * QUÉ TIPO DE TIENDA ES (4-oct). Andree: «un apartado en Ajustes donde poner qué tienda es,
 * y que eso haga que en el calendario aparezcan sus fechas». Debajo del desplegable se ven
 * las fechas que marcará este año, con su día: elegir sin ver qué cambia sería elegir a
 * ciegas. Ver `src/domain/fechas-comerciales.ts`.
 */
export function CampoTipoDeTienda({
  value,
  onChange,
  anio,
}: {
  value: TipoDeTienda | null;
  onChange: (tipo: TipoDeTienda | null) => void;
  /** El año de la vista previa: el de hoy en la sede. */
  anio: number;
}) {
  const { t } = useTranslation();
  const language = currentLanguage();

  const fechas =
    value === null
      ? []
      : FECHAS_POR_TIPO[value].map((fecha) => {
          const dias = diasDeLaFecha(fecha, anio);
          const primero = formatDateKeyShort(dias[0] ?? '', language);
          const cuando = esTemporada(fecha)
            ? `${primero}–${formatDateKeyShort(dias.at(-1) ?? '', language)}`
            : primero;
          return `${t(`commercialDates.dates.${fecha}`)} (${cuando})`;
        });

  return (
    <Stack gap={spacing.xs}>
      <SelectField<string>
        label={t('commercialDates.storeType')}
        value={value ?? NINGUNO}
        options={[
          { value: NINGUNO, label: t('commercialDates.types.none') },
          ...TIPOS_DE_TIENDA.map((tipo) => ({
            value: tipo,
            label: t(`commercialDates.types.${tipo}`),
          })),
        ]}
        onChange={(elegido) => onChange(elegido === NINGUNO ? null : (elegido as TipoDeTienda))}
        testID="org-store-type"
      />
      <AppText variant="help" tone="subtle">
        {t('commercialDates.storeTypeHint')}
      </AppText>
      {fechas.length > 0 ? (
        <AppText variant="help" tone="primary" testID="org-store-type-preview">
          {t('commercialDates.preview', { year: anio, list: fechas.join(' · ') })}
        </AppText>
      ) : null}
    </Stack>
  );
}
