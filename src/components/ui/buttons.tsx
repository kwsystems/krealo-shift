import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { AppText } from './app-text';
import { borderWidth, radii, sizes, spacing, type ColorSet } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * Botones de la app (§25).
 *
 * Reglas que impone este componente:
 * - un solo botón primario visualmente dominante por vista (§33);
 * - alto EXACTO 52 en móvil y 64 en kiosco (§5);
 * - el nombre de la acción va completo en el botón, nunca solo un icono (§21);
 * - "Marcar salida" usa la variante `danger`, que no puede confundirse con
 *   "Iniciar descanso" (§33).
 *
 * EL ALTO ES FIJO, Y ANTES ERA MÍNIMO. La diferencia es la que hacía que una fila de
 * botones nunca estuviera alineada: `hint` se pintaba DENTRO del recuadro, así que
 * "Reiniciar PIN / Se muestra una sola vez" medía dos líneas y "Editar", al lado, una.
 * Tres botones juntos daban tres alturas, y el conjunto se leía como tres controles de
 * tres sitios distintos en vez de tres opciones de la misma decisión.
 *
 * Ahora la pista va DEBAJO del recuadro, como texto de ayuda. No es solo alineación:
 * una explicación metida dentro de un botón compite con su propia etiqueta justo en el
 * momento en que hay que leerla —el nombre de la acción deja de ser lo primero que se
 * ve—. Fuera, el botón dice qué hace y la línea de abajo matiza, que es el orden en que
 * se lee de verdad.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'mobile' | 'kiosk';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Texto adicional bajo la etiqueta, para dar contexto sin abrir un modal. */
  hint?: string;
  /** Ocupa todo el ancho disponible. Por defecto sí, para que sea fácil de tocar. */
  fullWidth?: boolean;
  haptic?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: ViewStyle;
};

/**
 * `onPress` para un botón que va dentro de un `<Link asChild>`.
 *
 * EXISTE PARA QUE UN BOTÓN MUERTO NO SE PAREZCA A UNO VÁLIDO.
 *
 * `onPress` es obligatorio, y cuando el que navega es el `Link` de encima, el botón no
 * tiene nada que hacer al pulsarse. Eso se escribía `onPress={() => undefined}`, que
 * es EXACTAMENTE lo mismo que se escribe cuando alguien deja un botón sin implementar.
 * Así sobrevivió meses a la vista "Olvidé mi contraseña": un control que se veía, se
 * pulsaba y no hacía nada, indistinguible de los dos usos legítimos que hay al lado.
 *
 * Con un nombre, los dos casos se distinguen leyendo, y `scripts/coherencia-check.mjs`
 * puede prohibir el resto sin falsos positivos.
 */
export const pressHandledByLink = (): void => undefined;

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  size = 'mobile',
  disabled = false,
  loading = false,
  hint,
  fullWidth = true,
  haptic = true,
  accessibilityHint,
  testID,
  style,
}: Props) {
  const { colors } = useTheme();
  const variantStyles = estiloDeVariante(colors);
  const isKiosk = size === 'kiosk';
  const inactive = disabled || loading;

  /**
   * APAGADO NO ES «LO MISMO PERO DESVAÍDO», y eso es lo que había: un `opacity: 0.45`
   * sobre el botón entero. Atenuar a la vez el fondo y el texto no baja el contraste
   * entre ellos a la mitad, lo DESTRUYE, porque los dos se acercan al mismo fondo de la
   * página. En «Enviar invitación» —tinta oscura sobre morado claro en tema oscuro— el
   * texto y su fondo quedaban a 1,5:1: un rectángulo morado liso, sin nada escrito.
   * Medido en el navegador, y el botón está apagado casi todo el rato, porque solo se
   * enciende cuando el correo es válido.
   *
   * Un control apagado pierde su color de acento —eso es lo que comunica que no se
   * puede pulsar— pero conserva su contraste: lienzo con borde y tinta apagada, 5,77:1
   * en oscuro y 4,70:1 en claro. Los dos pasan el mínimo de 4,5:1.
   *
   * `loading` NO entra aquí: no es un botón apagado, es un botón trabajando, y tiene que
   * seguir pareciendo el que se acaba de pulsar.
   */
  const apagado = disabled && !loading;

  const handlePress = () => {
    if (inactive) return;
    if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const boton = (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      // La pista pasa a ser la ayuda de accesibilidad cuando no hay otra: quien navega
      // con lector de pantalla oía las dos líneas seguidas y no puede perderlas ahora
      // que están en dos nodos distintos.
      accessibilityHint={accessibilityHint ?? hint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: isKiosk ? sizes.buttonKiosk : sizes.buttonMobile,
          borderRadius: isKiosk ? radii.kioskButton : radii.button,
          paddingHorizontal: isKiosk ? spacing.xl : spacing.lg,
        },
        variantStyles[variant].container,
        pressed && !inactive ? variantStyles[variant].pressed : null,
        apagado
          ? {
              backgroundColor: colors.canvas,
              borderWidth: borderWidth.hairline,
              borderColor: colors.border,
            }
          : null,
        // El estilo del llamante va al RECUADRO y no al envoltorio: es donde se
        // escribía antes, cuando el recuadro era la raíz del componente.
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].spinnerColor} />
      ) : (
        <AppText
          variant={isKiosk ? 'section' : 'bodyStrong'}
          tone={apagado ? 'subtle' : variantStyles[variant].tone}
          // UNA LÍNEA, porque con alto fijo la segunda se cortaría por la mitad y eso
          // se lee como un fallo de pintado. Recortada con puntos suspensivos se lee
          // como lo que es: un nombre que no cabe, y que hay que acortar en el texto.
          numberOfLines={1}
          style={styles.centered}
        >
          {label}
        </AppText>
      )}
    </Pressable>
  );

  /**
   * SIEMPRE ENVUELTO, tenga pista o no, y no por simetría: dentro de un `Row` el
   * alineado vertical lo decide el padre (`alignItems: 'center'` por omisión), así que
   * un botón con pista y otro sin ella se centrarían cada uno por su cuenta y los
   * recuadros quedarían a distinta altura otra vez. Con el envoltorio en `flex-start`
   * lo que se alinea es la parte de arriba, que es la que se compara al mirar.
   */
  return (
    <View style={fullWidth ? styles.fullWidth : styles.autoWidth}>
      {boton}
      {hint ? (
        <AppText variant="help" tone="subtle" style={[styles.centered, styles.hint]}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export const PrimaryButton = (props: Omit<Props, 'variant'>) => (
  <AppButton {...props} variant="primary" />
);
export const SecondaryButton = (props: Omit<Props, 'variant'>) => (
  <AppButton {...props} variant="secondary" />
);
export const DangerButton = (props: Omit<Props, 'variant'>) => (
  <AppButton {...props} variant="danger" />
);
export const GhostButton = (props: Omit<Props, 'variant'>) => (
  <AppButton {...props} variant="ghost" />
);

/**
 * El aspecto de cada variante de botón, como FUNCIÓN del juego de color.
 *
 * Era un objeto constante, así que el color de TODOS los botones de la app quedaba
 * congelado al cargar este módulo. No usa `StyleSheet.create`, y por eso no apareció en
 * el barrido de hojas de estilo: lo encontró un segundo barrido de colores declarados
 * fuera de cualquier función.
 *
 * El `#FFE3E6` escrito a mano que había en `danger.pressed` —el único color literal que
 * quedaba en el proyecto— era además el que no podía adaptarse a nada. Ahora sale del
 * token del tema.
 */
const estiloDeVariante = (colors: ColorSet) =>
  ({
    primary: {
      container: { backgroundColor: colors.primary500, borderWidth: 0 },
      pressed: { backgroundColor: colors.primary600 },
      tone: 'onPrimary' as const,
      // El aspa de carga va del mismo color que el texto de encima, no blanco fijo: en
      // oscuro el acento se aclara y un aspa blanca encima casi no se ve.
      spinnerColor: colors.onPrimary,
    },
    secondary: {
      container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
      pressed: { backgroundColor: colors.primary50 },
      tone: 'default' as const,
      spinnerColor: colors.primary600,
    },
    danger: {
      container: {
        backgroundColor: colors.danger50,
        borderWidth: 1,
        borderColor: colors.danger600,
      },
      pressed: { backgroundColor: colors.danger100 },
      tone: 'danger' as const,
      spinnerColor: colors.danger600,
    },
    ghost: {
      container: { backgroundColor: 'transparent', borderWidth: 0 },
      pressed: { backgroundColor: colors.primary50 },
      tone: 'primary' as const,
      spinnerColor: colors.primary600,
    },
  }) as const;

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  fullWidth: { alignSelf: 'stretch' },
  autoWidth: { alignSelf: 'flex-start' },
  centered: { textAlign: 'center' },
  hint: { marginTop: spacing.xs },
});
