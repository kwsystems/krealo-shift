#!/usr/bin/env node
/**
 * Todo lo que necesita emuladores de Firebase — y la prueba de que CORRIO.
 *
 * Hoy son dos cosas, y las dos protegen algo que no se puede comprobar leyendo codigo:
 * las reglas de Firestore (quien puede leer que) y la purga de fotos de fichaje (que
 * los retratos se borran cuando la app promete que se borran).
 *
 * POR QUE NO BASTA CON LANZAR JEST. Durante meses el CI ejecutaba estas ocho pruebas y
 * salía verde sin haber comprobado nada: el archivo empezaba con
 *
 *     const describeSiHayEmulador = hayEmulador ? describe : describe.skip;
 *
 * y como el CI no arrancaba emulador, Jest decía «8 skipped» y el trabajo pasaba. Ocho
 * pruebas que no corren protegen exactamente lo mismo que ocho que no existen, y aquí
 * lo que protegen es que el hash del PIN no se lea desde el cliente, que nadie escriba
 * un fichaje a mano y que un gerente no vea otra sede.
 *
 * Así que este guion no se conforma con el código de salida: lee el informe de Jest y
 * FALLA si alguna quedó pendiente o si no corrió ninguna. Un paso que pasa con cero
 * pruebas ejecutadas es el mismo problema con otro nombre.
 *
 * El proyecto se llama `demo-*` a propósito: los emuladores tratan esos identificadores
 * como offline y no piden credenciales, así que esto corre en un runner limpio y en un
 * fork igual que en tu máquina.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = mkdtempSync(join(tmpdir(), 'emulador-'));
const informe = join(carpeta, 'jest.json');

const jest = `npx jest -c jest.emulador.config.js --ci --json --outputFile=${informe}`;
/*
 * EN WINDOWS HACE FALTA SHELL, y no es un capricho. Desde Node 18.20 (CVE-2024-27980)
 * `spawnSync` se NIEGA a ejecutar un `.cmd` sin `shell: true` y devuelve EINVAL; sin
 * shell y sin la extension, devuelve ENOENT. Como el error no se miraba, las dos cosas
 * salian como «el emulador no llego a lanzarlo», que manda a investigar el emulador
 * —que estaba perfecto— en vez del lanzador. O sea que `npm run emulador:check`, la
 * forma que el README documenta para correr esto en tu maquina, no funcionaba en
 * Windows y encima mentia sobre el motivo.
 *
 * Con shell, la orden de Jest va ENTRECOMILLADA: `emulators:exec` la toma como UN
 * argumento y el shell la partiria por los espacios.
 */
const enWindows = process.platform === 'win32';
const orden = enWindows ? `"${jest}"` : jest;

const emulador = spawnSync(
  'npx',
  [
    'firebase',
    'emulators:exec',
    '--only',
    'firestore,storage',
    '--project',
    'demo-krealo-shift',
    orden,
  ],
  { stdio: 'inherit', shell: enWindows },
);

/*
 * SI NI SE PUDO LANZAR, decirlo. Un `spawnSync` que falla devuelve `error` y deja
 * `status` en null; sin mirarlo, el fallo se disfrazaba del mensaje de mas abajo.
 */
if (emulador.error !== undefined) {
  rmSync(carpeta, { recursive: true, force: true });
  console.error('\nFALLA: no se pudo ejecutar «npx firebase emulators:exec».');
  console.error(emulador.error.message);
  process.exit(1);
}

let datos;
try {
  datos = JSON.parse(readFileSync(informe, 'utf8'));
} catch {
  rmSync(carpeta, { recursive: true, force: true });
  console.error('\nFALLA: Jest no dejó informe. El emulador no llegó a lanzarlo.');
  // La causa más común en una máquina de desarrollo: una corrida anterior dejó el
  // emulador vivo y el puerto ocupado. En Windows pasa más, porque con `shell: true` la
  // JVM queda fuera del árbol de procesos que Node cierra al salir.
  console.error('Si arriba pone «port taken», queda un emulador de antes: ciérralo.');
  process.exit(1);
}
rmSync(carpeta, { recursive: true, force: true });

const {
  numTotalTests = 0,
  numPassedTests = 0,
  numPendingTests = 0,
  numFailedTests = 0,
  numFailedTestSuites = 0,
} = datos;

/*
 * UNA SUITE QUE NI CARGA NO APARECE COMO PRUEBA FALLIDA. Paso en el CI: a
 * `purga-fotos.test.ts` le faltaba `firebase-admin/storage` y el informe decia
 * «8 pasaron, 0 fallaron» tan tranquilo, porque las cinco que no llegaron a existir no
 * se cuentan en ningun sitio. Lo unico que lo delataba era el codigo de salida. Se mira
 * aparte para que el mensaje diga lo que pasa de verdad.
 */
if (numFailedTestSuites > 0 && numFailedTests === 0) {
  console.error(
    `\nFALLA: ${numFailedTestSuites} suite(s) no llegaron a ejecutarse. Suele ser un módulo que no se encuentra: revisa que estén instaladas las dependencias de functions/.`,
  );
  process.exit(1);
}
console.log(
  `\npruebas con emulador: ${numPassedTests} pasaron, ${numFailedTests} fallaron, ${numPendingTests} pendientes (${numTotalTests} en total).`,
);

if (numTotalTests === 0) {
  console.error('FALLA: no corrió ninguna prueba. Revisa `testMatch` de jest.emulador.config.js.');
  process.exit(1);
}
if (numPendingTests > 0) {
  console.error(`FALLA: ${numPendingTests} pruebas quedaron pendientes. Tienen que correr todas.`);
  process.exit(1);
}
if (numFailedTests > 0 || emulador.status !== 0) {
  console.error('FALLA: las pruebas con emulador no pasaron.');
  process.exit(1);
}
console.log('OK: se ejercitaron de verdad contra los emuladores.');
