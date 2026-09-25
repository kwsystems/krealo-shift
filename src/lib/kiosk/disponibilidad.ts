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
 *   1. EN WEB LA FOTO ERA OBLIGATORIA Y BLOQUEABA, y DEJO DE SERLO el 2026-09-25. El
 *      parrafo de abajo explica por que era obligatoria y se conserva entero, porque el
 *      argumento sigue siendo correcto: lo que cambio no es el razonamiento, es quien
 *      pone la prueba de presencia. Ver «LA FOTO YA NO BLOQUEA» al final del fichero.
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

/**
 * LA FOTO YA NO BLOQUEA (Andree, por decision de la dueña del local, 2026-09-25).
 *
 * «Ninguna foto. Al final esto solo estara puesto en la tienda, y vere las camaras para
 * saber que si estan marcando.»
 *
 * LA MITIGACION NO DESAPARECE: CAMBIA DE MANOS. El argumento de arriba —que en un
 * navegador la foto era la unica prueba de que quien ficha estaba delante— sigue siendo
 * cierto, y por eso se conserva escrito. Lo que cambia es que ahora la prueba de presencia
 * es FISICA y del local: el aparato se queda en la tienda y las camaras de seguridad
 * cubren lo que cubria la foto. Es una prueba mejor, de hecho: la foto demuestra que
 * alguien estaba delante de la camara del aparato, no que estuviera en la tienda.
 *
 * ESTO SE ESCRIBE AQUI Y NO SE BORRA EL PARRAFO DE ARRIBA a proposito. Quien lea ese
 * razonamiento sin esta nota concluira que la regla se cayo por descuido y la restaurara
 * —es lo que yo habria hecho—, y eso devolveria un bloqueo que la dueña quito a sabiendas.
 *
 * Y EL RIESGO REAL ES MAS ESTRECHO DE LO QUE DA A ENTENDER EL PARRAFO DE ARRIBA, que dice
 * «la direccion se abre desde cualquier sitio». Medido: el reloj exige ACTIVACION con
 * codigo antes de ofrecer el teclado, y sin credencial pinta su estado vacio. Asi que no
 * es «cualquiera con el enlace ficha desde su casa»: es que ESE navegador, ya activado,
 * salga de la tienda, o que alguien copie su credencial del almacenamiento. Que el aparato
 * no se mueva del local es exactamente la respuesta a eso.
 *
 * QUIEN QUIERA LA FOTO LA SIGUE TENIENDO: el ajuste «Foto al fichar» de cada sede sigue
 * existiendo y funcionando. Lo que se quita es que la web la imponga por encima del ajuste.
 */
export const fotoDeVerificacionObligatoria = false;

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
