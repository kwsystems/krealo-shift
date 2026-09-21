#!/usr/bin/env node
/**
 * Da acceso a alguien, haya entrado ya o no.
 *
 * SUSTITUYE A `vincular-propietario.mjs`, que solo servia si la persona ya habia
 * entrado alguna vez. Este resuelve los dos casos, que es lo que hace falta de verdad
 * cuando se monta un equipo:
 *
 *   - SI YA ENTRO: se le escribe la membresia directamente. Efecto inmediato.
 *   - SI NO HA ENTRADO NUNCA: se deja una INVITACION con su correo, y la reclama sola
 *     la primera vez que entre con Google.
 *
 * NO CREA CUENTAS, y esa es la razon de que existan las invitaciones. La membresia se
 * identifica por el `uid` que Firebase asigna al entrar, y ese `uid` no existe antes.
 * La alternativa —fabricarle la cuenta con su correo— es crear la identidad de otra
 * persona en un sistema donde esa identidad firma horas que se pagan.
 *
 * Es idempotente: volver a lanzarlo con el mismo correo y rol no duplica nada.
 *
 * Uso:
 *     node functions/scripts/dar-acceso.mjs alguien@empresa.com --rol admin
 *     node functions/scripts/dar-acceso.mjs alguien@empresa.com          # manager
 *     node functions/scripts/dar-acceso.mjs --listar
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROYECTO = 'krealo-shift';
const ORG = 'krealo-demo';
const ROLES = ['owner', 'admin', 'manager', 'employee'];

initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const auth = getAuth();
const db = getFirestore();
const ahora = new Date().toISOString();

if (process.argv.includes('--listar')) {
  console.log('\nMEMBRESIAS ACTIVAS');
  const membresias = await db.collection('organization_memberships').get();
  for (const d of membresias.docs) {
    const m = d.data();
    if (m._centinela === true) continue;
    let correo = '(desconocido)';
    try {
      correo = (await auth.getUser(m.user_id)).email ?? '(sin correo)';
    } catch {
      correo = '(cuenta borrada)';
    }
    console.log(`  ${correo.padEnd(30)} ${String(m.role).padEnd(9)} ${m.status}`);
  }

  console.log('\nINVITACIONES');
  const invitaciones = await db.collection('organization_invitations').get();
  if (invitaciones.empty) console.log('  (ninguna)');
  for (const d of invitaciones.docs) {
    const i = d.data();
    console.log(`  ${String(i.email).padEnd(30)} ${String(i.role).padEnd(9)} ${i.status}`);
  }
  process.exit(0);
}

const correo = process.argv[2]?.trim().toLowerCase();
const indiceRol = process.argv.indexOf('--rol');
const rol = indiceRol === -1 ? 'manager' : process.argv[indiceRol + 1];

if (correo === undefined || !correo.includes('@')) {
  console.error(
    'Falta el correo. Uso: node functions/scripts/dar-acceso.mjs tu@correo.com --rol admin',
  );
  process.exit(1);
}
if (!ROLES.includes(rol)) {
  console.error(`Rol no válido: ${rol}. Son ${ROLES.join(', ')}.`);
  process.exit(1);
}

const organizacion = await db.collection('organizations').doc(ORG).get();
if (!organizacion.exists) {
  console.error(
    `\nNo existe la organización «${ORG}». Lanza antes: node functions/scripts/sembrar.mjs`,
  );
  process.exit(1);
}

/**
 * Un owner o admin administra TODAS las ubicaciones de su organizacion, asi que la
 * lista se rellena entera. La copia vive en la membresia porque las reglas de
 * Firestore no pueden consultar: con ella, saber si alguien administra una tienda
 * cuesta UNA lectura; sin ella harian falta tres saltos que una regla no sabe dar.
 */
const ubicaciones = (
  await db.collection('locations').where('organization_id', '==', ORG).get()
).docs.map((d) => d.id);
const gestionadas = rol === 'owner' || rol === 'admin' ? ubicaciones : [];

let usuario = null;
try {
  usuario = await auth.getUserByEmail(correo);
} catch {
  usuario = null;
}

if (usuario !== null) {
  const id = `${ORG}_${usuario.uid}`;
  await db.collection('organization_memberships').doc(id).set(
    {
      id,
      organization_id: ORG,
      user_id: usuario.uid,
      role: rol,
      status: 'active',
      managed_location_ids: gestionadas,
      employee_id: null,
      created_at: ahora,
      updated_at: ahora,
    },
    { merge: true },
  );

  await db
    .collection('profiles')
    .doc(usuario.uid)
    .set(
      {
        id: usuario.uid,
        full_name: usuario.displayName ?? correo,
        preferred_name: null,
        avatar_path: usuario.photoURL ?? null,
        locale: 'es-PE',
        phone: null,
        created_at: ahora,
        updated_at: ahora,
      },
      { merge: true },
    );

  console.log(`\n${correo} ya había entrado: membresía escrita directamente.`);
  console.log(`  rol:         ${rol}`);
  console.log(`  uid:         ${usuario.uid}`);
  console.log(`  ubicaciones: ${gestionadas.join(', ') || '(ninguna todavía)'}`);
  console.log('\nSi tenía la app abierta, que recargue.');
} else {
  const id = `${ORG}_${correo}`;
  await db.collection('organization_invitations').doc(id).set(
    {
      id,
      organization_id: ORG,
      email: correo,
      role: rol,
      status: 'pending',
      invited_by: null,
      created_at: ahora,
    },
    { merge: true },
  );

  console.log(`\n${correo} no ha entrado nunca: queda INVITACIÓN pendiente.`);
  console.log(`  rol: ${rol}`);
  console.log('\nQue entre en https://krealo-shift.web.app con Google usando ese mismo');
  console.log('correo. La invitación se canjea sola en ese momento; no hay que volver');
  console.log('a lanzar nada.');
}
