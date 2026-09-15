import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/ui/app-text';
import { Card, Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import type { ClaveAccionable, PrioridadDelDia } from '@/features/dashboard/prioridad';
import {
  borderWidth,
  colors,
  fontSize,
  radii,
  sizes,
  spacing,
  statusPalette,
  type StatusTone,
} from '@/theme/tokens';

/**
 * La franja de arriba de Inicio: lo que decide el día, en grande.
 *
 * UN SOLO TITULAR, Y GRANDE DE VERDAD
 * Dos titulares son cero titulares. La pregunta que contesta esta franja es «¿qué
 * hago primero?», y esa pregunta tiene una sola respuesta. Lo demás que pide acción va
 * debajo, en fila y a tamaño normal; lo que solo informa, más abajo todavía y apagado.
 *
 * EL NÚMERO NO ES LO ÚNICO QUE SE LEE
 * Cada destacado dice el número, qué es, y QUÉ HACER con ello en una línea. Un «3» en
 * rojo asusta pero no informa: lo que hace falta saber a las nueve de la mañana es que
 * hay tres personas que no llegaron y que se revisa en el horario.
 *
 * EL COLOR NUNCA VA SOLO: los cinco llevan icono y texto, porque quien no distingue el
 * rojo del ámbar tiene que poder leer esta pantalla igual de rápido (§21).
 */

type IconName = keyof typeof Ionicons.glyphMap;

const ICONO: Readonly<Record<ClaveAccionable, IconName>> = {
  absent: 'person-remove-outline',
  late: 'alert-circle',
  incomplete: 'help-circle-outline',
  requests: 'mail-unread-outline',
  pendingSync: 'cloud-offline-outline',
};

/**
 * El tono de cada cosa. No son cinco colores distintos: son tres niveles.
 * Rojo lo que deja la tienda corta, ámbar lo que tiene fecha límite, azul lo que
 * espera a alguien. Cinco colores serían cinco cosas que aprender.
 */
const TONO: Readonly<Record<ClaveAccionable, StatusTone>> = {
  absent: 'late',
  late: 'late',
  incomplete: 'warning',
  requests: 'info',
  pendingSync: 'warning',
};

export function LoImportanteDeHoy({
  prioridad,
  /** Quién está dentro ahora mismo, para el día en que no hay nada que hacer. */
  trabajando,
  enDescanso,
}: {
  prioridad: PrioridadDelDia;
  trabajando: number;
  enDescanso: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { isCompact } = useResponsive();

  if (prioridad.todoEnOrden) {
    /*
     * EL DÍA TRANQUILO TIENE SU PROPIA PANTALLA, y no es una fila de ceros.
     * Saber que no hay nada pendiente es información: es lo que permite cerrar la app
     * y seguir con el día. Seis casillas a cero obligan a leerlas todas para llegar a
     * la misma conclusión, y además se parecen demasiado a «esto no ha cargado».
     */
    return (
      <Card testID="hoy-todo-en-orden" style={styles.tarjetaTranquila}>
        <Row gap={spacing.md} align="center">
          <View style={[styles.icono, { backgroundColor: statusPalette.working.bg }]}>
            <Ionicons
              name="checkmark-circle"
              size={sizes.iconMobile}
              color={statusPalette.working.fg}
            />
          </View>
          <Stack gap={spacing.xs} style={styles.crece}>
            <AppText variant="section">{t('home.allClearTitle')}</AppText>
            <AppText variant="help" tone="muted">
              {t('home.allClearBody', { working: trabajando, onBreak: enDescanso })}
            </AppText>
          </Stack>
        </Row>
      </Card>
    );
  }

  const titular = prioridad.titular;

  return (
    <Stack gap={spacing.sm} testID="hoy-lo-importante">
      {titular !== null ? (
        <Titular
          destacado={titular}
          onPress={
            titular.destino === null ? undefined : () => router.push(titular.destino as never)
          }
          compacto={isCompact}
        />
      ) : null}

      {prioridad.resto.length > 0 ? (
        <Row gap={spacing.sm} wrap align="stretch">
          {prioridad.resto.map((destacado) => (
            <Secundario
              key={destacado.clave}
              destacado={destacado}
              onPress={
                destacado.destino === null
                  ? undefined
                  : () => router.push(destacado.destino as never)
              }
            />
          ))}
        </Row>
      ) : null}
    </Stack>
  );
}

function Titular({
  destacado,
  onPress,
  compacto,
}: {
  destacado: PrioridadDelDia['titular'] & object;
  onPress?: () => void;
  compacto: boolean;
}) {
  const { t } = useTranslation();
  const paleta = statusPalette[TONO[destacado.clave]];
  const etiqueta = t(`home.headline.${destacado.clave}`, { count: destacado.count });
  const queHacer = t(`home.action.${destacado.clave}`, { count: destacado.count });

  const contenido = (
    <View
      style={[styles.titular, { backgroundColor: paleta.bg, borderColor: paleta.border }]}
      testID={`hoy-titular-${destacado.clave}`}
    >
      <Row gap={spacing.md} align="center">
        <Ionicons name={ICONO[destacado.clave]} size={sizes.iconKiosk} color={paleta.fg} />
        <Stack gap={spacing.xs} style={styles.crece}>
          {/*
            La cifra héroe: el único número grande de la pantalla. Figuras
            proporcionales y no tabulares —`tabular-nums` da a cada dígito el ancho de
            un cero y a este tamaño un «3» queda flotando en su hueco—.
          */}
          <AppText
            variant="title"
            size={compacto ? fontSize.kioskTitleMin : fontSize.kioskClockMin}
            style={{ color: paleta.fg }}
          >
            {destacado.count}
          </AppText>
          <AppText variant="bodyStrong" style={{ color: paleta.fg }}>
            {etiqueta}
          </AppText>
          <AppText variant="help" tone="muted">
            {queHacer}
          </AppText>
        </Stack>
        {onPress !== undefined ? (
          <Ionicons name="chevron-forward" size={sizes.iconMobile} color={paleta.fg} />
        ) : null}
      </Row>
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={`${destacado.count} ${etiqueta}. ${queHacer}`}>
        {contenido}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${destacado.count} ${etiqueta}. ${queHacer}`}
      onPress={onPress}
    >
      {contenido}
    </Pressable>
  );
}

function Secundario({
  destacado,
  onPress,
}: {
  destacado: PrioridadDelDia['resto'][number];
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const paleta = statusPalette[TONO[destacado.clave]];
  const etiqueta = t(`home.headline.${destacado.clave}`, { count: destacado.count });

  const contenido = (
    <View
      style={[styles.secundario, { borderColor: paleta.border }]}
      testID={`hoy-secundario-${destacado.clave}`}
    >
      <Row gap={spacing.xs} align="center">
        <Ionicons name={ICONO[destacado.clave]} size={16} color={paleta.fg} />
        <AppText variant="bodyStrong" style={{ color: paleta.fg }}>
          {destacado.count}
        </AppText>
      </Row>
      <AppText variant="label" tone="muted" numberOfLines={2}>
        {etiqueta}
      </AppText>
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={`${destacado.count} ${etiqueta}`}>
        {contenido}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${destacado.count} ${etiqueta}`}
      onPress={onPress}
    >
      {contenido}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  crece: { flex: 1 },
  tarjetaTranquila: { borderColor: statusPalette.working.border },
  icono: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titular: {
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    padding: spacing.lg,
  },
  secundario: {
    minWidth: 132,
    gap: spacing.xs,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
});
