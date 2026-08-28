import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Mantener la pantalla del kiosco encendida (§4, §6.4).
 *
 * VIVE APARTE DEL LAYOUT para poder probarse. Estaba dentro del efecto como
 * `void activateKeepAwakeAsync()`, o sea descartando la promesa, y eso tenía dos
 * costos:
 *
 *   1. Un rechazo era una excepción sin capturar. En el navegador el permiso de
 *      Wake Lock está negado por defecto, así que las CINCO rutas del kiosco
 *      reventaban al renderizar. Lo detectó `scripts/render-check.mjs`, no `tsc`
 *      ni las pruebas: un `void` sobre una promesa que puede fallar es sintaxis
 *      perfectamente válida.
 *   2. Aunque no reventara, nadie sabía si había funcionado. Un iPad que se apaga
 *      sobre el pedestal es una cola de empleados esperando, y el síntoma que
 *      llega de la tienda es "el reloj se apaga solo", que no apunta a ninguna
 *      parte.
 *
 * Ahora el resultado se informa y el diagnóstico del kiosco lo muestra.
 */
export async function keepScreenAwake(): Promise<boolean> {
  try {
    await activateKeepAwakeAsync();
    return true;
  } catch (error) {
    console.warn(
      '[krealo-shift] No se pudo mantener la pantalla encendida. El iPad puede ' +
        'apagarse sobre el pedestal; revisa Ajustes > Pantalla y brillo > Bloqueo ' +
        'automático. Motivo: ' +
        String(error),
    );
    return false;
  }
}

/**
 * Liberar el bloqueo al salir del kiosco.
 *
 * No propaga: se ejecuta al desmontar, y salir del modo kiosco no puede fallar
 * porque el sistema no quiso soltar un bloqueo que quizá nunca llegó a tomar.
 */
export function releaseScreenAwake(): void {
  try {
    void deactivateKeepAwake();
  } catch {
    // Sin acción a propósito.
  }
}
