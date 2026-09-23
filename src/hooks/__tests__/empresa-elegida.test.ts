import { membresiaElegida } from '@/hooks/use-manager-scope';

/**
 * Cuál de tus empresas mira el panel.
 *
 * ESTO NO PODÍA FALLAR ANTES PORQUE NO EXISTÍA: el panel leía tus membresías con
 * `.limit(1)` ordenado por fecha de alta ascendente, así que se quedaba con la MÁS
 * VIEJA y tiraba el resto en silencio. Una segunda empresa no daba error, no salía
 * en ninguna lista y no se podía abrir: era invisible.
 *
 * La regla es de dos líneas y por eso mismo se prueba: es donde cabe el fallo de
 * «el selector se mueve y la pantalla no».
 */

const PE = { organization_id: 'org-pe', role: 'owner' } as const;
const CA = { organization_id: 'org-ca', role: 'owner' } as const;

describe('membresiaElegida', () => {
  it('devuelve la empresa elegida cuando es una de las tuyas', () => {
    expect(membresiaElegida([PE, CA], 'org-ca')).toBe(CA);
    expect(membresiaElegida([PE, CA], 'org-pe')).toBe(PE);
  });

  it('sin elección cae a la más antigua, que es lo que el panel enseñaba antes', () => {
    // La lista llega ordenada por `created_at` ascendente, así que la primera es la vieja.
    expect(membresiaElegida([PE, CA], null)).toBe(PE);
  });

  it('una elección que ya no es tuya cae a la más antigua, no a un panel vacío', () => {
    /*
     * El caso real: te revocan el acceso a la empresa que tenías abierta. Dejar la
     * elección colgando enseñaría un panel sin nada en vez de la empresa que sí te
     * queda, y «no tengo permiso» donde lo que pasa es «esa ya no, esta sí».
     */
    expect(membresiaElegida([PE], 'org-ca')).toBe(PE);
  });

  it('sin ninguna membresía no devuelve nada, y no invento una', () => {
    expect(membresiaElegida([], 'org-ca')).toBeUndefined();
    expect(membresiaElegida([], null)).toBeUndefined();
  });

  it('con una sola empresa da esa, elijas lo que elijas', () => {
    // La comprobación de que quien tenga una sola no nota el cambio.
    expect(membresiaElegida([CA], null)).toBe(CA);
    expect(membresiaElegida([CA], 'org-ca')).toBe(CA);
    expect(membresiaElegida([CA], 'org-pe')).toBe(CA);
  });
});
