#!/usr/bin/env node
/**
 * Borra los datos de ejemplo y deja la organización con TUS datos.
 *
 * POR QUE NO BASTA CON «BORRAR Y YA»
 *
 * La app sabe crear empleados, turnos, correcciones y períodos. NO sabe crear
 * organizaciones, sedes ni puestos: las reglas prohíben crear una organización desde
 * el cliente, y para sedes y puestos no hay pantalla. Así que un borrado a secas
 * dejaría la app sin nada que enseñar y sin forma de arrancar desde dentro.
 *
 * Por eso esto hace las dos cosas: limpia lo inventado y planta lo tuyo. A partir de
 * ahí, empleados y turnos ya se crean desde la app.
 *
 * LO QUE NO TOCA, NUNCA: tu acceso. Membresías, invitaciones y perfiles se quedan
 * como están. Borrar la organización o tu membresía te dejaría fuera de tu propio
 * panel, y recuperarlo exige volver a la terminal. El id interno de la organización
 * tampoco cambia —tu membresía se llama `{orgId}_{uid}`—: lo que cambia es su nombre,
 * que es lo único que se ve.
 *
 * NO BORRA NADA SIN QUE SE LO PIDAS. Sin `--confirmar` solo enseña lo que haría.
 *
 * Uso:
 *     node functions/scripts/configurar-empresa.mjs
 *     node functions/scripts/configurar-empresa.mjs \
 *       --nombre "Mi Empresa" \
 *       --sedes "Tienda Centro,Tienda Norte" \
 *       --puestos "Caja,Cocina,Reparto" \
 *       --confirmar
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROYECTO = 'krealo-shift';
const ORG = 'krealo-demo';

initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();
const ahora = new Date().toISOString();

const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
};
const lista = (valor) =>
  valor === null
    ? null
    : valor
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== '');

const confirmar = process.argv.includes('--confirmar');
const nombre = arg('nombre');
const sedes = lista(arg('sedes'));
const puestos = lista(arg('puestos'));

/**
 * Lo que se vacía. Es todo contenido de ejemplo o historial de las pruebas de humo.
 *
 * `organization_memberships`, `organization_invitations` y `profiles` NO están, y esa
 * ausencia es deliberada: ahí vive quién puede entrar.
 *
 * `_counters` tampoco: guarda el número de secuencia de los fichajes. Reiniciarlo
 * haría que dos eventos distintos compartieran `seq`, y `seq` es justo lo que
 * desempata el orden cuando dos fichajes caen en el mismo instante.
 */
const A_VACIAR = [
  'employees',
  'employee_location_assignments',
  'employee_job_roles',
  'employee_pin_credentials',
  'shifts',
  'shift_publications',
  'time_events',
  'work_sessions',
  'break_intervals',
  'time_adjustments',
  'timesheet_periods',
  'time_edit_requests',
  'announcements',
  'availability_rules',
  'time_off_requests',
  'kiosk_devices',
  'kiosk_device_secrets',
  'kiosk_activation_codes',
  'kiosk_rejected_attempts',
  'manager_alert_deliveries',
  'audit_logs',
  'notification_preferences',
  'push_tokens',
];

/** Un identificador legible a partir de un nombre: «Tienda Centro» → `tienda-centro`. */
const idDesde = (texto) =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const organizacion = await db.collection('organizations').doc(ORG).get();
if (!organizacion.exists) {
  console.error(
    `No existe la organización «${ORG}». Lanza antes: node functions/scripts/sembrar.mjs`,
  );
  process.exit(1);
}

console.log(`Proyecto: ${PROYECTO}\n`);
console.log('SE BORRA');
let total = 0;
const porColeccion = [];
for (const col of A_VACIAR) {
  const snap = await db.collection(col).get();
  if (snap.size === 0) continue;
  porColeccion.push([col, snap]);
  total += snap.size;
  console.log(`  ${col.padEnd(34)} ${String(snap.size).padStart(3)} documento(s)`);
}
if (total === 0) console.log('  (nada: ya está limpio)');

console.log('\nSE CONSERVA');
for (const col of [
  'organization_memberships',
  'organization_invitations',
  'profiles',
  '_counters',
]) {
  const snap = await db.collection(col).get();
  console.log(`  ${col.padEnd(34)} ${String(snap.size).padStart(3)} documento(s)`);
}

console.log('\nSE CREA O SE CAMBIA');
console.log(`  organización  ${organizacion.data().name}  ->  ${nombre ?? '(sin cambio)'}`);
console.log(`  sedes         ${sedes === null ? '(sin cambio)' : sedes.join(', ')}`);
console.log(`  puestos       ${puestos === null ? '(sin cambio)' : puestos.join(', ')}`);

if (!confirmar) {
  console.log('\n--- NO SE ESCRIBIÓ NADA ---');
  console.log('Repite con --confirmar cuando la lista de arriba sea la que quieres.');
  console.log('Ejemplo completo:');
  console.log('  node functions/scripts/configurar-empresa.mjs \\');
  console.log('    --nombre "Mi Empresa" --sedes "Tienda Centro,Tienda Norte" \\');
  console.log('    --puestos "Caja,Cocina" --confirmar');
  process.exit(0);
}

// --- Borrar ---------------------------------------------------------------
for (const [col, snap] of porColeccion) {
  // En lotes de 400: el límite de Firestore son 500 operaciones por lote.
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = db.batch();
    for (const d of snap.docs.slice(i, i + 400)) lote.delete(d.ref);
    await lote.commit();
  }
  console.log(`borrado  ${col} (${snap.size})`);
}

// --- Organización ---------------------------------------------------------
if (nombre !== null) {
  await db
    .collection('organizations')
    .doc(ORG)
    .set({ name: nombre, slug: idDesde(nombre), updated_at: ahora }, { merge: true });
  console.log(`organización renombrada a «${nombre}»`);
}

// --- Sedes ----------------------------------------------------------------
if (sedes !== null) {
  const anteriores = await db.collection('locations').where('organization_id', '==', ORG).get();
  const lote = db.batch();
  for (const d of anteriores.docs) lote.delete(d.ref);

  const nuevos = [];
  for (const sede of sedes) {
    const id = idDesde(sede);
    nuevos.push(id);
    lote.set(db.collection('locations').doc(id), {
      id,
      organization_id: ORG,
      name: sede,
      address: '',
      timezone: 'America/Lima',
      is_active: true,
      settings: {
        pinLength: 6,
        photoEnabled: false,
        photoRetentionDays: 30,
        earlyClockInMinutes: 10,
        lateGraceMinutes: 5,
        allowUnscheduledShifts: true,
        timeFormat: '24h',
        requiredBreakMinutes: 0,
        dailyOvertimeThresholdMinutes: 480,
        weeklyOvertimeThresholdMinutes: 2880,
      },
      created_at: ahora,
      updated_at: ahora,
    });
  }
  await lote.commit();
  console.log(`sedes: ${nuevos.join(', ')}`);

  /**
   * Y LAS MEMBRESIAS SE REAPUNTAN, que es lo que se olvida al cambiar las sedes.
   *
   * `managed_location_ids` es una copia que las reglas leen para saber qué tiendas
   * administra alguien. Si se cambian las sedes y no se actualiza, esa lista apunta
   * a ubicaciones que ya no existen: un owner deja de poder ver su propio horario y
   * el síntoma es «Falta un permiso», sin nada que lo relacione con este cambio.
   */
  const membresias = await db
    .collection('organization_memberships')
    .where('organization_id', '==', ORG)
    .get();
  const loteM = db.batch();
  for (const d of membresias.docs) {
    const m = d.data();
    if (m._centinela === true) continue;
    const mandan = m.role === 'owner' || m.role === 'admin';
    loteM.update(d.ref, { managed_location_ids: mandan ? nuevos : [], updated_at: ahora });
  }
  await loteM.commit();
  console.log(`membresías reapuntadas a las sedes nuevas: ${membresias.size}`);
}

// --- Puestos --------------------------------------------------------------
if (puestos !== null) {
  const anteriores = await db.collection('job_roles').where('organization_id', '==', ORG).get();
  const lote = db.batch();
  for (const d of anteriores.docs) lote.delete(d.ref);

  const COLORES = ['#7157E8', '#2FA36B', '#B56B00', '#2A6FA8', '#C43D4D'];
  puestos.forEach((puesto, indice) => {
    const id = idDesde(puesto);
    lote.set(db.collection('job_roles').doc(id), {
      id,
      organization_id: ORG,
      name: puesto,
      color: COLORES[indice % COLORES.length],
      is_active: true,
      created_at: ahora,
    });
  });
  await lote.commit();
  console.log(`puestos: ${puestos.join(', ')}`);
}

console.log('\nListo. Recarga la app.');
console.log('Los empleados y los turnos ya se crean desde la app: Equipo → Agregar empleado.');
