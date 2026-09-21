#!/usr/bin/env node
/**
 * Prueba de humo del circuito de fichaje, CONTRA EL PROYECTO DE VERDAD.
 *
 * Recorre lo que hace un iPad un lunes por la mañana: canjear su código de
 * activación, verificar un PIN, fichar entrada, y comprobar que repetir el fichaje
 * no lo duplica y que la máquina de estados rechaza una segunda entrada.
 *
 * POR QUE EXISTE, SI YA HAY 431 PRUEBAS UNITARIAS EN VERDE
 *
 * Porque encontró dos fallos que el typecheck y el despliegue dieron por buenos, y
 * los dos habrían dejado la app rota en producción:
 *
 *   1. `secrets: ['KIOSK_TOKEN_SECRET']` como cadena suelta NO enlaza el secreto al
 *      servicio. Hay que usar `defineSecret`. La función desplegaba «bien» y leía
 *      `undefined` al ejecutarse.
 *   2. `firebase.json` no tenía `predeploy`, así que cada despliegue subía el `lib/`
 *      compilado la primera vez. Tres despliegues seguidos publicaron código viejo
 *      diciendo «Successful update operation».
 *
 * Los dos fallan en ejecución y solo en ejecución. Nada que se compile o se
 * despliegue puede verlos.
 *
 * ESCRIBE EN LA BASE DE VERDAD Y LIMPIA DETRAS. Usa ids con prefijo de prueba y los
 * borra en el `finally`, incluso si algo revienta a mitad. Aun así: no es para correr
 * contra una base con datos de clientes sin leerlo antes.
 *
 * Uso:
 *     node functions/scripts/humo.mjs
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import bcrypt from 'bcryptjs';

initializeApp({ credential: applicationDefault(), projectId: 'krealo-shift' });
const db = getFirestore();
const BASE = 'https://southamerica-east1-krealo-shift.cloudfunctions.net';

const llamar = async (nombre, data) => {
  const res = await fetch(`${BASE}/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(`${nombre}: ${body.error.status} ${body.error.message}`);
  return body.result;
};

const paso = (n, t) => console.log(`\n[${n}] ${t}`);
const limpiar = [];

try {
  paso(1, 'Un codigo de activacion para Sede Principal');
  const codigo = '424242';
  const refCodigo = db.collection('kiosk_activation_codes').doc('PRUEBA-E2E');
  await refCodigo.set({
    organization_id: 'krealo-demo',
    location_id: 'sede-principal',
    code_hash: bcrypt.hashSync(codigo, 10),
    expires_at: new Date(Date.now() + 600000).toISOString(),
    max_uses: 1,
    used_count: 0,
    created_by: null,
    created_at: new Date().toISOString(),
  });
  limpiar.push(refCodigo);
  console.log('    codigo sembrado:', codigo);

  paso(2, 'El iPad canjea el codigo (activateKiosk)');
  const activacion = await llamar('activateKiosk', { code: codigo, displayName: 'iPad de prueba' });
  const kioskAuth = {
    credential: activacion.credential,
    devicePublicId: activacion.device.publicId,
  };
  limpiar.push(db.collection('kiosk_devices').doc(activacion.device.id));
  limpiar.push(db.collection('kiosk_device_secrets').doc(activacion.device.id));
  console.log(
    '    atado a:',
    activacion.location.name,
    '| politica pinLength:',
    activacion.location.policies.pinLength,
  );

  paso(3, 'El PIN de Ana (lo que haria setEmployeePin)');
  const pin = '135790';
  const refPin = db.collection('employee_pin_credentials').doc('empleada-ana');
  await refPin.set({
    employee_id: 'empleada-ana',
    organization_id: 'krealo-demo',
    pin_hash: bcrypt.hashSync(pin, 10),
    pin_length: 6,
    failed_attempts: 0,
    locked_until: null,
    rotated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  limpiar.push(refPin);

  paso(4, 'Ana marca su PIN (verifyPin)');
  const ctx = await llamar('verifyPin', { kioskAuth, pin });
  console.log('    reconoce a:', ctx.employee.displayName, '| estado:', ctx.attendanceState);
  console.log('    acciones ofrecidas:', ctx.allowedActions.join(', '));

  paso(5, 'Un PIN equivocado NO entra');
  try {
    await llamar('verifyPin', { kioskAuth, pin: '000000' });
    console.log('    !!! FALLO: dejo pasar un PIN equivocado');
  } catch (e) {
    console.log('    rechazado:', e.message.split(': ').slice(1).join(': '));
  }

  paso(6, 'Ficha entrada (submitTimeEvent)');
  const clave = `prueba-${Date.now()}`;
  const fichaje = await llamar('submitTimeEvent', {
    kioskAuth,
    actionToken: ctx.actionToken,
    eventType: 'clock_in',
    idempotencyKey: clave,
  });
  limpiar.push(db.collection('time_events').doc(fichaje.eventId));
  console.log(
    '    estado tras fichar:',
    fichaje.attendanceState,
    '| duplicado:',
    fichaje.duplicated,
  );

  paso(7, 'IDEMPOTENCIA: el mismo fichaje otra vez no crea otro');
  const repetido = await llamar('submitTimeEvent', {
    kioskAuth,
    actionToken: ctx.actionToken,
    eventType: 'clock_in',
    idempotencyKey: clave,
  });
  console.log(
    '    duplicado:',
    repetido.duplicated,
    '| mismo id:',
    repetido.eventId === fichaje.eventId,
  );

  paso(8, 'MAQUINA DE ESTADOS: no se puede entrar dos veces');
  try {
    await llamar('submitTimeEvent', {
      kioskAuth,
      actionToken: ctx.actionToken,
      eventType: 'clock_in',
      idempotencyKey: `${clave}-b`,
    });
    console.log('    !!! FALLO: acepto dos entradas seguidas');
  } catch (e) {
    console.log('    rechazado:', e.message.split(': ').slice(1).join(': '));
  }

  paso(9, 'La proyeccion se construyo sola');
  const sesiones = await db
    .collection('work_sessions')
    .where('employee_id', '==', 'empleada-ana')
    .where('status', '==', 'open')
    .get();
  for (const d of sesiones.docs) {
    console.log('    sesion abierta:', d.id, '| empezo:', d.data().starts_at);
    limpiar.push(d.ref);
  }
  console.log(sesiones.empty ? '    !!! FALLO: no se creo la sesion' : '    la sesion existe');
} catch (error) {
  console.error('\nFALLO:', error.message);
  process.exitCode = 1;
} finally {
  console.log('\n[limpieza] borrando', limpiar.length, 'documentos de prueba');
  for (const ref of limpiar) await ref.delete().catch(() => {});
}
