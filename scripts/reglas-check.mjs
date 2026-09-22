#!/usr/bin/env node
/**
 * Las reglas de Firestore, ejercitadas contra el emulador — y la prueba de que
 * CORRIERON.
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

const carpeta = mkdtempSync(join(tmpdir(), 'reglas-'));
const informe = join(carpeta, 'jest.json');

const jest = `npx jest -c jest.emulador.config.js --ci --json --outputFile=${informe}`;
const emulador = spawnSync(
  'npx',
  ['firebase', 'emulators:exec', '--only', 'firestore', '--project', 'demo-krealo-shift', jest],
  { stdio: 'inherit', shell: false },
);

let datos;
try {
  datos = JSON.parse(readFileSync(informe, 'utf8'));
} catch {
  rmSync(carpeta, { recursive: true, force: true });
  console.error('\nFALLA: Jest no dejó informe. El emulador no llegó a lanzarlo.');
  process.exit(1);
}
rmSync(carpeta, { recursive: true, force: true });

const { numTotalTests = 0, numPassedTests = 0, numPendingTests = 0, numFailedTests = 0 } = datos;
console.log(
  `\nreglas de Firestore: ${numPassedTests} pasaron, ${numFailedTests} fallaron, ${numPendingTests} pendientes (${numTotalTests} en total).`,
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
  console.error('FALLA: las reglas no pasaron sus pruebas.');
  process.exit(1);
}
console.log('OK: las reglas se ejercitaron de verdad contra el emulador.');
