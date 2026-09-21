import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTheme } from '@/theme/use-theme';

/**
 * Campo de formulario con etiqueta, foco visible y error accesible.
 *
 * VIVÍA DENTRO DE `app/(auth)/sign-in.tsx` y lo importaban cinco archivos desde
 * allí: la configuración del kiosco, el PIN olvidado, el detalle de una sesión, el
 * panel de solicitudes y el formulario de turnos. Su propia prueba ya estaba en
 * `src/components/ui/__tests__/`, apuntando a la pantalla de acceso.
 *
 * Se mudó aquí al quitar el formulario de correo y contraseña: la pantalla que lo
 * alojaba ya no tiene ni un campo de texto, así que dejarlo ahí habría sido
 * conservar un archivo de pantalla por su exportación secundaria.
 */
export function FormField({
  label,
  error,
  testID,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      <TextInput
        {...inputProps}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={error}
        placeholderTextColor={colors.ink500}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused ? styles.inputFocused : null,
          error !== undefined ? styles.inputError : null,
        ]}
      />
      {error !== undefined ? (
        <AppText variant="help" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  field: { gap: spacing.xs },
  input: {
    minHeight: sizes.touchTargetPreferred,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.ink900,
  },
  // El foco visible no se quita nunca (§21).
  inputFocused: { borderColor: colors.primary500, borderWidth: borderWidth.focus },
  inputError: { borderColor: colors.danger600 },
}));
