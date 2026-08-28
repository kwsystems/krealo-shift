/**
 * Diagnóstico del kiosco, copiable y SIN DATOS PERSONALES (§31).
 *
 * §31 pide un botón para copiar el diagnóstico sin datos personales. Existía la
 * etiqueta traducida —`settings.copyDiagnostics`— y el docstring de la pantalla de
 * salida ya afirmaba que se podía copiar. No se podía: no había ni botón ni función.
 * Un comentario que promete una función que no existe es peor que no tener el
 * comentario.
 *
 * POR QUÉ ESTO ES UN MÓDULO Y NO UN `JSON.stringify` DE LO QUE HAY EN PANTALLA.
 *
 * "Sin datos personales" no es una intención, es una propiedad, y una propiedad se
 * garantiza limitando lo que se puede escribir. El texto se compone a partir de un
 * tipo CERRADO de campos: para filtrar un nombre de empleado o una foto haría falta
 * añadir un campo nuevo aquí, en un archivo que dice en la primera línea que no se
 * puede. Con un volcado de la pantalla, cualquier fila nueva se colaría sola.
 *
 * Lo que sí lleva —identificador opaco del dispositivo, ubicación, versión,
 * contadores— es exactamente la lista de §31, y ninguno de esos campos identifica a
 * una persona.
 */

export type KioskDiagnostics = {
  /** Identificador opaco del dispositivo. No es el nombre que se ve en pantalla. */
  devicePublicId: string | null;
  locationName: string | null;
  timezone: string | null;
  appVersion: string | null;
  online: boolean;
  pendingCount: number;
  needsReviewCount: number;
  /** ISO de la última sincronización, o `null` si nunca sincronizó. */
  lastSyncAt: string | null;
  /** Último fallo del motor de sincronización, o `null`. */
  lastSyncError: string | null;
  screenAwake: boolean | null;
  cameraPermission: string | null;
  notificationsPermission: string | null;
  generatedAt: string;
};

const NO_DISPONIBLE = '-';

const texto = (valor: string | null): string =>
  valor === null || valor.trim() === '' ? NO_DISPONIBLE : valor.trim();

const siNo = (valor: boolean | null): string =>
  valor === null ? NO_DISPONIBLE : valor ? 'si' : 'no';

/**
 * Texto plano, una línea por campo.
 *
 * En inglés y sin traducir a propósito: esto se pega en un correo o en un chat de
 * soporte, y quien lo lee es quien mantiene la app, no el empleado de la tienda. Un
 * diagnóstico traducido al idioma del iPad es más difícil de leer para quien tiene
 * que interpretarlo, y las etiquetas tendrían que existir en los dos idiomas para
 * decir lo mismo.
 */
export function formatKioskDiagnostics(datos: KioskDiagnostics): string {
  return [
    'Krealo Shift - kiosk diagnostics',
    `generated: ${texto(datos.generatedAt)}`,
    `app version: ${texto(datos.appVersion)}`,
    `device id: ${texto(datos.devicePublicId)}`,
    `location: ${texto(datos.locationName)}`,
    `timezone: ${texto(datos.timezone)}`,
    `online: ${siNo(datos.online)}`,
    `queued events: ${String(datos.pendingCount)}`,
    `needs review: ${String(datos.needsReviewCount)}`,
    `last sync: ${texto(datos.lastSyncAt)}`,
    `last sync error: ${texto(datos.lastSyncError)}`,
    `screen awake: ${siNo(datos.screenAwake)}`,
    `camera permission: ${texto(datos.cameraPermission)}`,
    `notifications permission: ${texto(datos.notificationsPermission)}`,
  ].join('\n');
}
