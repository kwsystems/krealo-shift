import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, useSegments } from 'expo-router';

import { KioskNotSetUpState, useKioskNotSetUp } from '@/components/kiosk/not-set-up';
import { KioskUnavailableHere } from '@/components/kiosk/unavailable-here';
import { kioskModeAvailable } from '@/lib/kiosk/disponibilidad';
import { keepScreenAwake, releaseScreenAwake } from '@/lib/kiosk/screen-awake';
import { refreshQueueIndicators, runSync } from '@/lib/offline/sync';
import { useKioskStore } from '@/stores/kiosk-store';
import { ProveedorDeMarca } from '@/theme/marca-de-empresa';
import { useNetworkStore } from '@/stores/network-store';

/**
 * Layout del modo kiosco (§6.4).
 *
 * El kiosco no usa la barra de navegación personal: es un flujo cerrado. Mientras
 * el iPad está en modo reloj mantenemos la pantalla despierta, porque un iPad
 * apagado sobre el pedestal significa una cola de empleados esperando (§4).
 *
 * Aquí viven también los disparadores de sincronización (§17): al recuperar la
 * red, al volver a foreground y cada cierto tiempo mientras la app está activa.
 * La acción manual está en el menú de salida del kiosco. No se usa una tarea en
 * background de iOS para garantizar el fichaje: la cola sincroniza cuando la app
 * vuelve a estar delante (§23).
 */

/** Intervalo del reintento periódico mientras el kiosco está activo. */
const PERIODIC_SYNC_MS = 60_000;

/**
 * Rutas del kiosco que SÍ funcionan sin credencial, y por qué.
 *
 * `setup` es la que crea la credencial: exigirla ahí sería un círculo cerrado.
 * `help` es texto explicativo y se lee igual sin credencial.
 * `exit` se exime por el motivo escrito en `app/kiosk/exit.tsx`: es la pantalla que
 * BORRA la credencial, así que la guarda del layout se pintaría encima justo al
 * desactivar. Comprueba lo mismo por su cuenta, con la misma condición compartida.
 *
 * Todo lo demás hereda la guarda. Que el valor por defecto sea exigirla es
 * deliberado: una ruta nueva del kiosco que se olvide de comprobarlo falla de forma
 * visible —el estado vacío— en lugar de pintar un teclado que no hace nada.
 */
const RUTAS_SIN_CREDENCIAL = new Set(['setup', 'help', 'exit']);

export default function KioskLayout() {
  const online = useNetworkStore((s) => s.online);
  const setScreenAwake = useKioskStore((s) => s.setScreenAwake);
  /*
   * EL COLOR DE LA EMPRESA SALE DEL VÍNCULO, no de una consulta. El reloj tiene que poder
   * pintarse sin red —es lo primero que se cae en una tienda— y una pantalla que pierde su
   * color al caerse el wifi parece rota.
   */
  const colorDeMarca = useKioskStore((s) => s.binding?.organizationBrandColor ?? null);
  const notSetUp = useKioskNotSetUp();
  const segments = useSegments();

  useEffect(() => {
    // El detalle de por qué esto no es `void activateKeepAwakeAsync()` está en
    // `src/lib/kiosk/screen-awake.ts`. Aquí solo queda el ciclo de vida.
    let vivo = true;
    void keepScreenAwake().then((ok) => {
      if (vivo) setScreenAwake(ok);
    });
    return () => {
      vivo = false;
      releaseScreenAwake();
    };
  }, [setScreenAwake]);

  // Al arrancar y cada minuto: refresca el indicador e intenta enviar la cola.
  useEffect(() => {
    void refreshQueueIndicators();
    const interval = setInterval(() => {
      void runSync();
    }, PERIODIC_SYNC_MS);
    return () => clearInterval(interval);
  }, []);

  // Al recuperar la red. `runSync` es reentrante-segura, así que coincidir con
  // otro disparador no duplica envíos.
  useEffect(() => {
    if (online) void runSync();
  }, [online]);

  // Al volver a foreground: es el momento en que el iPad vuelve a tener CPU y
  // red de verdad después de estar en reposo.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSync();
    });
    return () => subscription.remove();
  }, []);

  /*
   * PRIMERO si el kiosco puede existir aquí, y solo después si está configurado.
   *
   * El orden no es indiferente: donde el modo kiosco no es posible, ofrecer
   * "configurar este dispositivo" manda a la gente a un callejón sin salida, porque
   * la activación falla al intentar guardar la credencial. Se aplica a TODAS las
   * rutas, `setup` incluida, que es justamente la que no debe abrirse.
   */
  if (!kioskModeAvailable) {
    return <KioskUnavailableHere />;
  }

  /*
   * LA GUARDA DE CREDENCIAL VA AQUÍ, no en cada pantalla.
   *
   * Estaba solo en `app/kiosk/index.tsx`. `/kiosk/actions`, `/kiosk/exit` y
   * `/kiosk/forgot` se alcanzan sin pasar por ahí —enlace directo, restauración de
   * ruta al reiniciar, recarga en la previsualización web— y pintaban su pantalla
   * completa con la ubicación en blanco y controles que no hacían nada.
   *
   * Una precondición que solo comprueba una pantalla no es una precondición. Este
   * layout es el único punto por el que pasan todas las rutas del kiosco.
   */
  const rutaActual = segments[segments.length - 1] ?? '';
  if (notSetUp && !RUTAS_SIN_CREDENCIAL.has(rutaActual)) {
    return <KioskNotSetUpState />;
  }

  /*
   * EL PROVEEDOR ENVUELVE AL `Stack` Y NO AL REVÉS: las pantallas del reloj se pintan como
   * hijas suyas, así que quedan dentro. Los dos estados de error de arriba se devuelven
   * antes a propósito: sin vínculo no hay empresa, y por tanto no hay marca que poner.
   */
  return (
    <ProveedorDeMarca color={colorDeMarca}>
      <Stack
        screenOptions={{
          headerShown: false,
          // Sin gesto de retroceso: el empleado no debe poder salirse del flujo.
          gestureEnabled: false,
          animation: 'fade',
        }}
      />
    </ProveedorDeMarca>
  );
}
