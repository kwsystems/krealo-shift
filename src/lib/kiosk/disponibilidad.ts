import { Platform } from 'react-native';

/**
 * ¿Puede este dispositivo ser un reloj de fichaje?
 *
 * LA DECISIÓN, Y DE QUIÉN ES (Andree, 2026-09-14)
 * La web publicada sirve el PANEL de administración con normalidad. El modo kiosco
 * —la pantalla donde los empleados teclean su PIN— NO, y se le pregunta
 * explícitamente antes de cambiarlo.
 *
 * POR QUÉ SE SEPARAN LOS DOS
 * El panel en web no pierde nada: la sesión vive en `localStorage`, que es
 * exactamente donde supabase-js la guarda en cualquier aplicación web, y quien
 * protege los datos es RLS en el servidor, no el navegador.
 *
 * El kiosco sí pierde dos cosas, y las dos son de verdad:
 *   1. La credencial del dispositivo y la clave que valida PIN sin conexión
 *      acabarían en `localStorage`, al alcance de cualquier extensión del
 *      navegador. En el iPad viven en el Keychain.
 *   2. La cola de fichajes en web corre sobre SQLite en memoria y NO sobrevive a un
 *      recargado (el motivo largo, con los errores de OPFS que lo obligaron, está en
 *      `src/lib/offline/database.ts`). Un fichaje perdido es una hora no pagada.
 *
 * ANTES ESTO REVENTABA, y ese era el problema. Las guardas de `secure-storage.ts` y
 * `database.ts` lanzaban en cualquier build web de producción, así que publicar la
 * web dejaba la app entera sin arrancar —panel incluido— con un error técnico. Un
 * límite real merece explicarse en pantalla, no tirar la aplicación.
 */
const esWebDeProduccion =
  Platform.OS === 'web' &&
  process.env.NODE_ENV === 'production' &&
  process.env.EXPO_PUBLIC_APP_ENV === 'production';

export const kioskModeAvailable = !esWebDeProduccion;

/**
 * Claves que solo tienen sentido en un dispositivo que puede ser reloj.
 *
 * Se listan aquí y no en `secure-storage.ts` para que la lista viva junto al motivo
 * por el que existe. Las otras dos claves —la sesión y las preferencias— son del
 * panel y funcionan en web sin reparos.
 */
export const CLAVES_DE_KIOSCO: readonly string[] = [
  'kiosk.credential',
  'kiosk.deviceKey',
  'kiosk.installationId',
];
