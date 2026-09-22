/**
 * Lo que tiene que estar puesto ANTES de que se importe nada.
 *
 * `functions/src/shared/admin.ts` llama a `initializeApp()` al cargarse, y ahi es donde
 * el SDK decide con que bucket habla. Si para entonces no hay `storageBucket`,
 * `getStorage().bucket()` revienta con «Bucket name not specified», que no tiene nada
 * que ver con lo que la prueba estaba comprobando. Por eso va aqui y no en el archivo de
 * pruebas: un `import` se resuelve antes que cualquier linea del cuerpo.
 *
 * El bucket es de mentira a proposito: el emulador de Storage crea el que le pidas.
 */
process.env.GCLOUD_PROJECT ??= 'demo-krealo-shift';
process.env.FIREBASE_CONFIG ??= JSON.stringify({
  projectId: 'demo-krealo-shift',
  storageBucket: 'demo-krealo-shift.firebasestorage.app',
});

/**
 * El secreto que firma los tokens de accion del reloj.
 *
 * `verifyPin` emite un token de 90 segundos que despues consumen las funciones que
 * escriben fichajes, y lo firma con `KIOSK_TOKEN_SECRET`. Sin el, `tokenSecret()` lanza
 * «KIOSK_TOKEN_SECRET falta o tiene menos de 32 caracteres» y lo que falla es el camino
 * FELIZ —los rechazos siguen funcionando—, que es la forma mas facil de creerse que las
 * pruebas cubren algo.
 *
 * Es de mentira y da igual que lo sea: aqui no protege nada, solo tiene que existir y
 * medir lo que el codigo exige. El de produccion vive en Secret Manager.
 */
process.env.KIOSK_TOKEN_SECRET ??= 'secreto-de-pruebas-que-no-protege-nada-pero-mide-lo-suficiente';
