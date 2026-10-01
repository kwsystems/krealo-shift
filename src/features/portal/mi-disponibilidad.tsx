import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ChipDeDisponibilidad } from '@/components/availability/chip-de-disponibilidad';
import {
  HojaDeDisponibilidad,
  nombreDelDiaDeSemana,
  type ValoresIniciales,
} from '@/components/availability/hoja-de-disponibilidad';
import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { Card, Row, Stack } from '@/components/ui/layout';
import { useMiDisponibilidad } from '@/features/availability/api';
import type { Disponibilidad } from '@/features/availability/disponibilidad';
import { formatDateKeyShort, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { useTonos } from '@/theme/tonos';
import { borderWidth, radii, spacing } from '@/theme/tokens';

/**
 * «MI DISPONIBILIDAD», EN SU CELULAR (1-oct). Andree: «cuando esto cambie también tiene que
 * cambiar el apartado que tienen los vendedores cuando se loguean». Aquí la persona dice
 * qué días no puede trabajar —cada semana o un día concreto—, qué horas prefiere, o deja un
 * comentario. Ve si su tienda ya lo vio. Lo mismo sale en su semana, al lado de cada día.
 */
export function MiDisponibilidad({
  organizationId,
  employeeId,
  hoy,
  weekStartsOn,
  language,
}: {
  organizationId: string;
  employeeId: string;
  hoy: DateKey;
  weekStartsOn: number;
  language: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const tonos = useTonos();
  const consulta = useMiDisponibilidad({ organizationId, employeeId });
  const [hoja, setHoja] = useState<ValoresIniciales | null>(null);
  const filas = (consulta.data ?? []).filter(
    (fila) => fila.kind === 'weekly' || (fila.date ?? '') >= hoy,
  );

  const cuando = (fila: Disponibilidad) =>
    fila.kind === 'weekly'
      ? t('availability.everyWeekday', { day: nombreDelDiaDeSemana(fila.weekday ?? 1, language) })
      : formatDateKeyShort(fila.date ?? hoy, language);

  return (
    <Card testID="mi-disponibilidad">
      <Row gap={spacing.md} align="center">
        <View
          style={[
            estilos.baldosa,
            { backgroundColor: tonos.turquesa.fondo, borderColor: tonos.turquesa.borde },
          ]}
        >
          <Ionicons name="calendar-clear-outline" size={20} color={tonos.turquesa.tinta} />
        </View>
        <Stack gap={0} style={estilos.crece}>
          <AppText variant="section">{t('availability.portalTitle')}</AppText>
        </Stack>
        <SecondaryButton
          label={t('availability.portalAdd')}
          onPress={() => setHoja({ fila: null, employeeId })}
          fullWidth={false}
          testID="mi-disponibilidad-agregar"
        />
      </Row>
      <AppText variant="help" tone="muted">
        {t('availability.portalBody')}
      </AppText>

      {consulta.isPending ? null : filas.length === 0 ? (
        <AppText variant="help" tone="subtle" testID="mi-disponibilidad-vacia">
          {t('availability.portalEmpty')}
        </AppText>
      ) : (
        <Stack gap={0}>
          {filas.map((fila, indice) => (
            <View
              key={fila.id}
              style={[estilos.fila, indice > 0 ? estilos.conRegla : null]}
              testID={`mi-disponibilidad-${fila.id}`}
            >
              <Row gap={spacing.sm} align="center" wrap>
                <AppText variant="bodyStrong">{cuando(fila)}</AppText>
                <AppText variant="label" tone={fila.status === 'new' ? 'subtle' : 'success'}>
                  {fila.status === 'new'
                    ? t('availability.portalSent')
                    : t('availability.portalSeen')}
                </AppText>
              </Row>
              <ChipDeDisponibilidad
                fila={fila}
                primera
                conNota
                onPress={() => setHoja({ fila, employeeId })}
                testID={`mi-disponibilidad-chip-${fila.id}`}
              />
            </View>
          ))}
        </Stack>
      )}

      {hoja === null ? null : (
        <HojaDeDisponibilidad
          key={hoja.fila?.id ?? 'nueva'}
          inicial={hoja}
          organizationId={organizationId}
          personas={null}
          primera
          hoy={hoy}
          weekStartsOn={weekStartsOn}
          language={language}
          onClose={() => setHoja(null)}
        />
      )}
    </Card>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  baldosa: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: { paddingVertical: spacing.sm, gap: spacing.xs },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
  radio: { borderRadius: radii.card },
}));
