import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * «MARCAS FUERA DE SU HORARIO», en Horario (Andree, 1-oct).
 *
 * El reloj deja marcar a cualquier hora; esto es lo que lo compensa. Quien entró una hora o
 * más antes de su turno, o salió una hora o más después, sale aquí con lo que hizo y las
 * tres respuestas que Andree dijo que daría: «ya veo yo si cambio de horario o es hora
 * extra o lo que sea». Por eso cada fila trae su botón:
 *
 *   - CAMBIAR SU TURNO, aquí mismo: era su horario de verdad. Al publicar, el aviso se va.
 *   - VER EN HORAS, en su jornada: corregir la hora o aprobar la extra. Aprobada, se va.
 *   - VISTO, ESTÁ BIEN ASÍ: lo sabía y no hay nada que cambiar.
 *
 * SOLO AQUÍ, y es a propósito: «solo avisar en horario». Horas y Reportes no lo repiten.
 *
 * Ámbar y no rojo: no es un error de nadie —marcar temprano no está prohibido—, es algo
 * que quien gestiona tiene que mirar. Con icono y palabras, nunca solo color (§21).
 *
 * EL ÁMBAR VA EN EL BORDE Y EL ICONO, NO DE FONDO. Con fondo ámbar, los botones de texto
 * —«Ver en Horas», «Visto»— quedaban en tema oscuro a 4,36:1 y hace falta 4,5 (lo midió
 * `contraste:check`). Sobre la superficie se leen en los dos temas.
 */

export type FilaFueraDelTurno = {
  id: string;
  nombre: string;
  /** «mar 29» */
  dia: string;
  /** «Entró 1 h 20 min antes de su turno» */
  que: string;
  /** «Turno 10:00 – 19:00 · entró 08:40» */
  detalle: string | null;
  puedeCambiarTurno: boolean;
  viendo: boolean;
};

export function MarcasFueraDelTurno({
  filas,
  onCambiarTurno,
  onVerEnHoras,
  onVisto,
}: {
  filas: readonly FilaFueraDelTurno[];
  onCambiarTurno: (id: string) => void;
  onVerEnHoras: (id: string) => void;
  onVisto: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const { isWide } = useResponsive();
  /*
   * MÁS DE TRES SE PLIEGAN: el aviso va encima de la rejilla, y una lista de diez la
   * empujaría fuera de la pantalla. Se ven las tres primeras y el botón dice cuántas más.
   */
  const [todas, setTodas] = useState(false);
  if (filas.length === 0) return null;
  const visibles = todas ? filas : filas.slice(0, VISIBLES_PLEGADO);
  const ocultas = filas.length - visibles.length;

  return (
    <View style={estilos.caja} testID="marcas-fuera-del-turno">
      <Stack gap={spacing.md}>
        <Row gap={spacing.sm} align="center">
          <Ionicons name="alarm-outline" size={20} color={colors.warning600} />
          <AppText variant="bodyStrong" accessibilityRole="header" style={estilos.crece}>
            {t('schedule.unusual.title', { count: filas.length })}
          </AppText>
        </Row>
        <AppText variant="help" tone="muted">
          {t('schedule.unusual.body')}
        </AppText>

        <Stack gap={0}>
          {visibles.map((fila, indice) => (
            <View
              key={fila.id}
              style={[
                estilos.fila,
                isWide ? estilos.filaAncha : null,
                indice > 0 ? estilos.conRegla : null,
              ]}
              testID={`marca-rara-${fila.id}`}
            >
              <Stack gap={spacing.xs} style={isWide ? estilos.crece : undefined}>
                <Row gap={spacing.sm} align="center" wrap>
                  <AppText variant="bodyStrong">{fila.nombre}</AppText>
                  <AppText variant="label" tone="subtle" tabular>
                    {fila.dia}
                  </AppText>
                </Row>
                <AppText variant="body">{fila.que}</AppText>
                {fila.detalle === null ? null : (
                  <AppText variant="label" tone="muted" tabular>
                    {fila.detalle}
                  </AppText>
                )}
              </Stack>
              <Row gap={spacing.sm} wrap align="center">
                {fila.puedeCambiarTurno ? (
                  <SecondaryButton
                    label={t('schedule.unusual.changeShift')}
                    onPress={() => onCambiarTurno(fila.id)}
                    fullWidth={false}
                    testID={`marca-rara-${fila.id}-turno`}
                  />
                ) : null}
                <GhostButton
                  label={t('schedule.unusual.openHours')}
                  onPress={() => onVerEnHoras(fila.id)}
                  fullWidth={false}
                  testID={`marca-rara-${fila.id}-horas`}
                />
                <GhostButton
                  label={t('schedule.unusual.seen')}
                  onPress={() => onVisto(fila.id)}
                  loading={fila.viendo}
                  fullWidth={false}
                  testID={`marca-rara-${fila.id}-visto`}
                />
              </Row>
            </View>
          ))}
        </Stack>
        {filas.length > VISIBLES_PLEGADO ? (
          <GhostButton
            label={
              todas
                ? t('schedule.unusual.showFewer')
                : t('schedule.unusual.showMore', { count: ocultas })
            }
            onPress={() => setTodas((valor) => !valor)}
            fullWidth={false}
            testID="marcas-fuera-del-turno-todas"
          />
        ) : null}
      </Stack>
    </View>
  );
}

const VISIBLES_PLEGADO = 3;

const useEstilos = estilosDelTema((colors) => ({
  caja: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.focus,
    borderColor: colors.warning600,
    padding: spacing.base,
  },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: { paddingVertical: spacing.md, gap: spacing.sm },
  /* En pantalla ancha, lo que pasó a la izquierda y qué hacer con ello a la derecha. */
  filaAncha: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
}));
