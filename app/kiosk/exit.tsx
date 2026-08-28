import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { NumericKeypad, PinDots } from '@/components/attendance/pin-pad';
import { KioskNotSetUpState, useKioskNotSetUp } from '@/components/kiosk/not-set-up';
import { AppText } from '@/components/ui/app-text';
import { DangerButton, SecondaryButton } from '@/components/ui/buttons';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { verifyPin } from '@/features/kiosk/api';
import { formatKioskDiagnostics } from '@/features/kiosk/diagnostics';
import {
  readCameraPermission,
  readNotificationsPermission,
  type PermissionLabel,
} from '@/features/kiosk/permission-status';
import { lastSyncFailure, refreshOfflinePackage, runSync } from '@/lib/offline/sync';
import { DEFAULT_KIOSK_POLICIES, useKioskStore } from '@/stores/kiosk-store';
import { useNetworkStore } from '@/stores/network-store';
import { spacing } from '@/theme/tokens';
import { formatClockTime } from '@/utils/time';

/**
 * Salida y opciones del kiosco (§6.4, §31).
 *
 * Se llega aquí solo con una pulsación larga de 3 segundos sobre el logotipo, y
 * hace falta el PIN de un GERENTE de esta tienda para continuar. El menú aparece
 * únicamente después de esa autorización: un empleado no debe poder revocar el
 * dispositivo ni cambiar la ubicación.
 *
 * QUIÉN DECIDE SI ALGUIEN ES GERENTE
 * Lo decide el servidor, en `canManageLocation`. El kiosco no lo deduce: no tiene
 * con qué, y una comprobación local sería adivinar. Un PIN correcto de una
 * empleada normal identifica bien a esa persona pero NO abre este menú.
 *
 * Por eso este menú no funciona sin conexión: la sesión offline pone
 * `canManageLocation: false` a propósito, porque el iPad no puede confirmar
 * permisos por su cuenta. Se dice claramente en pantalla en vez de dejar pasar.
 *
 * El diagnóstico se puede copiar sin datos personales (§31).
 */
export default function KioskExitScreen() {
  const { t } = useTranslation();

  const binding = useKioskStore((s) => s.binding);
  const screenAwake = useKioskStore((s) => s.screenAwake);
  const notSetUp = useKioskNotSetUp();
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  /**
   * Desactivación en curso.
   *
   * ESTA PANTALLA ESTÁ EXENTA DE LA GUARDA DEL LAYOUT y este flag es el motivo.
   * Es la pantalla que BORRA la credencial: en cuanto `deactivate` resuelve, el
   * binding es null, y una guarda en el layout se pintaría por encima —"este
   * dispositivo todavía no es un reloj", con un botón para configurarlo— en el
   * instante entre desactivar y navegar. Justo a quien acaba de desactivarlo a
   * propósito, y como una carrera, así que a veces sí y a veces no.
   *
   * Con el flag, ese instante dice lo que de verdad está pasando.
   */
  const [exiting, setExiting] = useState(false);

  const [permissions, setPermissions] = useState<{
    camera: PermissionLabel | null;
    notifications: PermissionLabel | null;
  }>({ camera: null, notifications: null });
  const [copied, setCopied] = useState(false);

  // Se lee al montar la pantalla y no de forma continua: son datos de diagnostico
  // que se consultan cuando algo va mal, no indicadores vivos.
  useEffect(() => {
    let vivo = true;
    void lastSyncFailure().then((valor) => {
      if (vivo) setSyncFailure(valor);
    });
    // Ninguna de las dos lecturas lanza; el detalle esta en permission-status.ts.
    void Promise.all([readCameraPermission(), readNotificationsPermission()]).then(
      ([camera, notifications]) => {
        if (vivo) setPermissions({ camera, notifications });
      },
    );
    return () => {
      vivo = false;
    };
  }, []);
  const deactivate = useKioskStore((s) => s.deactivate);
  const { online, pendingCount, lastSyncAt, needsReviewCount } = useNetworkStore();

  const [pin, setPin] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policies = binding?.policies ?? DEFAULT_KIOSK_POLICIES;
  const timezone = binding?.timezone ?? 'America/Lima';

  const tryAuthorize = async (candidate: string) => {
    if (binding === null) return;
    setChecking(true);

    // `finally` PARA LIMPIAR EL ESTADO SIEMPRE, y no es formalismo: si `verifyPin`
    // lanzara, `setChecking(false)` no correria y esta pantalla se quedaria en
    // "comprobando" para siempre, sin poder salir del modo kiosco. `invoke` ya no
    // lanza —se arreglo—, pero la interfaz no debe poder colgarse porque una capa
    // de abajo se equivoque otra vez.
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
      // EL PIN CORRECTO NO ALCANZA. Antes esta pantalla se abría con cualquier PIN
      // válido, así que la PIN de una empleada llegaba al botón que desactiva el
      // kiosco. §6.4 pide PIN de gerente, y quien lo determina es el servidor.
      if (!result.data.employee.canManageLocation) {
        setError(t('kiosk.exitNotManager'));
        return;
      }
      setAuthorized(true);
      setError(null);
      return;
    }

    if (result.error.kind === 'offline') {
      // Sin red no hay forma de confirmar que quien teclea es gerente, y esta
      // pantalla puede desactivar el reloj. Se dice por qué, no un error genérico.
      setError(t('kiosk.exitNeedsConnection'));
      return;
    }

    if (result.error.kind === 'not_configured') {
      setError(t('errors.notConfigured'));
      return;
    }

    if (result.error.kind === 'device_credential') {
      // No es "PIN incorrecto": el iPad no pudo leer su credencial. Decir lo otro
      // haria que alguien probara PIN distintos durante diez minutos.
      setError(t('errors.deviceCredential'));
      return;
    }

    setError(t('kiosk.pinIncorrect'));
  };

  /**
   * Copiar el diagnóstico (§31).
   *
   * El texto lo compone `formatKioskDiagnostics` desde un tipo cerrado, y no un
   * volcado de lo que hay en pantalla: así "sin datos personales" es una propiedad del
   * módulo y no una intención de esta pantalla. El detalle está ahí.
   *
   * `copied` se apaga solo. Un aviso permanente haría dudar de si se copió esta vez o
   * la anterior, y en una pantalla de diagnóstico eso importa.
   */
  const copyDiagnostics = () => {
    const texto = formatKioskDiagnostics({
      devicePublicId: binding?.devicePublicId ?? null,
      locationName: binding?.locationName ?? null,
      timezone: binding?.timezone ?? null,
      appVersion: Constants.expoConfig?.version ?? null,
      online,
      pendingCount,
      needsReviewCount,
      lastSyncAt,
      lastSyncError: syncFailure,
      screenAwake,
      cameraPermission: permissions.camera,
      notificationsPermission: permissions.notifications,
      generatedAt: new Date().toISOString(),
    });

    // Si el portapapeles falla, se dice: un botón de copiar que no copia y no avisa
    // hace que la persona pegue en el correo lo que hubiera antes en el portapapeles.
    void Clipboard.setStringAsync(texto)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => setError(t('errors.generic')));
  };

  const appendDigit = (digit: string) => {
    setError(null);
    const next = pin.length >= policies.pinLength ? pin : pin + digit;
    setPin(next);
    if (next.length === policies.pinLength) void tryAuthorize(next);
  };

  // Desactivando: se dice, en vez de dejar un instante en blanco o el estado vacío
  // del kiosco pintado sobre quien acaba de pulsar "salir" a propósito.
  if (exiting) {
    return (
      <AppScreen tone="kiosk" testID="kiosk-exiting">
        <LoadingState label={t('kiosk.exiting')} />
      </AppScreen>
    );
  }

  /*
   * Sin credencial no hay nada de lo que salir, y el PIN no se puede ni comprobar:
   * `verifyPin` necesita la ubicación del binding. Antes esta pantalla se pintaba
   * entera —diagnóstico con la ubicación en blanco, teclado incluido— y al
   * completar el PIN no pasaba nada, porque el manejador empieza con
   * `if (binding === null) return;`.
   *
   * La condición es la misma que aplica el layout a las demás rutas; se comprueba
   * aquí porque esta pantalla está exenta, por el motivo de `exiting`.
   */
  if (notSetUp) {
    return <KioskNotSetUpState />;
  }

  if (!authorized) {
    return (
      <AppScreen tone="kiosk" scroll testID="kiosk-exit-gate">
        <ResponsiveContainer width="form">
          <Stack gap={spacing.lg} style={styles.centered}>
            <AppText variant="title">{t('kiosk.exitTitle')}</AppText>
            <AppText variant="body" tone="muted">
              {t('kiosk.exitEnterManagerPin')}
            </AppText>
            <PinDots length={policies.pinLength} entered={pin.length} error={error !== null} />
            {/* Mismo hueco que tenía la pantalla del kiosco: mientras se validaba, la
                única cosa que pasaba era que el teclado quedaba deshabilitado. Ver
                el comentario largo en app/kiosk/index.tsx. */}
            {checking ? (
              <AppText
                variant="help"
                tone="muted"
                accessibilityRole="alert"
                testID="exit-pin-checking"
              >
                {t('kiosk.pinChecking')}
              </AppText>
            ) : error !== null ? (
              <AppText
                variant="help"
                tone="danger"
                accessibilityRole="alert"
                testID="exit-pin-error"
              >
                {error}
              </AppText>
            ) : null}
            <NumericKeypad
              onDigit={appendDigit}
              onBackspace={() => setPin((c) => c.slice(0, -1))}
              onClear={() => setPin('')}
              size="mobile"
              disabled={checking}
            />
            <SecondaryButton label={t('common.cancel')} onPress={() => router.back()} />
          </Stack>
        </ResponsiveContainer>
      </AppScreen>
    );
  }

  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer width="form">
        <Stack gap={spacing.lg}>
          <AppText variant="title">{t('settings.diagnostics')}</AppText>

          <Card>
            <DiagnosticRow
              label={t('settings.kioskDeviceName')}
              value={binding?.displayName ?? '—'}
            />
            <DiagnosticRow label={t('settings.locations')} value={binding?.locationName ?? '—'} />
            <DiagnosticRow
              label={t('a11y.syncIndicator')}
              value={online ? t('a11y.connectionOnline') : t('a11y.connectionOffline')}
            />
            <DiagnosticRow label={t('settings.kioskPendingEvents')} value={String(pendingCount)} />
            <DiagnosticRow label={t('states.needsReviewBadge')} value={String(needsReviewCount)} />
            <DiagnosticRow
              label={t('settings.kioskLastSeen')}
              value={
                lastSyncAt === null
                  ? '—'
                  : formatClockTime(lastSyncAt, timezone, policies.timeFormat)
              }
            />
            {/*
              El ultimo fallo del motor de sincronizacion. Va aqui porque las
              entradas del motor NO LANZAN —se llaman con `void` desde ocho sitios y
              un rechazo seria una excepcion sin capturar—, y un error sin rastro
              seria peor que uno ruidoso: la cola dejaria de vaciarse y el sintoma
              que llega de la tienda es "las horas de ayer no aparecen".
            */}
            <DiagnosticRow
              label={t('settings.kioskSyncFailure')}
              value={syncFailure ?? t('settings.kioskSyncNoFailure')}
            />
            <DiagnosticRow
              label={t('settings.kioskScreenAwake')}
              value={
                screenAwake === null
                  ? t('settings.kioskScreenAwakeUnknown')
                  : screenAwake
                    ? t('settings.kioskScreenAwakeYes')
                    : t('settings.kioskScreenAwakeNo')
              }
            />
            <DiagnosticRow
              label={t('settings.appVersion')}
              value={Constants.expoConfig?.version ?? '—'}
            />
            {/*
              El identificador OPACO del dispositivo, que §31 pide y no estaba: lo que
              se mostraba era el nombre amigable, que no sirve para buscar el
              dispositivo en la base ni para que soporte lo identifique sin ambigüedad
              cuando dos iPads se llaman "Caja 1".
            */}
            <DiagnosticRow
              label={t('settings.kioskDeviceId')}
              value={binding?.devicePublicId ?? '—'}
            />
            {/*
              Estado de los permisos, también de §31. Es lo primero que hay que mirar
              cuando de una tienda llega "la foto no se guarda" o "no llegan los
              avisos": casi siempre es un permiso denegado, y sin verlo aquí nadie lo
              sabe sin caminar hasta el iPad.
            */}
            <DiagnosticRow
              label={t('settings.permissionCamera')}
              value={
                permissions.camera === null
                  ? t('common.loading')
                  : t(`settings.permission_${permissions.camera}`)
              }
            />
            <DiagnosticRow
              label={t('settings.permissionNotifications')}
              value={
                permissions.notifications === null
                  ? t('common.loading')
                  : t(`settings.permission_${permissions.notifications}`)
              }
            />
          </Card>

          <Stack gap={spacing.md}>
            <SecondaryButton
              label={copied ? t('settings.diagnosticsCopied') : t('settings.copyDiagnostics')}
              onPress={copyDiagnostics}
              testID="kiosk-copy-diagnostics"
            />
            <SecondaryButton
              label={t('kiosk.menuSync')}
              onPress={() => {
                void runSync();
              }}
              testID="kiosk-sync-now"
            />
            <SecondaryButton
              label={t('kiosk.menuRefreshRoster')}
              onPress={() => {
                void refreshOfflinePackage();
              }}
              testID="kiosk-refresh-roster"
            />
            <SecondaryButton label={t('common.back')} onPress={() => router.back()} />
            <DangerButton
              label={t('kiosk.menuExit')}
              onPress={() => {
                // Si `deactivate` falla —borrar del Keychain puede fallar— antes no
                // navegaba y no decia nada: el boton parecia no hacer nada. Ahora se
                // dice, porque la alternativa es que alguien lo pulse diez veces.
                setExiting(true);
                void deactivate()
                  .then(() => router.replace('/'))
                  .catch(() => {
                    setExiting(false);
                    setError(t('errors.generic'));
                  });
              }}
              testID="kiosk-exit-confirm"
            />
          </Stack>
        </Stack>
      </ResponsiveContainer>
    </AppScreen>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justify="space-between" gap={spacing.md}>
      <AppText variant="help" tone="subtle">
        {label}
      </AppText>
      <AppText variant="bodyStrong" tabular>
        {value}
      </AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center' },
});
