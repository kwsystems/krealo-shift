import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, ResponsiveContainer, Stack } from '@/components/ui/layout';
import { useKioskStore } from '@/stores/kiosk-store';
import { spacing } from '@/theme/tokens';

/**
 * El dispositivo no es un reloj y alguien abrió una pantalla del kiosco (§20).
 *
 * SIN CREDENCIAL DE KIOSCO ESTAS PANTALLAS ERAN CALLEJONES SIN SALIDA.
 *
 * Los manejadores del kiosco empiezan con `if (binding === null) return;`, así que
 * se podía teclear el PIN completo —los seis puntos se llenaban— y NO PASABA
 * ABSOLUTAMENTE NADA: ni validación, ni mensaje, ni cambio de estado. Para siempre.
 * Lo encontró el chequeo de interacción, que teclea un PIN de verdad; el de render
 * lo daba por bueno porque la pantalla se pinta perfecta.
 *
 * Se llega ahí por un enlace directo, por la restauración de ruta al reiniciar la
 * app, con la credencial perdida del Keychain, antes de activar el dispositivo, y
 * sobre todo por la previsualización web, que es como se revisa esto desde Windows.
 *
 * Se muestra el ESTADO VACÍO CON SU SIGUIENTE ACCIÓN que pide §20, en vez de
 * redirigir: una redirección automática desde el reloj de una tienda haría que un
 * empleado que solo quería fichar acabe en una pantalla de administración sin
 * entender por qué. Aquí se dice qué pasa y quién lo arregla.
 */
export function KioskNotSetUpState() {
  const { t } = useTranslation();

  return (
    <AppScreen tone="kiosk" testID="kiosk-not-set-up">
      <ResponsiveContainer width="form">
        <Stack gap={spacing.md} style={styles.centered}>
          <AppText variant="kioskTitle" style={styles.centerText}>
            {t('kiosk.notSetUpTitle')}
          </AppText>
          <AppText variant="body" tone="muted" style={styles.centerText}>
            {t('kiosk.notSetUpBody')}
          </AppText>
          <SecondaryButton
            label={t('kiosk.notSetUpAction')}
            onPress={() => router.push('/kiosk/setup')}
            testID="kiosk-go-to-setup"
          />
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

/**
 * ¿Hay que mostrar el estado vacío en lugar de la pantalla del kiosco?
 *
 * `hydrated` es imprescindible: antes de leer el Keychain el binding es null y
 * todavía no se sabe nada. Sin esa condición, esto se mostraría un instante en
 * cada arranque de un kiosco perfectamente configurado.
 *
 * La condición vive aquí, en un solo sitio, porque la comprueban el layout del
 * kiosco —que cubre todas sus rutas— y la pantalla de salida, que está exenta del
 * layout por el motivo escrito en `app/kiosk/exit.tsx`.
 */
export function useKioskNotSetUp(): boolean {
  const hydrated = useKioskStore((s) => s.hydrated);
  const binding = useKioskStore((s) => s.binding);
  return hydrated && binding === null;
}

const styles = StyleSheet.create({
  centerText: { textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
