import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { AppText } from './app-text';
import { radii, sizes, spacing, type ColorSet } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * Botones de la app (§25).
 *
 * Reglas que impone este componente:
 * - un solo botón primario visualmente dominante por vista (§33);
 * - alto mínimo 52 en móvil y 64 en kiosco (§5);
 * - el nombre de la acción va completo en el botón, nunca solo un icono (§21);
 * - "Marcar salida" usa la variante `danger`, que no puede confundirse con
 *   "Iniciar descanso" (§33).
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

  const handlePress = () => {
    if (inactive) return;
    if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: isKiosk ? sizes.buttonKiosk : sizes.buttonMobile,
          borderRadius: isKiosk ? radii.kioskButton : radii.button,
          paddingHorizontal: isKiosk ? spacing.xl : spacing.lg,
        },
        variantStyles[variant].container,
        fullWidth ? styles.fullWidth : styles.autoWidth,
        pressed && !inactive ? variantStyles[variant].pressed : null,
        inactive ? styles.inactive : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].spinnerColor} />
      ) : (
        <View style={styles.labels}>
          <AppText
            variant={isKiosk ? 'section' : 'bodyStrong'}
            tone={variantStyles[variant].tone}
            numberOfLines={2}
            style={styles.centered}
          >
            {label}
          </AppText>
          {hint ? (
            <AppText variant="help" tone={variantStyles[variant].hintTone} style={styles.centered}>
              {hint}
            </AppText>
          ) : null}
        </View>
      )}
    </Pressable>
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
      hintTone: 'onPrimary' as const,
      // El aspa de carga va del mismo color que el texto de encima, no blanco fijo: en
      // oscuro el acento se aclara y un aspa blanca encima casi no se ve.
      spinnerColor: colors.onPrimary,
    },
    secondary: {
      container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
      pressed: { backgroundColor: colors.primary50 },
      tone: 'default' as const,
      hintTone: 'subtle' as const,
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
      hintTone: 'danger' as const,
      spinnerColor: colors.danger600,
    },
    ghost: {
      container: { backgroundColor: 'transparent', borderWidth: 0 },
      pressed: { backgroundColor: colors.primary50 },
      tone: 'primary' as const,
      hintTone: 'subtle' as const,
      spinnerColor: colors.primary600,
    },
  }) as const;

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  fullWidth: { alignSelf: 'stretch' },
  autoWidth: { alignSelf: 'flex-start' },
  labels: { alignItems: 'center', gap: spacing.xs },
  centered: { textAlign: 'center' },
  inactive: { opacity: 0.45 },
});
