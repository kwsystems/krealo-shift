/**
 * ¿LLEVA ESTE PAQUETE SU CONFIGURACIÓN DE FIREBASE DENTRO?
 *
 * POR QUÉ ES UN MÓDULO COMPARTIDO Y NO DOS COPIAS.
 * Esta pregunta se hace en dos sitios —antes de desplegar y después— y la respuesta tiene
 * que ser LA MISMA. Con una copia en cada arnés, el día que uno se afine el otro se queda
 * atrás y los dos dicen cosas distintas sobre el mismo paquete. Eso ya pasó en este
 * repositorio con la lista de deudas de contraste: dos arneses hermanos discrepaban
 * durante tres días y ninguno de los dos era el equivocado, porque el equivocado era
 * tener dos.
 *
 * QUÉ SE BUSCA, y por qué basta con leer el texto.
 * Las variables `EXPO_PUBLIC_*` se HORNEAN en el paquete al exportar: son públicas por
 * diseño y viajan en el cliente. Así que un paquete construido con configuración lleva la
 * clave de API de Google literal dentro, y uno construido sin ella no. No hace falta
 * navegador ni ejecutar nada: si el texto no tiene la clave, la app arrancará en «Falta
 * configuración del entorno» por muy bien empaquetada que esté.
 */

/** Lo que tiene que aparecer dentro del paquete, y con qué nombre decirlo si falta. */
const EXIGIDO = [
  ['la clave de API de Firebase', /AIza[0-9A-Za-z_-]{30,}/],
  ['el identificador del proyecto', /krealo-shift/],
];

/** Devuelve la lista de lo que NO está. Vacía = el paquete lleva su configuración. */
export function faltaEnElPaquete(texto) {
  return EXIGIDO.filter(([, patron]) => !patron.test(texto)).map(([nombre]) => nombre);
}

/**
 * LO QUE NO PUEDE IR DENTRO. Desde el 29-sep existe `EXPO_PUBLIC_AUTH_EMULATOR_URL`, para
 * que `correo:check` entre con un enlace al correo contra el emulador de Auth. Si alguien
 * la deja puesta en `.env` y construye producción, el paquete lleva `http://127.0.0.1:9099`
 * horneado y NADIE puede entrar: la app habla con un emulador que en el navegador de la
 * tienda no existe. Es la misma forma que los dos apagones de configuración: todo parece
 * bien construido y el sitio no sirve.
 *
 * Se busca una dirección local CON PUERTO entre comillas: la librería de Firebase ya trae
 * un `"http://localhost"` suelto, sin puerto, y ese no es de nadie.
 */
const PROHIBIDO = [
  [
    'la dirección de un emulador (solo para pruebas)',
    /["'`]https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d{2,5}\/?["'`]/,
  ],
];

/** Devuelve lo que el paquete NO debería llevar y lleva. Vacía = limpio. */
export function sobraEnElPaquete(texto) {
  return PROHIBIDO.filter(([, patron]) => patron.test(texto)).map(([nombre]) => nombre);
}

/** Las variables sin las que `src/lib/firebase/client.ts` no puede arrancar la app. */
export const VARIABLES_EXIGIDAS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];
