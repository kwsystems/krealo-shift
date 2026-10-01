import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { AppText } from '@/components/ui/app-text';
import { Row } from '@/components/ui/layout';
import type { Disponibilidad, TipoDeDisponibilidad } from '@/features/availability/disponibilidad';
import { estilosDelTema } from '@/theme/estilos';
import { useTonos, type Tono } from '@/theme/tonos';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';

/**
 * UNA DISPONIBILIDAD EN UNA PÍLDORA (1-oct): rojo si no puede, verde si prefiere unas
 * horas, azul si es un comentario. Con icono y palabras, nunca solo color (§21). Un punto
 * naranja dice que es nueva —que quien gestiona todavía no la vio—.
 *
 * `primera` es la voz del celular de la persona: «No puedo», no «No puede».
 */

export const TONO_DE_DISPONIBILIDAD: Record<TipoDeDisponibilidad, Tono> = {
  unavailable: 'rojo',
  preferred: 'verde',
  note: 'azul',
};

const ICONO: Record<TipoDeDisponibilidad, keyof typeof Ionicons.glyphMap> = {
  unavailable: 'close-circle-outline',
  preferred: 'heart-outline',
  note: 'chatbubble-ellipses-outline',
};

/** «No puede», «No puede 08:00–13:00», «Prefiere 14:00–22:00», «Comentario». */
export function textoDeDisponibilidad(fila: Disponibilidad, t: TFunction, primera = false): string {
  const voz = primera ? 'Mine' : '';
  const horas = { from: fila.from_time ?? '', to: fila.to_time ?? '' };
  if (fila.type === 'note') return t(`availability.chipNote${voz}`);
  if (fila.type === 'preferred') return t(`availability.chipPreferred${voz}`, horas);
  return fila.from_time === null || fila.to_time === null
    ? t(`availability.chipUnavailable${voz}`)
    : t(`availability.chipUnavailableRange${voz}`, horas);
}

export function ChipDeDisponibilidad({
  fila,
  primera = false,
  conNota = false,
  nombre,
  onPress,
  testID,
}: {
  fila: Disponibilidad;
  primera?: boolean;
  /** Con el comentario debajo, envolviendo: en Equipo y en el celular sí; en la rejilla no. */
  conNota?: boolean;
  /** Para el teléfono, donde la píldora va sin su fila de persona delante. */
  nombre?: string;
  onPress?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const tonos = useTonos();
  const tono = tonos[TONO_DE_DISPONIBILIDAD[fila.type]];
  const aviso = tonos.naranja;
  const texto = textoDeDisponibilidad(fila, t, primera);
  const etiqueta = [
    nombre,
    texto,
    fila.note,
    fila.status === 'new' ? t('availability.newBadge') : null,
  ]
    .filter((parte): parte is string => typeof parte === 'string' && parte !== '')
    .join('. ');

  const cuerpo = (
    <View
      style={[
        estilos.chip,
        // Si se pulsa, llega al mínimo táctil: es un botón, aunque parezca una etiqueta.
        onPress === undefined ? null : estilos.pulsable,
        { backgroundColor: tono.fondo, borderColor: tono.borde },
      ]}
    >
      {/* El icono no se separa de su texto: lo que envuelve es la palabra, a su lado. */}
      <Row gap={spacing.xs} align="center">
        <Ionicons name={ICONO[fila.type]} size={14} color={tono.tinta} />
        <AppText variant="label" style={[estilos.texto, { color: tono.tinta }]}>
          {nombre === undefined ? texto : `${nombre} · ${texto}`}
        </AppText>
        {fila.status === 'new' ? (
          <View
            style={[estilos.nuevo, { backgroundColor: aviso.solido }]}
            testID={testID === undefined ? undefined : `${testID}-nueva`}
          />
        ) : null}
      </Row>
      {conNota && fila.note !== null ? (
        <AppText variant="label" tone="muted">
          {fila.note}
        </AppText>
      ) : null}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={etiqueta} testID={testID} style={estilos.envoltorio}>
        {cuerpo}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      testID={testID}
      style={({ pressed }) => [estilos.envoltorio, pressed ? estilos.pulsado : null]}
    >
      {cuerpo}
    </Pressable>
  );
}

const useEstilos = estilosDelTema(() => ({
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
  },
  pulsable: { minHeight: sizes.touchTargetMin, justifyContent: 'center' },
  texto: { flexShrink: 1, minWidth: 0 },
  /* NUNCA MÁS ANCHA QUE SU SITIO: con un nombre largo delante se salía del teléfono. */
  envoltorio: { maxWidth: '100%', flexShrink: 1, minWidth: 0 },
  nuevo: { width: 8, height: 8, borderRadius: 4 },
  pulsado: { opacity: 0.8 },
}));
