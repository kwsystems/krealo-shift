/**
 * La demostración tiene que sobrevivir a las MISMAS validaciones que la app real.
 *
 * POR QUÉ EXISTE ESTA PRUEBA
 * La primera versión de la semilla sembraba la membresía sin `status` ni `created_at`.
 * Las dos columnas existen en la base de verdad y la consulta de alcance filtra por
 * ellas, así que la fila estaba ahí pero no la alcanzaba ningún filtro: no había
 * membresía, y la app entera —las cinco pestañas— respondía «falta un permiso». Ni
 * `tsc` ni el linter pueden ver eso: el nombre de una columna es una cadena válida.
 *
 * Así que esto no comprueba el motor de consultas, que sería comprobar mi propio
 * código contra sí mismo. Llama a las FUNCIONES REALES de la app —las mismas que usan
 * las pantallas, con sus esquemas Zod— y exige que devuelvan datos. Si una columna de
 * la semilla se desalinea del filtro o del esquema, esto falla nombrando la pantalla
 * que se habría quedado vacía.
 */

// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
// Babel respeta el orden relativo de los imports, y de eso depende esta prueba entera.
import '@/test-utils/encender-demo';

import { fetchEmployees, fetchJobRoles, fetchLocationAssignments } from '@/features/team/api';
import { fetchPublications, fetchWeekShifts } from '@/features/schedules/api';
import { fetchDailySummaries, fetchPeriod, fetchWorkSessions } from '@/features/timesheets/api';
import { fetchRequests } from '@/features/requests/api';
import { fetchKioskDevices } from '@/features/settings/api';
import { fetchBreakTimeByReason } from '@/features/reports/api';
import { getDataClient } from '@/lib/firebase/query';
import { authSource } from '@/lib/firebase/session';
import { DEMO_LOCATION_1, DEMO_ORG_ID } from '@/lib/demo/seed';
import { TABLES } from '@/lib/firebase/tables';
import { BREAK_REASONS } from '@/domain/break-reason';

const lunes = (() => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  hoy.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  return hoy;
})();

const clave = (fecha: Date) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(
    fecha.getDate(),
  ).padStart(2, '0')}`;

const domingo = new Date(lunes);
domingo.setDate(domingo.getDate() + 6);

describe('modo demostración', () => {
  /**
   * ANTES ESTA PRUEBA AFIRMABA LO CONTRARIO: que había sesión desde el primer instante.
   * Era cierto y era un problema: con sesión desde el arranque, la pantalla de acceso
   * no se veía NUNCA, y eso fue lo primero que Andree echó en falta al abrir la app.
   *
   * Ahora la demostración arranca fuera y se entra con un botón. Se comprueban las dos
   * mitades, porque las dos pueden romperse por separado: que se empieza fuera —si no,
   * vuelve a desaparecer el login— y que se entra —si no, la demostración no sirve—.
   */
  it('arranca SIN sesión, para que la pantalla de acceso se vea', async () => {
    const auth = authSource();
    expect(auth).not.toBeNull();
    await auth!.ready();
    expect(auth!.currentUser()).toBeNull();
  });

  it('y el botón de demostración abre la sesión', async () => {
    const auth = authSource();
    expect(auth!.signInDemo).not.toBeNull();
    await auth!.signInDemo!();
    await auth!.ready();
    expect(auth!.currentUser()).not.toBeNull();
    await auth!.signOut();
  });

  /**
   * La consulta que dejó la app entera en «falta un permiso». Se comprueba con los
   * MISMOS filtros que usa `fetchManagerScope`, no leyendo la tabla entera: el fallo
   * era justamente que la fila existía y el filtro no la alcanzaba.
   */
  it('la membresía pasa el filtro de alcance, no solo existe', async () => {
    const db = getDataClient();
    const { data, error } = await db!
      .from(TABLES.organizationMemberships)
      .select('organization_id, role')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.organization_id).toBe(DEMO_ORG_ID);
  });

  it('Equipo tiene empleados, puestos y asignaciones', async () => {
    const empleados = await fetchEmployees(DEMO_ORG_ID);
    expect(empleados.length).toBeGreaterThan(5);

    const puestos = await fetchJobRoles(DEMO_ORG_ID);
    expect(puestos.length).toBeGreaterThan(0);

    const asignaciones = await fetchLocationAssignments({
      organizationId: DEMO_ORG_ID,
      locationIds: [DEMO_LOCATION_1],
    });
    expect(asignaciones.length).toBeGreaterThan(0);
  });

  it('Horario tiene turnos de esta semana y una publicación', async () => {
    const turnos = await fetchWeekShifts({
      organizationId: DEMO_ORG_ID,
      locationId: DEMO_LOCATION_1,
      fromISO: lunes.toISOString(),
      toISO: domingo.toISOString(),
    });
    expect(turnos.length).toBeGreaterThan(0);

    const publicaciones = await fetchPublications({
      organizationId: DEMO_ORG_ID,
      locationId: DEMO_LOCATION_1,
      weekStart: clave(lunes),
    });
    expect(publicaciones.length).toBeGreaterThan(0);
  });

  it('Horas tiene sesiones y el período de esta semana', async () => {
    const sesiones = await fetchWorkSessions({
      organizationId: DEMO_ORG_ID,
      locationId: DEMO_LOCATION_1,
      fromISO: new Date(lunes.getTime() - 7 * 86400000).toISOString(),
      toISO: domingo.toISOString(),
    });
    expect(sesiones.length).toBeGreaterThan(0);

    const periodo = await fetchPeriod({
      organizationId: DEMO_ORG_ID,
      locationId: DEMO_LOCATION_1,
      from: clave(lunes),
      to: clave(domingo),
    });
    expect(periodo).not.toBeNull();
  });

  /**
   * El resumen diario solo tiene filas de días ya cerrados, así que un LUNES está
   * legítimamente vacío. Se pide la semana anterior, que siempre tiene días cerrados:
   * si se pidiera la actual, esta prueba fallaría un día de cada siete, y una prueba
   * que falla por el calendario se acaba ignorando.
   */
  it('el resumen diario responde con la forma correcta', async () => {
    const resumen = await fetchDailySummaries({
      locationId: DEMO_LOCATION_1,
      from: clave(new Date(lunes.getTime() - 7 * 86400000)),
      to: clave(domingo),
    });
    expect(Array.isArray(resumen)).toBe(true);
  });

  it('hay solicitudes pendientes en la bandeja', async () => {
    const solicitudes = await fetchRequests({
      organizationId: DEMO_ORG_ID,
      locationId: DEMO_LOCATION_1,
    });
    expect(solicitudes.length).toBeGreaterThan(0);
  });

  /**
   * Reportes se apoya en `break_time_by_reason`, una vista NUEVA. Una vista que la
   * semilla no tenga no da error: devuelve cero filas, y el gráfico de «en qué se va
   * el tiempo» sale vacío para siempre sin que nada lo denuncie —exactamente el fallo
   * silencioso que ya dejó la app entera en «falta un permiso»—. Por eso se comprueba
   * que responde CON datos, y que los motivos son de los que la app conoce.
   */
  it('Reportes recibe pausas con motivo, no una vista vacía', async () => {
    const pausas = await fetchBreakTimeByReason({
      locationId: DEMO_LOCATION_1,
      from: clave(new Date(lunes.getTime() - 7 * 86400000)),
      to: clave(domingo),
    });
    expect(pausas.length).toBeGreaterThan(0);
    const motivos = new Set(pausas.map((fila) => fila.break_reason));
    for (const motivo of motivos) {
      expect(BREAK_REASONS).toContain(motivo);
    }
  });

  it('hay relojes en el inventario de kioscos', async () => {
    const kioscos = await fetchKioskDevices(DEMO_ORG_ID);
    expect(kioscos.length).toBeGreaterThan(0);
  });
});
