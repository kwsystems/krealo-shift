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
 * más antes de su turno, o salió una hora o más después, sale aquí con lo que hizo. Andree:
 * «ya veo yo si cambio de horario o es hora extra o lo que sea». Cada fila trae:
 *
 *   - CAMBIAR SU TURNO, aquí mismo: era su horario de verdad. Al publicar, el aviso se va.
 *   - RESOLVER EN HORAS: abre Horas en su semana, filtrada a esa persona, donde «Por
 *     resolver» tiene el caso con sus respuestas (aprobar la extra, «no es extra», «está
 *     bien así»). Decidido allí, este aviso se va solo.
 *
 * AQUÍ YA NO SE DECIDE (6-oct). Había un «Visto, está bien así» en esta fila y, en Horas,
 * la misma jornada como posible hora extra: dos pantallas pidiendo respuesta por lo mismo,
 * y lo que se contestaba en una seguía preguntándose en la otra. Andree: «debería
 * centrarse solo en Horas». Horario avisa, Horas decide.
 *
 * Mientras el día sigue abierto —aún no marcó la salida— no hay nada que decidir: no se
 * sabe si habrá extra. El botón dice entonces «Ver en Horas» y abre su jornada.
 *
 * Ámbar y no rojo: no es un error de nadie —marcar temprano no está prohibido—, es algo
 * que quien gestiona tiene que mirar. Con icono y palabras, nunca solo color (§21).
 *
 * EL ÁMBAR VA EN EL BORDE Y EL ICONO, NO DE FONDO. Con fondo ámbar, los botones de texto
 * —«Ver en Horas»— quedaban en tema oscuro a 4,36:1 y hace falta 4,5 (lo midió
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
  /** Aún sin salida ese día: nada que resolver todavía, solo verla. */
  diaAbierto: boolean;
};

export function MarcasFueraDelTurno({
  filas,
  onCambiarTurno,
  onVerEnHoras,
}: {
  filas: readonly FilaFueraDelTurno[];
  onCambiarTurno: (id: string) => void;
  onVerEnHoras: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  /*
   * Los botones al lado del texto solo desde 1024 px: en un iPad vertical, con la barra
   * lateral, los botones no caben junto al texto y se salían 53 px (`responsive:check`).
   */
  const { density } = useResponsive();
  const isWide = density === 'extraWide';
  /*
   * MÁS DE TRES SE PLIEGAN: el aviso va encima de la rejilla, y una lista de diez la
   * empujaría fuera de la pantalla. Se ven las tres primeras y el botón dice cuántas más.
   */
  const [todas, setTodas] = useState(false);
  /*
   * EMPIEZA PLEGADO, EN UNA LÍNEA (1-oct). «Se ve muy grande», dijo Andree del Horario: este
   * aviso eran 320 px encima de la rejilla en un monitor, y 800 en un teléfono, antes del
   * primer turno. Plegado sigue avisando —el ámbar, cuántas son y de quién— y «Revisar»
   * abre las marcas con sus salidas. Lo que se va es el sitio, no el aviso.
   */
  const [abierto, setAbierto] = useState(false);
  const desplegado = abierto;
  if (filas.length === 0) return null;
  const visibles = todas ? filas : filas.slice(0, VISIBLES_PLEGADO);
  /* «Ana · lun 28, Diego · mar 29, Ele · mié 30 y 1 más»: de quién son, sin abrirlas. */
  const resumen = [
    filas
      .slice(0, VISIBLES_PLEGADO)
      .map((fila) => `${fila.nombre} · ${fila.dia}`)
      .join(', '),
    filas.length > VISIBLES_PLEGADO
      ? t('schedule.unusual.summaryMore', { count: filas.length - VISIBLES_PLEGADO })
      : null,
  ]
    .filter((parte): parte is string => parte !== null)
    .join(' ');
  const ocultas = filas.length - visibles.length;

  return (
    <View style={estilos.caja} testID="marcas-fuera-del-turno">
      <Stack gap={spacing.xs}>
        {/*
          EL TÍTULO Y SU EXPLICACIÓN EN UNA LÍNEA cuando caben (1-oct): eran dos filas de
          cabecera para un aviso que vive encima de la rejilla.
        */}
        <Row gap={spacing.sm} align="center" wrap>
          <Ionicons name="alarm-outline" size={20} color={colors.warning600} />
          <AppText variant="bodyStrong" accessibilityRole="header">
            {t('schedule.unusual.title', { count: filas.length })}
          </AppText>
          {desplegado ? (
            <AppText variant="help" tone="muted" style={estilos.crece}>
              {t('schedule.unusual.body')}
            </AppText>
          ) : density === 'compact' || density === 'regular' ? (
            // En un teléfono, el resumen de nombres no cabe en la línea: basta con cuántas.
            <View style={estilos.crece} />
          ) : (
            <AppText
              variant="help"
              tone="muted"
              style={estilos.crece}
              testID="marcas-fuera-del-turno-resumen"
            >
              {resumen}
            </AppText>
          )}
          <GhostButton
            label={desplegado ? t('schedule.unusual.hide') : t('schedule.unusual.review')}
            onPress={() => setAbierto((valor) => !valor)}
            fullWidth={false}
            testID="marcas-fuera-del-turno-abrir"
          />
        </Row>

        {desplegado ? (
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
                {/*
                QUIÉN, QUÉ DÍA Y QUÉ PASÓ EN UNA LÍNEA, y el turno debajo (1-oct). Eran tres
                líneas por marca.
              */}
                <Stack gap={0} style={isWide ? estilos.crece : undefined}>
                  <Row gap={spacing.sm} align="baseline" wrap>
                    <AppText variant="bodyStrong">{fila.nombre}</AppText>
                    <AppText variant="label" tone="subtle" tabular>
                      {fila.dia}
                    </AppText>
                    <AppText variant="body">{fila.que}</AppText>
                  </Row>
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
                    label={
                      fila.diaAbierto
                        ? t('schedule.unusual.openHours')
                        : t('schedule.unusual.resolveInHours')
                    }
                    onPress={() => onVerEnHoras(fila.id)}
                    fullWidth={false}
                    testID={`marca-rara-${fila.id}-horas`}
                  />
                </Row>
              </View>
            ))}
          </Stack>
        ) : null}
        {desplegado && filas.length > VISIBLES_PLEGADO ? (
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: { paddingVertical: spacing.sm, gap: spacing.sm },
  /* En pantalla ancha, lo que pasó a la izquierda y qué hacer con ello a la derecha. */
  filaAncha: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
}));
