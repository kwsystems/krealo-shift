import { z } from 'zod';

/**
 * Un identificador de documento de Firestore.
 *
 * SUSTITUYE A `docId()`, QUE HABRIA RECHAZADO CASI TODOS LOS DATOS REALES.
 *
 * En Postgres cada clave primaria era un `uuid` de verdad y validar su forma salia
 * gratis. En Firestore no: los id automaticos son cadenas de 20 caracteres, y varios
 * de los nuestros son DELIBERADAMENTE deterministas —`{orgId}_{uid}` para la
 * membresia, `{orgId}_{idempotencyKey}` para un fichaje, `{empleado}_{inicio}` para
 * una sesion de trabajo—. Esos id no son un capricho: son lo que permite que una
 * regla de seguridad resuelva la membresia con UN `get()` en vez de una consulta que
 * las reglas no pueden hacer, y lo que hace que reintentar un fichaje escriba encima
 * del mismo documento en vez de duplicarlo.
 *
 * Asi que la forma de UUID y la idempotencia eran incompatibles, y se eligio la
 * idempotencia. No se pierde ninguna defensa: `.uuid()` nunca fue un control de
 * seguridad —el servidor jamas confio en un id porque tuviera guiones en su sitio—,
 * solo una comprobacion de forma. Lo que si se conserva es que el campo exista y no
 * venga vacio, que es lo unico que la pantalla necesita para no pintar `undefined`.
 */
export const docId = () => z.string().min(1);
