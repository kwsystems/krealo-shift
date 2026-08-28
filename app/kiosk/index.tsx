import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { NumericKeypad, PinDots } from '@/components/attendance/pin-pad';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { LanguageSwitch } from '@/components/ui/language-switch';
import { SyncIndicator } from '@/components/ui/states';
import { verifyPin } from '@/features/kiosk/api';
import { logoPublicUrl } from '@/features/settings/logo';
import { buildOfflineSession, cacheAttendanceState } from '@/features/kiosk/offline-session';
import { useKioskVerificationStore } from '@/features/kiosk/verification-store';
import { verifyPinOffline } from '@/lib/offline/pin';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useResponsive } from '@/hooks/use-responsive';
import { DEFAULT_KIOSK_POLICIES, useKioskStore } from '@/stores/kiosk-store';
import { useNetworkStore } from '@/stores/network-store';
import { usePreferencesStore } from '@/stores/preferences-store';
import { colors, fontSize, sizes, spacing } from '@/theme/tokens';
import { formatClockTime, formatLongDate } from '@/utils/time';

/**
 * Pantalla de reposo del kiosco (especificación §9.1).
 *
 * Decisiones que se ven aquí:
 * - la hora es el elemento dominante y se lee a un brazo de distancia (§33);
 * - el PIN se valida solo al completarse, sin botón "Aceptar" (§9.1);
 * - nunca se muestra la lista de personal antes de validar un PIN (§9.2);
 * - el logotipo con pulsación larga de 3 segundos es la única salida del kiosco,
 *   y existe alternativa administrativa, así que no es un gesto oculto
 *   imprescindible para tareas normales (§21).
 */

const EXIT_LONG_PRESS_MS = 3000;

export default function KioskIdleScreen() {
  const { t } = useTranslation();
  const { scaleFont, isWide, isCompact } = useResponsive();
  const now = useLiveClock('second');

  const binding = useKioskStore((s) => s.binding);
  // Se compone al pintar y no se guarda: una URL guardada queda inservible si el
  // proyecto de Supabase cambia de dominio, que es lo que pasa al pasar de un
  // proyecto de pruebas a uno de verdad.
  const logoUrl = logoPublicUrl(binding?.organizationLogoPath ?? null);
  const revoked = useKioskStore((s) => s.revoked);
  const hydrated = useKioskStore((s) => s.hydrated);
  const markRevoked = useKioskStore((s) => s.markRevoked);
  const language = usePreferencesStore((s) => s.language);
  const { online, syncing, pendingCount } = useNetworkStore();
  const setFromOnline = useKioskVerificationStore((s) => s.setFromOnline);
  const setFromOffline = useKioskVerificationStore((s) => s.setFromOffline);

  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policies = binding?.policies ?? DEFAULT_KIOSK_POLICIES;
  const timezone = binding?.timezone ?? 'America/Lima';
  const pinLength = policies.pinLength;

  const clearPin = useCallback(() => {
    setPin('');
    setError(null);
  }, []);

  const submit = useCallback(
    async (candidate: string) => {
      if (binding === null) return;
      setChecking(true);

      // `finally` PARA LIMPIAR EL ESTADO SIEMPRE. Si `verifyPin` lanzara,
      // `setChecking(false)` no correria y el teclado se quedaria en "comprobando"
      // para siempre: el empleado de pie frente al iPad, sin mensaje y sin poder
      // fichar. Eso pasaba de verdad, porque `invoke` leia el Keychain fuera de su
      // try. Ya no lanza, y esto es la segunda linea de defensa: la interfaz no debe
      // poder colgarse porque una capa de abajo se equivoque otra vez.
      let result: Awaited<ReturnType<typeof verifyPin>>;
      try {
        result = await verifyPin({ pin: candidate, locationId: binding.locationId });
      } catch {
        setError(t('errors.generic'));
        return;
      } finally {
        setChecking(false);
        setPin('');
      }

      if (result.ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFromOnline(result.data);
        // Se cachea el estado que confirmo el servidor: es de donde parte la
        // reconstruccion si despues se cae la red (§9.7).
        //
        // CON `catch`: es una escritura en SQLite y puede fallar. Un fallo aqui NO
        // debe impedir el fichaje —el servidor ya valido el PIN, la persona esta
        // dentro— pero sin el `catch` era un rechazo sin capturar. Se pierde la
        // capacidad de fichar sin red hasta el siguiente PIN, y eso es aceptable;
        // bloquear la entrada al trabajo por una cache no lo es.
        void cacheAttendanceState({
          employeeOpaqueId: result.data.employee.opaqueId,
          attendanceState: result.data.attendanceState,
          shiftId: result.data.eligibleShifts[0]?.id ?? null,
          sessionStartedAt: result.data.openSession?.startedAt ?? null,
          takenBreakMinutes: result.data.openSession?.takenBreakMinutes ?? 0,
        }).catch(() => undefined);
        router.push('/kiosk/actions');
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      switch (result.error.kind) {
        case 'invalid_pin':
          setError(t('kiosk.pinIncorrect'));
          break;
        case 'locked': {
          // No revelamos a quién corresponde el PIN bloqueado (§8).
          const minutes = minutesUntil(result.error.lockedUntil);
          setError(t('kiosk.pinLocked', { minutes }));
          break;
        }
        case 'revoked':
          // Se marca el estado, no solo el mensaje: el servidor acaba de decir que
          // este reloj ya no existe para el. Sin esto la pantalla de "reloj
          // desactivado" era inalcanzable y el iPad seguia pidiendo PIN que
          // siempre iban a fallar, sin decir por que.
          markRevoked();
          setError(t('errors.kioskRevoked'));
          break;
        case 'wrong_location':
          setError(t('errors.kioskWrongLocation'));
          break;
        case 'offline': {
          // Sin red se valida el PIN contra el verificador local del dispositivo,
          // que el servidor entrego al activar el kiosco (§9.7).
          const offline = await verifyPinOffline(candidate);

          if (offline.ok) {
            const session = await buildOfflineSession(offline.employeeOpaqueId);

            if (session.status === 'ready') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setFromOffline({
                employeeOpaqueId: offline.employeeOpaqueId,
                pinVersion: offline.pinVersion,
                session,
              });
              router.push('/kiosk/actions');
              return;
            }

            // No se conoce su estado: no se adivina. Ofrecerle una accion que el
            // servidor va a rechazar es peor que decirle la verdad.
            setError(t('kiosk.offlineStateUnknown'));
            break;
          }

          if (offline.reason === 'locked') {
            setError(t('kiosk.pinLocked', { minutes: minutesUntil(offline.lockedUntil) }));
          } else if (offline.reason === 'no_verifiers') {
            setError(t('kiosk.offlineNotReady'));
          } else if (offline.reason === 'no_device_key') {
            // Falta la clave del Keychain con la que se comprueban los
            // verificadores. Pasa en un iPad activado antes de este cambio: valida
            // online sin problema y hay que reactivarlo para volver a fichar sin
            // red. Se dice eso y no "PIN incorrecto", que seria mentira.
            setError(t('kiosk.offlineNeedsReactivation'));
          } else {
            setError(t('kiosk.pinIncorrect'));
          }
          break;
        }
        case 'not_configured':
          // Defensa en profundidad: con el guardián en el layout raíz esto ya no
          // debería alcanzarse. Pero antes caía en el genérico —"Inténtalo otra
          // vez"— que es un consejo imposible: reintentar no arregla que la app no
          // tenga servidor.
          setError(t('errors.notConfigured'));
          break;
        case 'device_credential':
          // NO se cae al camino offline. El PIN sin conexión se valida con la clave
          // del Keychain, que es justo lo que no se pudo leer: intentarlo daría un
          // "PIN incorrecto" que sería mentira. Se dice qué pasa y qué hacer.
          setError(t('errors.deviceCredential'));
          break;
        default:
          setError(t('errors.generic'));
      }
    },
    [binding, markRevoked, setFromOnline, setFromOffline, t],
  );

  // Validación automática al completar el PIN, sin botón "Aceptar" (§9.1).
  // Se dispara desde el manejador de la tecla y no desde un efecto: llamar a
  // setState dentro de un efecto provoca renders en cascada.
  const appendDigit = (digit: string) => {
    if (checking) return;
    setError(null);
    const next = pin.length >= pinLength ? pin : pin + digit;
    setPin(next);
    if (next.length === pinLength) void submit(next);
  };

  // SIN CREDENCIAL DE KIOSCO ESTA PANTALLA ERA UN CALLEJON SIN SALIDA.
  //
  // `submit` empieza con `if (binding === null) return;`, así que se podía teclear el
  // PIN completo —los seis puntos se llenaban— y NO PASABA ABSOLUTAMENTE NADA: ni
  // validación, ni mensaje, ni cambio de estado. Para siempre. Lo encontró el chequeo
  // de interacción nuevo, que teclea un PIN de verdad; el de render lo daba por bueno
  // porque la pantalla se pinta perfecta.
  //
  // Se llega aquí de tres formas: abriendo /kiosk directamente —un enlace, o la
  // previsualización web, que es justo como se revisa la app desde Windows—, con la
  // credencial perdida del Keychain, o antes de activar el dispositivo.
  //
  // Se muestra el ESTADO VACÍO CON SU SIGUIENTE ACCIÓN que pide §20, en vez de
  // redirigir: una redirección automática desde el reloj de una tienda haría que un
  // empleado que solo quería fichar acabe en una pantalla de administración sin
  // entender por qué. Aquí se dice qué pasa y quién lo arregla.
  //
  // `hydrated` es imprescindible: antes de leer el Keychain el binding es null y
  // todavía no se sabe nada. Sin esa condición, esto se mostraría un instante en cada
  // arranque de un kiosco perfectamente configurado.
  if (hydrated && binding === null) {
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

  if (revoked) {
    return (
      <AppScreen tone="kiosk" testID="kiosk-revoked">
        <Stack gap={spacing.md} style={styles.centered}>
          <AppText variant="kioskTitle">{t('kiosk.revokedTitle')}</AppText>
          <AppText variant="body" tone="muted">
            {t('kiosk.revokedBody')}
          </AppText>
        </Stack>
      </AppScreen>
    );
  }

  return (
    <AppScreen tone="kiosk" padded={false} testID="kiosk-idle">
      <View style={[styles.container, { padding: isCompact ? spacing.lg : spacing.xxl }]}>
        {/* Encabezado: logo e ubicación a la izquierda, sincronización a la derecha */}
        <Row justify="space-between" align="flex-start">
          {/*
            El logotipo es el gesto oculto de salida del kiosco (§6.4). Lleva
            `hitSlop` porque su alto depende del texto: sin nombre de ubicacion
            cargado son 31 px, muy por debajo del objetivo tactil de 44. Se midio
            en un navegador de verdad, no se supuso.

            Y ADEMAS `minHeight`, que es lo que de verdad lo arregla: `hitSlop`
            solo existe en nativo, asi que en la previsualizacion web el objetivo
            seguia midiendo 31 px. Un alto real de 44 funciona en las dos y no
            depende de que la plataforma respete `hitSlop`.

            §21 exige que el gesto oculto tenga ALTERNATIVA ADMINISTRATIVA, y la
            tiene: revocar el dispositivo desde el panel (`revoke_kiosk_device`,
            listado en la vista `kiosk_devices_admin`). Un iPad revocado deja de
            funcionar como reloj sin que nadie tenga que tocarlo.
          */}
          <Pressable
            onLongPress={() => router.push('/kiosk/exit')}
            delayLongPress={EXIT_LONG_PRESS_MS}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.logoTarget}
            accessibilityRole="button"
            accessibilityLabel={t('common.appName')}
            accessibilityHint={t('a11y.logoLongPress')}
            testID="kiosk-logo"
          >
            <Row gap={spacing.sm} align="center">
              {/*
                EL LOGOTIPO SUSTITUYE AL NOMBRE DE LA APP, no se suma a él (§11.6).
                Quien entra a la tienda tiene que reconocer el negocio, no la
                herramienta que usa el negocio; y dos marcas juntas en la esquina de
                una pantalla de reposo se leen como un error de montaje.

                Sin logotipo se pinta el nombre de la app, que es lo que había antes
                de existir esto.
              */}
              {logoUrl === null ? (
                <Stack gap={spacing.xs}>
                  <AppText variant="section" tone="primary">
                    {t('common.appName')}
                  </AppText>
                  <AppText variant="help" tone="subtle">
                    {binding?.locationName ?? ''}
                  </AppText>
                </Stack>
              ) : (
                <>
                  <Image
                    source={{ uri: logoUrl }}
                    // `contain`: un logotipo recortado es un logotipo estropeado, y
                    // aquí no se controla su relación de aspecto.
                    resizeMode="contain"
                    // El nombre de la organización como texto alternativo, para que
                    // VoiceOver no lea "imagen" a secas.
                    accessibilityLabel={binding?.organizationName ?? t('common.appName')}
                    style={styles.orgLogo}
                  />
                  <Stack gap={spacing.xs}>
                    <AppText variant="bodyStrong">{binding?.organizationName ?? ''}</AppText>
                    <AppText variant="help" tone="subtle">
                      {binding?.locationName ?? ''}
                    </AppText>
                  </Stack>
                </>
              )}
            </Row>
          </Pressable>

          <SyncIndicator online={online} syncing={syncing} pendingCount={pendingCount} />
        </Row>

        {/* Reloj y fecha: el elemento dominante de la pantalla */}
        <Stack gap={spacing.xs} style={styles.clockBlock}>
          <AppText
            variant="kioskClock"
            size={scaleFont(fontSize.kioskClockMin, fontSize.kioskClockMax)}
            tabular
            accessibilityRole="header"
          >
            {formatClockTime(now, timezone, policies.timeFormat, language)}
          </AppText>
          <AppText variant="body" tone="muted">
            {formatLongDate(now, timezone, language)}
          </AppText>
        </Stack>

        {/* Instrucción y PIN */}
        <Stack gap={spacing.lg} style={styles.pinBlock}>
          <Stack gap={spacing.xs}>
            <AppText
              variant="kioskTitle"
              size={scaleFont(fontSize.kioskTitleMin, fontSize.kioskTitleMax)}
              style={styles.centerText}
            >
              {t('kiosk.idleTitle')}
            </AppText>
            <AppText variant="body" tone="muted" style={styles.centerText}>
              {t('kiosk.idleSubtitle')}
            </AppText>
          </Stack>

          <PinDots length={pinLength} entered={pin.length} error={error !== null} />

          {/*
            SEÑAL DE QUE ESTÁ PASANDO ALGO (§20: "para cada pantalla implementar
            skeleton o carga"). No la había: mientras se validaba el PIN, la única
            cosa que ocurría era `disabled={checking}` en el teclado, así que la
            persona tecleaba sus seis dígitos y la pantalla se quedaba EXACTAMENTE
            IGUAL. Volvía a tocar, los botones no respondían porque estaban
            deshabilitados, y concluía que el iPad está roto. En una tienda con red
            lenta una validación tarda varios segundos, y este es el flujo más usado
            de la app.

            CON TEXTO Y NO SOLO UN INDICADOR GIRANDO: el iPad está sobre un pedestal
            y se mira a un metro de distancia. Un giro de veinte píxeles no se ve.

            Va en el sitio del error, no además: los dos no pueden coexistir —el
            error se limpia al teclear— y ocupar la misma línea evita que la pantalla
            salte de altura al cambiar de uno a otro.
          */}
          {checking ? (
            <AppText
              variant="body"
              tone="muted"
              style={styles.centerText}
              accessibilityRole="alert"
              testID="kiosk-pin-checking"
            >
              {t('kiosk.pinChecking')}
            </AppText>
          ) : error !== null ? (
            <AppText
              variant="body"
              tone="danger"
              style={styles.centerText}
              accessibilityRole="alert"
              testID="kiosk-pin-error"
            >
              {error}
            </AppText>
          ) : null}

          <NumericKeypad
            onDigit={appendDigit}
            onBackspace={() => setPin((c) => c.slice(0, -1))}
            onClear={clearPin}
            size={isWide ? 'kiosk' : 'mobile'}
            disabled={checking}
          />
        </Stack>

        {/* Pie: idioma, ayuda y pendientes de sincronizar */}
        <Stack gap={spacing.sm}>
          {pendingCount > 0 ? (
            <AppText
              variant="help"
              tone="warning"
              style={styles.centerText}
              testID="kiosk-pending-count"
            >
              {t('common.pendingRecords', { count: pendingCount })}
            </AppText>
          ) : null}

          <Row justify="space-between" align="center">
            {/*
              §18 pide que el kiosco permita alternar ES/EN en reposo. Antes era un
              solo boton con la etiqueta "ES | en", donde la unica señal del idioma
              activo eran las mayusculas. Ahora son dos opciones con estado visible y
              accesible. Ver src/components/ui/language-switch.tsx.
            */}
            <LanguageSwitch testID="kiosk-language-toggle" />
            <GhostButton
              label={t('kiosk.helpLink')}
              onPress={() => router.push('/kiosk/help')}
              fullWidth={false}
              haptic={false}
            />
          </Row>
        </Stack>
      </View>
    </AppScreen>
  );
}

function minutesUntil(isoDate: string): number {
  const target = Date.parse(isoDate);
  if (Number.isNaN(target)) return 1;
  return Math.max(1, Math.ceil((target - Date.now()) / 60_000));
}

const styles = StyleSheet.create({
  // 44 es el minimo de objetivo tactil de las guias de iOS y de §21.
  logoTarget: { minHeight: sizes.touchTargetMin, justifyContent: 'center' },
  // 48 de alto: suficiente para reconocer un logotipo y no tanto como para competir
  // con el reloj, que es el elemento dominante de esta pantalla (§9.1). Ancho
  // generoso porque un logotipo horizontal es lo normal, con `contain` para no
  // deformarlo.
  orgLogo: { width: 160, height: 48 },
  container: { flex: 1, justifyContent: 'space-between', backgroundColor: colors.primary50 },
  clockBlock: { alignItems: 'center' },
  pinBlock: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
