/**
 * Lo que se da de alta se tiene que poder volver a leer.
 *
 * POR QUE EXISTE ESTA PRUEBA. El 21-sep-2026 la pantalla de Equipo empezó a decir «Algo
 * no salió bien. La respuesta del servidor no es la esperada», sin nada en la consola,
 * contra el Firebase de verdad. La causa eran TRES campos que el alta no escribía:
 *
 *   - `hire_date` y `user_id` en `employees`. El esquema los declara `.nullable()`, que
 *     acepta `null` pero NO acepta que el campo no esté: llegaban como `undefined` y Zod
 *     rechazaba la fila. Todo empleado dado de alta desde la app producía un documento
 *     que la propia app no podía leer.
 *   - `organization_id` en las asignaciones de sede y de puesto. Sin él la regla de
 *     Firestore deniega la escritura —evalúa `isStaff(undefined)`— y, aunque se
 *     escribiera, la consulta que las busca filtra por ese campo y no las encontraría.
 *
 * El resultado en producción fueron CUATRO empleados a medias: cada intento escribía la
 * fila del empleado y fallaba al asignarle la sede, dejando un huérfano más.
 *
 * NI `tsc` NI EL LINTER PUEDEN VER ESTO: el objeto que se inserta no tiene que parecerse
 * al esquema que lo lee, son dos declaraciones distintas que nadie obliga a cuadrar. Por
 * eso la prueba hace el viaje de ida y vuelta con las FUNCIONES REALES de la app en vez
 * de comprobar formas por separado.
 */

// DEBE IR PRIMERO: enciende el modo demostración antes de que se cargue la app.
import '@/test-utils/encender-demo';

import {
  createEmployee,
  fetchEmployeeJobRoles,
  fetchEmployees,
  fetchJobRoles,
  fetchLocationAssignments,
  updateEmployee,
} from '../api';
import { DEMO_LOCATION_1, DEMO_LOCATION_2, DEMO_ORG_ID } from '@/lib/demo/seed';

describe('alta de un empleado', () => {
  it('lo que se crea se puede volver a leer, con sus sedes y sus puestos', async () => {
    const puestos = await fetchJobRoles(DEMO_ORG_ID);
    expect(puestos.length).toBeGreaterThan(0);
    const puesto = puestos[0]!;

    const id = await createEmployee({
      organizationId: DEMO_ORG_ID,
      draft: {
        fullName: 'Persona Recién Contratada',
        preferredName: null,
        employeeNumber: 'E-999',
        email: null,
        locationIds: [DEMO_LOCATION_1],
        jobRoleIds: [puesto.id],
      },
    });

    /*
     * LA MITAD QUE FALLABA. `fetchEmployees` valida con el MISMO esquema que usa la
     * pantalla, así que si al alta le falta un campo que el esquema exige, esto revienta
     * aquí con el mismo error que veía la persona.
     */
    const empleados = await fetchEmployees(DEMO_ORG_ID);
    const creado = empleados.find((persona) => persona.id === id);
    expect(creado).toBeDefined();
    expect(creado?.full_name).toBe('Persona Recién Contratada');

    /*
     * Y LA OTRA MITAD. Estas dos consultas filtran por `organization_id`, así que una
     * fila escrita sin ese campo no aparece aquí aunque exista. Es exactamente lo que
     * dejaba a los empleados nuevos sin sede y sin puesto.
     */
    const asignaciones = await fetchLocationAssignments({
      organizationId: DEMO_ORG_ID,
      locationIds: [DEMO_LOCATION_1],
    });
    expect(asignaciones.some((fila) => fila.employee_id === id)).toBe(true);

    const suyos = await fetchEmployeeJobRoles({
      organizationId: DEMO_ORG_ID,
      employeeIds: [id],
    });
    expect(suyos.map((fila) => fila.job_role_id)).toContain(puesto.id);
  });

  /**
   * EDITAR ES EL CAMINO QUE BORRA, y por eso tiene prueba propia: guardar reemplaza las
   * asignaciones borrando las viejas primero. Ese borrado es el que fallaba en el
   * Firebase de verdad —la consulta que lo precede no acotaba por `organization_id` y la
   * regla de lectura se apoya en ese campo, asi que la denegaban entera—.
   *
   * Aqui no hay reglas que denegar: el almacen de la demostracion no las tiene. Lo que
   * si comprueba es que el resultado sea correcto, es decir que la vieja desaparezca y
   * la nueva quede, que es la otra mitad de lo que puede salir mal al reemplazar.
   */
  it('editarlo cambia sus sedes: la vieja desaparece y la nueva queda', async () => {
    const puestos = await fetchJobRoles(DEMO_ORG_ID);
    const puesto = puestos[0]!;

    const id = await createEmployee({
      organizationId: DEMO_ORG_ID,
      draft: {
        fullName: 'Persona Que Cambia De Sede',
        preferredName: null,
        employeeNumber: 'E-998',
        email: null,
        locationIds: [DEMO_LOCATION_1],
        jobRoleIds: [puesto.id],
      },
    });

    await updateEmployee({
      organizationId: DEMO_ORG_ID,
      employeeId: id,
      draft: {
        fullName: 'Persona Que Cambia De Sede',
        preferredName: null,
        employeeNumber: 'E-998',
        email: null,
        locationIds: [DEMO_LOCATION_2],
        jobRoleIds: [puesto.id],
      },
    });

    const enLaVieja = await fetchLocationAssignments({
      organizationId: DEMO_ORG_ID,
      locationIds: [DEMO_LOCATION_1],
    });
    expect(enLaVieja.some((fila) => fila.employee_id === id)).toBe(false);

    const enLaNueva = await fetchLocationAssignments({
      organizationId: DEMO_ORG_ID,
      locationIds: [DEMO_LOCATION_2],
    });
    expect(enLaNueva.some((fila) => fila.employee_id === id)).toBe(true);

    // Y su puesto sigue ahi: reemplazar sedes no puede llevarse por delante los puestos.
    const suyos = await fetchEmployeeJobRoles({ organizationId: DEMO_ORG_ID, employeeIds: [id] });
    expect(suyos.map((fila) => fila.job_role_id)).toContain(puesto.id);
  });
});
