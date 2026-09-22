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
