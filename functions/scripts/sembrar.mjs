#!/usr/bin/env node
/**
 * Crea las colecciones de Krealo Shift en Firestore y las deja con una
 * organizacion coherente dentro.
 *
 * POR QUE HACE FALTA UN SEMBRADOR SI FIRESTORE NO TIENE ESQUEMA
 *
 * Justamente por eso. En Postgres, `supabase db push` dejaba las 27 tablas creadas
 * y vacias, y se podia mirar la base para saber que existe. En Firestore una
 * coleccion NO EXISTE hasta que tiene un documento: una base recien creada esta en
 * blanco y no hay forma de distinguir «esta coleccion esta vacia» de «esta coleccion
 * se llama de otra manera y nadie se ha dado cuenta». Este script las materializa
 * todas y de paso deja algo que mirar.
 *
 * ES IDEMPOTENTE: usa identificadores fijos y escribe con `merge`, asi que correrlo
 * dos veces no duplica nada. Se puede volver a lanzar sin pensarlo.
 *
 * NO CREA NINGUNA CUENTA. La membresia del propietario necesita el `uid` que Firebase
 * asigna al entrar con Google por primera vez, y ese `uid` no existe hasta que
 * alguien entra. Cuando exista:
 *
 *     node functions/scripts/vincular-propietario.mjs tu@correo.com
 *
 * Uso:
 *     node functions/scripts/sembrar.mjs              # crea o actualiza
 *     node functions/scripts/sembrar.mjs --solo-ver   # dice que haria, sin escribir
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROYECTO = 'krealo-shift';
const soloVer = process.argv.includes('--solo-ver');

initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();

const ahora = new Date().toISOString();

// Identificadores fijos: son lo que hace el script idempotente.
const ORG = 'krealo-demo';
const SEDE_1 = 'sede-principal';
const SEDE_2 = 'sucursal-miraflores';
const PUESTO_CAJA = 'puesto-caja';
const PUESTO_PISO = 'puesto-piso';
const EMP_1 = 'empleada-ana';
const EMP_2 = 'empleado-luis';

/**
 * Las fechas se escriben como texto ISO 8601 en UTC, NO como Timestamp.
 *
 * Es la misma decision que toman las funciones y el cliente, y tiene que ser la
 * misma en los tres sitios: ISO en UTC ordena igual como texto que como instante,
 * asi que los rangos y los `order by` funcionan sobre el texto. Si el sembrador
 * escribiera Timestamp y la app texto, las consultas de rango no encontrarian lo
 * sembrado y pareceria que la base esta vacia.
 */
const dia = (offset) => {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + offset);
  return fecha.toISOString().slice(0, 10);
};
const enDia = (offset, hora, minuto = 0) =>
  new Date(
    `${dia(offset)}T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00.000Z`,
  ).toISOString();

/** Cada entrada es [coleccion, id, datos]. El orden no importa: no hay claves ajenas. */
const documentos = [
  [
    'organizations',
    ORG,
    {
      id: ORG,
      name: 'Krealo Demo',
      slug: 'krealo-demo',
      logo_path: null,
      default_locale: 'es-PE',
      default_timezone: 'America/Lima',
      week_starts_on: 1,
      settings: {},
      created_at: ahora,
      updated_at: ahora,
    },
  ],

  [
    'locations',
    SEDE_1,
    {
      id: SEDE_1,
      organization_id: ORG,
      name: 'Sede Principal',
      address: 'Av. Larco 123, Miraflores',
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
    },
  ],
  [
    'locations',
    SEDE_2,
    {
      id: SEDE_2,
      organization_id: ORG,
      name: 'Sucursal Miraflores',
      address: 'Av. Pardo 456, Miraflores',
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
    },
  ],

  [
    'job_roles',
    PUESTO_CAJA,
    {
      id: PUESTO_CAJA,
      organization_id: ORG,
      name: 'Caja',
      color: '#7157E8',
      is_active: true,
      created_at: ahora,
    },
  ],
  [
    'job_roles',
    PUESTO_PISO,
    {
      id: PUESTO_PISO,
      organization_id: ORG,
      name: 'Piso de venta',
      color: '#2FA36B',
      is_active: true,
      created_at: ahora,
    },
  ],

  [
    'employees',
    EMP_1,
    {
      id: EMP_1,
      organization_id: ORG,
      user_id: null,
      employee_number: 'E-001',
      full_name: 'Ana Quispe',
      preferred_name: 'Ana',
      email: null,
      avatar_path: null,
      status: 'active',
      hire_date: dia(-300),
      created_at: ahora,
      updated_at: ahora,
    },
  ],
  [
    'employees',
    EMP_2,
    {
      id: EMP_2,
      organization_id: ORG,
      user_id: null,
      employee_number: 'E-002',
      full_name: 'Luis Mendoza',
      preferred_name: 'Luis',
      email: null,
      avatar_path: null,
      status: 'active',
      hire_date: dia(-120),
      created_at: ahora,
      updated_at: ahora,
    },
  ],

  // Id compuesto `{empleado}_{ubicacion}`, igual que la clave primaria que tenia en
  // Postgres: es lo que deja que `upsert` no duplique la asignacion.
  [
    'employee_location_assignments',
    `${EMP_1}_${SEDE_1}`,
    {
      id: `${EMP_1}_${SEDE_1}`,
      organization_id: ORG,
      employee_id: EMP_1,
      location_id: SEDE_1,
      can_manage: true,
      is_primary: true,
      created_at: ahora,
    },
  ],
  [
    'employee_location_assignments',
    `${EMP_2}_${SEDE_2}`,
    {
      id: `${EMP_2}_${SEDE_2}`,
      organization_id: ORG,
      employee_id: EMP_2,
      location_id: SEDE_2,
      can_manage: false,
      is_primary: true,
      created_at: ahora,
    },
  ],

  [
    'employee_job_roles',
    `${EMP_1}_${PUESTO_CAJA}`,
    {
      id: `${EMP_1}_${PUESTO_CAJA}`,
      organization_id: ORG,
      employee_id: EMP_1,
      job_role_id: PUESTO_CAJA,
      is_primary: true,
    },
  ],
  [
    'employee_job_roles',
    `${EMP_2}_${PUESTO_PISO}`,
    {
      id: `${EMP_2}_${PUESTO_PISO}`,
      organization_id: ORG,
      employee_id: EMP_2,
      job_role_id: PUESTO_PISO,
      is_primary: true,
    },
  ],

  [
    'shifts',
    'turno-ana-hoy',
    {
      id: 'turno-ana-hoy',
      organization_id: ORG,
      location_id: SEDE_1,
      employee_id: EMP_1,
      job_role_id: PUESTO_CAJA,
      starts_at: enDia(0, 13),
      ends_at: enDia(0, 21),
      timezone: 'America/Lima',
      planned_unpaid_break_minutes: 30,
      employee_note: null,
      manager_note: null,
      status: 'published',
      publication_version: 1,
      published_at: ahora,
      created_by: null,
      updated_by: null,
      created_at: ahora,
      updated_at: ahora,
    },
  ],
  [
    'shifts',
    'turno-luis-hoy',
    {
      id: 'turno-luis-hoy',
      organization_id: ORG,
      location_id: SEDE_2,
      employee_id: EMP_2,
      job_role_id: PUESTO_PISO,
      starts_at: enDia(0, 14),
      ends_at: enDia(0, 22),
      timezone: 'America/Lima',
      planned_unpaid_break_minutes: 30,
      employee_note: null,
      manager_note: null,
      status: 'published',
      publication_version: 1,
      published_at: ahora,
      created_by: null,
      updated_by: null,
      created_at: ahora,
      updated_at: ahora,
    },
  ],

  [
    'shift_publications',
    'publicacion-semana-sede1',
    {
      id: 'publicacion-semana-sede1',
      organization_id: ORG,
      location_id: SEDE_1,
      week_starts_on: dia(-new Date().getUTCDay() + 1),
      publication_version: 1,
      published_by: null,
      published_at: ahora,
      changed_shift_ids: ['turno-ana-hoy'],
    },
  ],

  [
    'timesheet_periods',
    'periodo-semana-sede1',
    {
      id: 'periodo-semana-sede1',
      organization_id: ORG,
      location_id: SEDE_1,
      starts_on: dia(-7),
      ends_on: dia(0),
      status: 'open',
      approved_by: null,
      approved_at: null,
      created_at: ahora,
      updated_at: ahora,
    },
  ],

  [
    'announcements',
    'anuncio-bienvenida',
    {
      id: 'anuncio-bienvenida',
      organization_id: ORG,
      location_id: null,
      title: 'Bienvenidos a Krealo Shift',
      body: 'El reloj del local ya está listo. Marca tu entrada con tu PIN.',
      starts_at: ahora,
      ends_at: null,
      requires_acknowledgement: false,
      created_by: null,
      created_at: ahora,
    },
  ],

  /**
   * LAS COLECCIONES SENSIBLES SE MATERIALIZAN CON UN CENTINELA, NO CON DATOS FALSOS.
   *
   * `employee_pin_credentials`, `kiosk_device_secrets` y `kiosk_activation_codes`
   * guardan hashes de PIN y credenciales de dispositivo. Sembrarlas con valores de
   * mentira seria dejar un PIN conocido que funciona, y un PIN de demostracion en
   * una base de produccion es la clase de cosa que nadie recuerda quitar. El
   * centinela existe solo para que la coleccion aparezca en la consola con sus
   * reglas puestas; no abre nada porque no es la credencial de ningun empleado ni
   * de ningun aparato.
   */
  [
    'employee_pin_credentials',
    '_coleccion',
    {
      _centinela: true,
      _nota: 'Marcador para materializar la colección. Los PIN reales los escribe setEmployeePin.',
      created_at: ahora,
    },
  ],
  [
    'kiosk_device_secrets',
    '_coleccion',
    {
      _centinela: true,
      _nota: 'Marcador. Los secretos reales los escribe activateKiosk.',
      created_at: ahora,
    },
  ],
  [
    'kiosk_activation_codes',
    '_coleccion',
    {
      _centinela: true,
      _nota: 'Marcador. Los códigos reales los escribe createKioskActivationCode.',
      used_count: 1,
      expires_at: '1970-01-01T00:00:00.000Z',
      created_at: ahora,
    },
  ],
];

/**
 * Colecciones que NO se siembran con contenido porque su contenido es historia real.
 *
 * Un fichaje de mentira en `time_events` es una hora que alguien podria cobrar, y
 * `time_events` es append-only: no se puede borrar despues. Igual con la auditoria,
 * que deja de probar nada en cuanto tiene entradas inventadas. Se materializan con
 * un centinela y nada mas.
 */
const SOLO_CENTINELA = [
  'time_events',
  'work_sessions',
  'break_intervals',
  'time_adjustments',
  'time_edit_requests',
  'audit_logs',
  'kiosk_devices',
  'kiosk_rejected_attempts',
  'manager_alert_deliveries',
  'push_tokens',
  'notification_preferences',
  'availability_rules',
  'time_off_requests',
  'organization_memberships',
  'profiles',
];

for (const coleccion of SOLO_CENTINELA) {
  documentos.push([
    coleccion,
    '_coleccion',
    {
      _centinela: true,
      _nota:
        'Marcador para materializar la colección. Los datos reales los escriben la app y las funciones.',
      created_at: ahora,
    },
  ]);
}

const porColeccion = new Map();
for (const [coleccion] of documentos) {
  porColeccion.set(coleccion, (porColeccion.get(coleccion) ?? 0) + 1);
}

console.log(`Proyecto: ${PROYECTO}`);
console.log(`Colecciones: ${porColeccion.size}  ·  Documentos: ${documentos.length}`);
for (const [coleccion, cuantos] of [...porColeccion].sort()) {
  console.log(`  ${coleccion.padEnd(32)} ${cuantos}`);
}

if (soloVer) {
  console.log('\n--solo-ver: no se escribió nada.');
  process.exit(0);
}

// Un lote de Firestore admite 500 operaciones; esto cabe de sobra, pero se trocea
// igual para que anadir documentos mañana no rompa el script en silencio.
for (let i = 0; i < documentos.length; i += 400) {
  const lote = db.batch();
  for (const [coleccion, id, datos] of documentos.slice(i, i + 400)) {
    lote.set(db.collection(coleccion).doc(id), datos, { merge: true });
  }
  await lote.commit();
}

console.log('\nListo. Las colecciones existen y la organización de ejemplo está dentro.');
console.log('Siguiente paso, cuando alguien entre con Google por primera vez:');
console.log('  node functions/scripts/vincular-propietario.mjs <su-correo>');
