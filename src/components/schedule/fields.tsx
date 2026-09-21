import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Switch, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { Card, Row } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import {
  borderWidth,
  radii,
  shadows,
  sizes,
  spacing,
  paletaDeEstado,
  type StatusTone,
} from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';

/**
 * Controles compartidos del panel administrativo.
 *
 * Viven en `components/schedule` porque el alcance de esta tarea no permite crear
 * `components/ui`, que es donde deberían estar: los usan también Equipo, Horas,
 * Solicitudes y Configuración. Cuando `components/ui` esté libre, este archivo se
 * mueve tal cual.
 *
 * Reglas que imponen estos controles (§21, §33):
 *   - objetivo táctil mínimo 44 y preferible 52;
 *   - el estado seleccionado se comunica con texto, borde e icono, nunca solo con
 *     color, y se expone a VoiceOver con `accessibilityState.selected`;
 *   - ningún valor visual sale de fuera de `theme/tokens`.
 */

type IconName = keyof typeof Ionicons.glyphMap;

export type Option<T extends string> = {
  value: T;
  label: string;
  /** Texto secundario: sirve para explicar una opción delicada sin abrir un modal. */
  hint?: string;
};

/** Fila etiqueta + valor. La base de los detalles y del historial. */
export function KeyValueRow({
  label,
  value,
  tone = 'default',
  testID,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'danger' | 'success';
  testID?: string;
}) {
  const styles = useEstilos();
  return (
    <Row justify="space-between" gap={spacing.md} align="flex-start" style={styles.keyValue}>
      <AppText variant="help" tone="subtle" style={styles.keyValueLabel}>
        {label}
      </AppText>
      <AppText
        variant="bodyStrong"
        tone={tone === 'default' ? 'default' : tone === 'muted' ? 'muted' : tone}
        tabular
        style={styles.keyValueValue}
        testID={testID}
      >
        {value}
      </AppText>
    </Row>
  );
}

/**
 * Tarjeta compacta de cifra del inicio administrativo (§11.1).
 * El número va con su etiqueta completa: un número suelto no dice nada.
 *
 * EL COLOR ES LA EXCEPCIÓN, NO EL ADORNO, y antes era al revés.
 *
 * `tone` venía con `'info'` por defecto y teñía el fondo, el borde, la etiqueta Y la
 * cifra. Como cada sitio elegía un tono distinto para que las tarjetas «se
 * distinguieran», en Horas salían cinco tarjetas con cinco colores —`info`,
 * `working`, `onBreak`, `offShift`, `late`— y en Reportes «Llegó a tiempo 80%»
 * aparecía en ROJO DE PELIGRO, porque el tono elegido fue `late`.
 *
 * Tres cosas se rompen con eso:
 *
 *   1. **El color deja de significar.** Si cinco cifras vecinas llevan cinco colores,
 *      el color ya no dice «mira esto», dice «soy la tercera tarjeta». Cuando de
 *      verdad hay algo que atender —una jornada sin cerrar— no queda ningún color
 *      libre con el que gritarlo.
 *   2. **Miente.** Un 80% de puntualidad no es un error. Pintarlo del mismo rojo que
 *      una incidencia entrena a la gente a ignorar el rojo, que es lo último que se
 *      quiere en la pantalla donde aparecen las incidencias de verdad.
 *   3. **Aplana la jerarquía.** El dato que importa compite con otros cuatro marcos
 *      igual de llamativos.
 *
 * Ahora: sin `tone`, la tarjeta es neutra —superficie, borde fino, cifra en tinta
 * principal— y no compite con nadie. Con `tone`, el borde y el icono toman el color,
 * pero LA CIFRA NO: el borde ya señala la excepción, y teñir también el número lo
 * convierte en un cartel y deja de leerse como un dato.
 *
 * Si una fila entera necesita tonos, la fila está mal pensada, no mal pintada.
 */
export function StatTile({
  label,
  value,
  tone,
  icon,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  /** SOLO cuando el número es una excepción que pide acción. Por defecto, neutra. */
  tone?: StatusTone;
  icon?: IconName;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const palette = tone === undefined ? null : paletaDeEstado(colors)[tone];
  const content = (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: colors.surface,
          borderColor: palette === null ? colors.border : palette.border,
        },
      ]}
    >
      <Row gap={spacing.xs}>
        {icon !== undefined ? (
          <Ionicons name={icon} size={16} color={palette === null ? colors.ink500 : palette.fg} />
        ) : null}
        <AppText variant="label" tone={palette === null ? 'subtle' : undefined}>
          {label}
        </AppText>
      </Row>
      <AppText variant="section" tabular>
        {value}
      </AppText>
    </View>
  );

  if (onPress === undefined) {
    return (
      <View
        style={styles.tileWrap}
        accessible
        accessibilityLabel={`${label}: ${value}`}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.tileWrap}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

/** Selector de una opción. En pantallas anchas se ve completo; en iPhone, con scroll. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  emptyLabel,
  testID,
}: {
  label: string;
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  emptyLabel?: string;
  testID?: string;
}) {
  const styles = useEstilos();
  return (
    <View style={styles.field} testID={testID}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      {options.length === 0 && emptyLabel !== undefined ? (
        <AppText variant="help" tone="subtle">
          {emptyLabel}
        </AppText>
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.chipRow}>
          {options.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              hint={option.hint}
              selected={option.value === value}
              onPress={() => onChange(option.value)}
              testID={`${testID ?? 'select'}-${option.value}`}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** Selector múltiple: ubicaciones y puestos de un empleado (§11.2). */
export function MultiSelectField<T extends string>({
  label,
  values,
  options,
  onToggle,
  emptyLabel,
  testID,
}: {
  label: string;
  values: T[];
  options: Option<T>[];
  onToggle: (value: T) => void;
  emptyLabel?: string;
  testID?: string;
}) {
  const styles = useEstilos();
  return (
    <View style={styles.field} testID={testID}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      {options.length === 0 && emptyLabel !== undefined ? (
        <AppText variant="help" tone="subtle">
          {emptyLabel}
        </AppText>
      ) : (
        <Row wrap gap={spacing.sm} align="flex-start">
          {options.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={values.includes(option.value)}
              onPress={() => onToggle(option.value)}
              testID={`${testID ?? 'multi'}-${option.value}`}
            />
          ))}
        </Row>
      )}
    </View>
  );
}

export function Chip({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={hint === undefined ? label : `${label}. ${hint}`}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      {/* El check no es decorativo: sin él, la selección sería solo color (§21). */}
      {selected ? <Ionicons name="checkmark" size={14} color={colors.primary700} /> : null}
      <AppText variant="label" tone={selected ? 'primary' : 'muted'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Interruptor con etiqueta y explicación. */
export function ToggleField({
  label,
  hint,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  return (
    <Row justify="space-between" gap={spacing.md} align="center" style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint !== undefined ? (
          <AppText variant="help" tone="subtle">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ false: colors.border, true: colors.primary200 }}
        thumbColor={value ? colors.primary600 : colors.surface}
        testID={testID}
      />
    </Row>
  );
}

/** Control segmentado: vista semanal/diaria, pestañas de solicitudes, secciones. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  testID?: string;
}) {
  const styles = useEstilos();
  return (
    <View accessibilityLabel={label} style={styles.segmentWrapper} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            testID={`${testID ?? 'segment'}-${option.value}`}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <AppText variant="label" tone={selected ? 'primary' : 'muted'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Hoja modal para formularios largos (§25 ConfirmSheet es para confirmar; esto es
 * para editar). En iPad se centra con ancho de formulario en lugar de estirarse
 * de lado a lado (§33).
 */
export function AdminSheet({
  visible,
  title,
  onClose,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const styles = useEstilos();
  const { t } = useTranslation();
  const { isWide } = useResponsive();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, isWide ? styles.backdropCentered : null]}>
        <Pressable
          style={styles.backdropTouchable}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        {/*
          EL RELLENO LATERAL LO PONE CADA FRANJA, NO LA HOJA, y ese detalle es justo lo
          que hacía que la barra de desplazamiento pareciera pegada de adorno: con el
          relleno en la hoja, el `ScrollView` empezaba 24 px hacia dentro y su barra
          quedaba flotando en mitad del margen, sin borde al que agarrarse. Puesta en el
          contenido, la barra roza el borde de la hoja —que es donde el ojo la busca— y
          el texto conserva su margen igual.
        */}
        <View style={[styles.sheet, isWide ? styles.sheetWide : null]} testID={testID}>
          <Row justify="space-between" align="center" style={styles.sheetHeader}>
            <AppText variant="section" style={styles.sheetTitle}>
              {title}
            </AppText>
            <GhostButton label={t('common.close')} onPress={onClose} fullWidth={false} />
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            {children}
          </ScrollView>
          {/*
            La línea de arriba solo aparece cuando hay pie. No es decoración: el cuerpo
            se desplaza POR DEBAJO del pie, y sin nada que marque el corte, la última
            fila visible parece la última que hay.
          */}
          {footer === undefined ? null : <View style={styles.sheetFooter}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

/** Aviso en línea, para advertencias que no bloquean (§20). */
export function InlineNotice({
  tone = 'info',
  title,
  body,
  icon,
  action,
  testID,
}: {
  tone?: StatusTone;
  /**
   * Opcional: un aviso de una sola frase no necesita titular. Antes era
   * obligatorio y obligaba a partir en dos una frase que se lee mejor entera, o a
   * inventar un titular de relleno.
   */
  title?: string;
  body?: string;
  icon?: IconName;
  action?: ReactNode;
  /** Los flujos de `e2e/` afirman sobre los avisos: hace falta poder señalarlos. */
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const palette = paletaDeEstado(colors)[tone];
  const resolvedIcon: IconName = icon ?? 'information-circle-outline';
  // Con un solo texto se usa `bodyStrong`, que es como se veía antes el titular:
  // un aviso de una frase en tipografía de ayuda se pierde entre las filas.
  const soloUno = title === undefined || body === undefined;

  return (
    <View
      accessibilityRole="alert"
      testID={testID}
      style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]}
    >
      <Row gap={spacing.sm} align="flex-start">
        <Ionicons name={resolvedIcon} size={sizes.iconMobile} color={palette.fg} />
        <View style={styles.noticeText}>
          {title !== undefined ? (
            <AppText variant="bodyStrong" style={{ color: palette.fg }}>
              {title}
            </AppText>
          ) : null}
          {body !== undefined ? (
            <AppText variant={soloUno ? 'bodyStrong' : 'help'} style={{ color: palette.fg }}>
              {body}
            </AppText>
          ) : null}
          {action}
        </View>
      </Row>
    </View>
  );
}

/** Barra de comparación con un límite configurado (§11.3). */
export function LimitBar({
  label,
  value,
  limit,
  valueLabel,
  testID,
}: {
  label: string;
  value: number;
  limit: number;
  valueLabel: string;
  testID?: string;
}) {
  const styles = useEstilos();
  const ratio = limit <= 0 ? 0 : Math.min(1, value / limit);
  const over = limit > 0 && value > limit;

  return (
    <View
      style={styles.field}
      accessible
      accessibilityLabel={`${label}: ${valueLabel}`}
      testID={testID}
    >
      <Row justify="space-between">
        <AppText variant="help" tone="subtle">
          {label}
        </AppText>
        <AppText variant="label" tone={over ? 'danger' : 'muted'} tabular>
          {valueLabel}
        </AppText>
      </Row>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.round(ratio * 100)}%` },
            over ? styles.barFillOver : null,
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Tarjeta con título y contenido, para agrupar formularios.
 *
 * PUEDE PLEGARSE, y en Ajustes se pliega. Esa pantalla son nueve tarjetas seguidas
 * —idioma, tema, empresa, sede, accesos, PIN, relojes, avisos, sesión y «acerca de»—
 * en un scroll de más de 1.800 px: encontrar «tolerancia de tardanza» era bajar a ojo
 * leyendo títulos. Plegadas, la pantalla entera cabe de un vistazo y se abre lo que se
 * busca, que es lo que uno hace de todas formas.
 *
 * EL CONTENIDO NO SE MONTA HASTA QUE SE ABRE, y una vez abierto YA NO SE DESMONTA. Las
 * dos mitades importan y por motivos distintos. No montarlo de entrada evita que
 * Ajustes lance a la vez todas las consultas de todas sus secciones —quién tiene
 * acceso, los relojes, los avisos— para enseñar ocho de ellas cerradas. Y no
 * desmontarlo al cerrar evita perder lo escrito: quien está editando el nombre de la
 * empresa, pliega la tarjeta para mirar otra cosa y vuelve, encuentra su texto.
 *
 * SIN ANIMACIÓN DE ALTURA, a propósito. Animarla en React Native exige medir el
 * contenido, y en web `LayoutAnimation` no hace nada, que es justo donde se usa esto.
 * Una apertura instantánea no es una carencia: es la respuesta más rápida posible a un
 * toque, y lo que de verdad se nota es el retardo, no la falta de transición.
 */
export function FormCard({
  title,
  description,
  children,
  style,
  collapsible = false,
  defaultOpen = false,
  testID,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  style?: ViewStyle;
  collapsible?: boolean;
  /** Solo la primera sección de una lista debería abrir de entrada. */
  defaultOpen?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const [abierta, setAbierta] = useState(defaultOpen);
  const [montada, setMontada] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <Card style={style} testID={testID}>
        <AppText variant="bodyStrong">{title}</AppText>
        {description !== undefined ? (
          <AppText variant="help" tone="subtle">
            {description}
          </AppText>
        ) : null}
        {children}
      </Card>
    );
  }

  return (
    <Card style={style} testID={testID}>
      <Pressable
        onPress={() => {
          setMontada(true);
          setAbierta((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityLabel={title}
        // `expanded` es lo que hace que un lector de pantalla lo anuncie como algo que
        // se abre y no como un botón cualquiera. Sin esto, la pantalla se puede usar
        // pero no se entiende: nada dice que haya contenido detrás del título.
        accessibilityState={{ expanded: abierta }}
        testID={testID === undefined ? undefined : `${testID}-toggle`}
        style={({ pressed }) => [styles.cabeceraPlegable, pressed ? styles.cabeceraPulsada : null]}
      >
        <View style={styles.noticeText}>
          <AppText variant="bodyStrong">{title}</AppText>
          {description !== undefined ? (
            <AppText variant="help" tone="subtle">
              {description}
            </AppText>
          ) : null}
        </View>
        <Ionicons
          name={abierta ? 'chevron-up' : 'chevron-down'}
          size={sizes.iconMobile}
          color={colors.ink500}
        />
      </Pressable>

      {/*
        Oculto con `display: 'none'` y no quitado del árbol: así conserva lo escrito y
        además no deja hueco, porque un hijo sin display no cuenta para el `gap` de la
        tarjeta. Quitarlo del árbol haría las dos cosas mal.

        El `gap` se repite aquí porque los hijos dejan de ser hijos directos de `Card`,
        que es quien lo ponía.
      */}
      {montada ? (
        <View style={[styles.cuerpoPlegable, abierta ? null : styles.oculto]}>{children}</View>
      ) : null}
    </Card>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  field: { gap: spacing.xs },
  keyValue: { minHeight: spacing.xl },
  keyValueLabel: { flexShrink: 1 },
  keyValueValue: { flexShrink: 1, textAlign: 'right' },
  /*
   * LAS TARJETAS CRECEN PARA LLENAR SU FILA, y antes medían 132 fijos.
   *
   * Con un ancho fijo dentro de una fila que envuelve, el sobrante se quedaba al final
   * de cada línea: en Horas, cinco tarjetas daban tres arriba y dos abajo, y la quinta
   * —«Necesita revisión», justo la única que pide acción— se quedaba sola y descolgada,
   * como si se hubiera caído de la fila. No era un fallo suyo: era el hueco de al lado.
   *
   * `flexBasis` manda dónde se parte la fila (sigue partiendo a los 132, o sea igual que
   * antes) y `flexGrow` reparte lo que sobra entre las que hayan caído en esa línea. El
   * borde derecho queda recto, que es lo que hace que se lean como una sola fila de
   * cifras y no como tarjetas sueltas.
   */
  tileWrap: { flexGrow: 1, flexBasis: 132, minWidth: 132 },
  tile: {
    flex: 1,
    minHeight: sizes.touchTargetPreferred + spacing.lg,
    gap: spacing.xs,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    justifyContent: 'center',
  },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary500,
    borderWidth: borderWidth.focus,
    backgroundColor: colors.primary50,
  },
  chipPressed: { backgroundColor: colors.primary100 },
  toggleRow: { minHeight: sizes.touchTargetPreferred },
  toggleText: { flex: 1, gap: spacing.xs },
  segmentWrapper: {
    flexDirection: 'row',
    backgroundColor: colors.canvas,
    borderRadius: radii.button,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: sizes.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    borderWidth: borderWidth.hairline,
    borderColor: colors.primary200,
  },
  /*
   * NEGRO, Y ERA `rgba(25, 23, 42, 0.35)`. Ese valor es `ink900` del tema CLARO escrito
   * a mano, y por eso el velo no velaba nada en oscuro: el lienzo oscuro es #131118, o
   * sea MÁS OSCURO que el propio velo, así que en vez de atenuar el fondo lo ACLARABA un
   * poco. Se ve en cuanto se abre cualquier confirmación en tema oscuro: el panel de
   * detrás se sigue leyendo entero y el diálogo no separa de nada.
   *
   * Una sombra es ausencia de luz en los dos temas —el mismo razonamiento que hay en
   * `shadows.card`—, así que el velo es negro literal y lo que cambia es cuánto se nota
   * sobre lo que haya debajo. Con 0,45 el fondo queda legible pero claramente detrás,
   * que es lo que pide una tarea modal: atenuar para enfocar, no tapar.
   */
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  backdropCentered: { justifyContent: 'center', alignItems: 'center' },
  /*
   * ABSOLUTO, Y ERA `flex: 1`. Ahí estaba la hoja descolocada.
   *
   * El fondo y la hoja eran dos hermanos en una columna. Mientras la columna alineaba
   * a lo ancho por omisión (`stretch`), el hermano de arriba medía todo el ancho y
   * hacía de zona de cierre. Pero en pantalla ancha la columna pasa a
   * `alignItems: 'center'`, y entonces un hijo sin contenido ni ancho propio se encoge
   * a CERO: la zona de cierre desaparecía —tocar fuera no cerraba— y, como seguía con
   * `flex: 1`, se quedaba con todo el alto sobrante y empujaba la hoja contra el borde
   * de abajo. Centrar no centraba nada.
   *
   * Fuera del flujo no compite por espacio: cubre el modal entero para cerrar al tocar
   * y deja que la hoja se coloque donde diga la columna. La hoja va DESPUÉS en el
   * árbol, así que queda por encima sin necesidad de z-index.
   */
  backdropTouchable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingTop: spacing.base,
    maxHeight: '85%',
    ...shadows.floating,
  },
  sheetWide: {
    borderRadius: radii.card,
    width: 560,
    maxWidth: '92%',
    marginBottom: 0,
  },
  sheetHeader: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  sheetTitle: { flexShrink: 1 },
  sheetBody: { gap: spacing.base, paddingHorizontal: spacing.xl, paddingBottom: spacing.base },
  sheetFooter: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
    paddingBottom: spacing.xxl,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: colors.border,
  },
  notice: {
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    padding: spacing.md,
  },
  noticeText: { flex: 1, gap: spacing.xs },
  cabeceraPlegable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: sizes.touchTargetMin,
  },
  cabeceraPulsada: { opacity: 0.6 },
  cuerpoPlegable: { gap: spacing.md },
  oculto: { display: 'none' },
  barTrack: {
    height: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.canvas,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.primary500 },
  barFillOver: { backgroundColor: colors.danger600 },
}));
