import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EL CLIENTE NO ESCRIBE EN EL BUCKET DEL LOGO. NI SUBIR, NI BORRAR.
 *
 * POR QUÉ ESTA PRUEBA LEE EL CÓDIGO FUENTE, que es raro y aquí está justificado. El
 * invariante no es sobre un valor que se pueda calcular: es sobre POR DÓNDE pasa una
 * operación. Y se rompió así, el 2026-09-28:
 *
 *   1. La subida del logo fallaba porque `storage.rules` usaba `exists()`, que no existe
 *      en las reglas de Storage. Se arregló moviéndola a una Cloud Function y CERRANDO
 *      `organization-logos` a escritura: `allow write: if false`.
 *   2. Pero el BORRADO seguía yendo directo a Storage desde el navegador. La regla nueva
 *      deniega a todo cliente, así que «Quitar logotipo» empezó a fallar para todo el
 *      mundo —incluido el dueño— y el mensaje culpaba a sus permisos.
 *
 * El síntoma era cierto y la explicación falsa, que es la peor combinación: manda a
 * revisar los permisos de una persona cuando la puerta está cerrada para todos.
 *
 * Al cerrar una puerta hay que mirar TODO lo que pasaba por ella. Esta prueba es ese
 * «mirar todo», automatizado: si alguien vuelve a escribir en ese prefijo desde el
 * cliente, falla aquí y no en la tienda.
 *
 * LEER (`getPublicUrl`) SÍ se permite, y tiene que permitirse: el kiosco no tiene sesión y
 * la regla deja ese prefijo público a propósito.
 */
const FUENTE = readFileSync(join(__dirname, '..', 'logo.ts'), 'utf8');

describe('el cliente no escribe en el bucket del logo', () => {
  it('no sube archivos directamente a Storage', () => {
    expect(FUENTE).not.toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.\s*upload\s*\(/);
  });

  it('no borra archivos directamente de Storage', () => {
    expect(FUENTE).not.toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.\s*remove\s*\(/);
  });

  it('las dos operaciones pasan por una función del servidor', () => {
    expect(FUENTE).toContain('RPC.setOrganizationLogo');
    expect(FUENTE).toContain('RPC.clearOrganizationLogo');
  });

  it('pero SÍ lee la URL pública, que es lo que el kiosco necesita', () => {
    expect(FUENTE).toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.\s*getPublicUrl\s*\(/);
  });

  it('y la regla de Storage mantiene ese prefijo cerrado a escritura', () => {
    const reglas = readFileSync(join(__dirname, '..', '..', '..', '..', 'storage.rules'), 'utf8');
    /*
      El bloque va desde su `match` hasta el `match` siguiente. Cortarlo en el primer `}`
      —que fue mi primer intento— corta dentro de `{orgId}` y deja el bloque vacío: la
      prueba fallaba por estar mal escrita, no por un fallo de las reglas.
    */
    const desde = reglas.indexOf('match /organization-logos/');
    const siguiente = reglas.indexOf('match /', desde + 10);
    const hasta = reglas.slice(desde, siguiente === -1 ? undefined : siguiente);
    expect(hasta).toContain('allow read: if true;');
    expect(hasta).toContain('allow write: if false;');
  });
});
