import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Layout del modo kiosco (§6.4).
 *
 * El kiosco no usa la barra de navegación personal: es un flujo cerrado. Mientras
 * el iPad está en modo reloj mantenemos la pantalla despierta, porque un iPad
 * apagado sobre el pedestal significa una cola de empleados esperando (§4).
 */
export default function KioskLayout() {
  useEffect(() => {
    void activateKeepAwakeAsync();
    return () => {
      void deactivateKeepAwake();
    };
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
