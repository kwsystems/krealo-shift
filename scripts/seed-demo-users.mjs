#!/usr/bin/env node
/**
 * Crea los usuarios de demostración en Supabase Auth (especificación §27).
 *
 * Existe porque `supabase/seed.sql` no puede crear usuarios con contraseña: eso
 * pasa por la Auth API. Y la contraseña NO va en el repositorio — se lee de una
 * variable de entorno.
 *
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   DEMO_PASSWORD=... \
 *   node scripts/seed-demo-users.mjs
 *
 * La `service_role` solo se usa aquí, en tu terminal. Nunca entra en la app.
 *
 * Los IDs coinciden con los que fija `supabase/seed.sql`, para que las membresías
 * y los registros laborales del seed apunten a estos usuarios.
 */

import process from 'node:process';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

const DEMO_USERS = [
  {
    id: '33333333-3333-4333-8333-333333333331',
    email: 'demo-owner@krealoshift.invalid',
    name: 'Propietaria Demo',
    role: 'owner',
  },
  {
    id: '33333333-3333-4333-8333-333333333332',
    email: 'demo-manager@krealoshift.invalid',
    name: 'Gerenta Demo',
    role: 'manager',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'demo-empleada@krealoshift.invalid',
    name: 'Sofia Demo',
    role: 'employee',
  },
];

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail('Falta SUPABASE_URL.');
if (!SERVICE_ROLE_KEY) fail('Falta SUPABASE_SERVICE_ROLE_KEY. No la pongas en el repositorio.');
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 12) {
  fail('Falta DEMO_PASSWORD, o tiene menos de 12 caracteres.');
}

// Los correos usan el TLD reservado .invalid a propósito: no existen ni pueden
// recibir correo, así que un demo nunca escribe a una persona real (§27).
const base = SUPABASE_URL.replace(/\/$/, '');

async function upsertUser(user) {
  const response = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: user.id,
      email: user.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.name, demo: true, intended_role: user.role },
    }),
  });

  if (response.ok) return 'creado';

  const body = await response.text();
  // Si ya existe, no es un error: el script debe poder correrse varias veces.
  if (response.status === 422 || body.includes('already been registered')) {
    return 'ya existía';
  }
  throw new Error(`${user.email}: HTTP ${response.status} ${body}`);
}

console.log(`\n  Creando usuarios demo en ${base}\n`);

let failed = false;
for (const user of DEMO_USERS) {
  try {
    const outcome = await upsertUser(user);
    console.log(`  ${user.email.padEnd(40)} ${outcome}`);
  } catch (error) {
    failed = true;
    console.error(`  ${user.email.padEnd(40)} FALLÓ — ${error.message}`);
  }
}

console.log(
  failed
    ? '\n  Terminó con errores.\n'
    : '\n  Listo. Ahora aplica supabase/seed.sql para los datos de negocio.\n',
);

process.exit(failed ? 1 : 0);
