#!/usr/bin/env node
/**
 * Convierte a alguien que ya entró con Google en propietario de la organización.
 *
 * POR QUE ES UN PASO APARTE Y NO PARTE DEL SEMBRADOR
 *
 * La membresía se identifica por el `uid` de Firebase, y ese `uid` no existe hasta
 * que la persona entra con Google por primera vez: Firebase lo crea en ese momento.
 * Sembrarla antes obligaría a inventar un `uid`, y cuando la persona entrara de
 * verdad tendría otro y no vería nada — con el agravante de que el síntoma es una
 * app que carga bien y aparece vacía, que es el peor de los síntomas porque no
 * parece un error de permisos.
 *
 * ESTE SCRIPT NO CREA CUENTAS. Si el correo no ha entrado nunca, lo dice y para.
 *
 * Uso:
 *     node functions/scripts/vincular-propietario.mjs alguien@empresa.com
 *     node functions/scripts/vincular-propietario.mjs alguien@empresa.com --rol admin
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROYECTO = 'krealo-shift';
const ORG = 'krealo-demo';

const correo = process.argv[2];
const indiceRol = process.argv.indexOf('--rol');
const rol = indiceRol === -1 ? 'owner' : process.argv[indiceRol + 1];

if (correo === undefined || !correo.includes('@')) {
  console.error(
    'Falta el correo. Uso: node functions/scripts/vincular-propietario.mjs tu@correo.com',
  );
  process.exit(1);
}
if (!['owner', 'admin', 'manager', 'employee'].includes(rol)) {
  console.error(`Rol no válido: ${rol}. Son owner, admin, manager o employee.`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const auth = getAuth();
const db = getFirestore();

let usuario;
try {
  usuario = await auth.getUserByEmail(correo);
} catch {
  console.error(`\nNadie ha entrado todavía con ${correo}.`);
  console.error('Entra una vez con Google en la app y vuelve a lanzar esto.');
  process.exit(1);
}

const organizacion = await db.collection('organizations').doc(ORG).get();
if (!organizacion.exists) {
  console.error(`\nNo existe la organización «${ORG}». Lanza antes:`);
  console.error('  node functions/scripts/sembrar.mjs');
  process.exit(1);
}

const ahora = new Date().toISOString();

/**
 * Las ubicaciones gestionadas se copian en la membresía, y no es redundancia: las
 * reglas de Firestore no pueden consultar, solo leer un documento por su id. Con
 * esta lista, saber si alguien administra una tienda cuesta UNA lectura; sin ella
 * harían falta tres saltos que una regla no sabe dar.
 *
 * Un owner o admin las administra todas, así que la lista se rellena igualmente
 * para que un cambio de rol posterior no la deje vacía por sorpresa.
 */
const ubicaciones = await db.collection('locations').where('organization_id', '==', ORG).get();
const ubicacionesGestionadas = ubicaciones.docs.map((doc) => doc.id);

// Id determinista `{orgId}_{uid}`: es el mismo que buscan las reglas y las funciones.
const membresiaId = `${ORG}_${usuario.uid}`;

await db.collection('organization_memberships').doc(membresiaId).set(
  {
    id: membresiaId,
    organization_id: ORG,
    user_id: usuario.uid,
    role: rol,
    status: 'active',
    managed_location_ids: ubicacionesGestionadas,
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

console.log(`\nListo. ${correo} es «${rol}» de ${ORG}.`);
console.log(`  uid:         ${usuario.uid}`);
console.log(`  membresía:   ${membresiaId}`);
console.log(`  ubicaciones: ${ubicacionesGestionadas.join(', ') || '(ninguna)'}`);
console.log('\nSi ya tenía la app abierta, que cierre sesión y vuelva a entrar.');
