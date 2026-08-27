import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { refreshQueueIndicators, runSync } from '@/lib/offline/sync';
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
export default function KioskLayout() {
  const online = useNetworkStore((s) => s.online);

  useEffect(() => {
    void activateKeepAwakeAsync();
    return () => {
      void deactivateKeepAwake();
    };
  }, []);

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

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Sin gesto de retroceso: el empleado no debe poder salirse del flujo.
        gestureEnabled: false,
        animation: 'fade',
      }}
    />
  );
}
