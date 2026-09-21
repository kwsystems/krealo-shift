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
/**
 * SE ABRE EL RELOJ EN LA WEB (Joseph, 2026-09-21), y las dos perdidas de arriba siguen
 * siendo ciertas. Se abre porque hoy NO HAY BUILD de la app: sin esto no hay ningun
 * reloj posible, ni bueno ni malo. Un reloj con limites conocidos vale mas que ninguno.
 *
 * Lo que cambia para que el hueco no quede abierto a secas:
 *
 *   1. EN WEB LA FOTO ES OBLIGATORIA Y BLOQUEA. En un iPad atornillado a la pared el
 *      aparato ES la prueba de presencia, asi que ahi la foto es opcional y nunca
 *      impide fichar. En un navegador la direccion se abre desde cualquier sitio —desde
 *      casa, desde el bus, o pasandosela por mensaje—, asi que la foto pasa a ser la
 *      UNICA prueba de que quien ficha estaba delante. Si es la unica prueba, no puede
 *      ser opcional: sin foto no hay fichaje.
 *
 *   2. EN WEB NO SE FICHA SIN RED. La cola en web vive en memoria y no sobrevive a un
 *      recargado (punto 2 de arriba), asi que encolar seria prometer un fichaje que se
 *      puede evaporar sin que nadie se entere. Se prefiere negarlo a la cara: quien lo
 *      lee sabe que tiene que volver a intentarlo, y eso es recuperable. Una hora
 *      perdida en silencio no lo es.
 *
 * La credencial en `localStorage` (punto 1 de arriba) NO tiene mitigacion aqui y se
 * asume: quien tenga acceso al navegador del aparato puede leerla. Sigue haciendo falta
 * el codigo de activacion para conseguirla, y se puede revocar el reloj desde Ajustes.
 */
const esWeb = Platform.OS === 'web';

export const kioskModeAvailable = true;

/** Sin foto no hay fichaje. Solo en web, y el porque esta justo arriba. */
export const fotoDeVerificacionObligatoria = esWeb;

/** Fichar sin red solo donde la cola sobrevive a un recargado. */
export const permiteFicharSinRed = !esWeb;

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
