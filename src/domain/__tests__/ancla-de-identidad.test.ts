import { indiceDeAncla, TONOS_DE_ANCLA } from '@/domain/ancla-de-identidad';

/**
 * El color del ancla de una persona.
 *
 * Lo que de verdad puede fallar aquí no es «qué número sale» sino las tres propiedades que
 * hacen que el ancla sirva: que sea SIEMPRE el mismo para la misma persona, que reparta, y
 * que no se salga del rango. Se prueban esas, no los valores concretos: fijar el número
 * exacto ataría la función a su implementación y cambiar el reparto sería «romper una
 * prueba» cuando no se rompe nada.
 */

describe('indiceDeAncla', () => {
  it('la misma persona da SIEMPRE el mismo tono', () => {
    // Es la propiedad que lo hace servir: si cambiara entre pantallas, enseñaría una
    // diferencia donde no la hay, que es peor que no tener color.
    const id = 'emp-3f9a21';
    expect(indiceDeAncla(id)).toBe(indiceDeAncla(id));
    expect(indiceDeAncla(id)).toBe(indiceDeAncla(id));
  });

  it('personas distintas no caen todas en el mismo tono', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `empleado-${i}-${i * 7}`);
    const tonos = new Set(ids.map((id) => indiceDeAncla(id)));
    // Con 40 personas y seis tonos, que salgan al menos cuatro distintos. No se pide reparto
    // perfecto —es un hash, no un repartidor— sino que no colapse en uno solo.
    expect(tonos.size).toBeGreaterThanOrEqual(4);
  });

  it('nunca se sale del rango, pase lo que pase con la semilla', () => {
    for (const semilla of ['', 'a', 'Ñandú', '🙂', 'x'.repeat(500), '0', '-1']) {
      const i = indiceDeAncla(semilla);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(TONOS_DE_ANCLA);
    }
  });

  it('un total de cero no revienta ni devuelve NaN', () => {
    /*
     * Pasa si alguien vacía la lista de tonos: sin la guarda, el resto por cero da NaN y
     * el índice se usaría para leer un color, así que la fila entera se quedaría sin
     * fondo. Devolver 0 es lo que deja la pantalla en pie.
     */
    expect(indiceDeAncla('quien-sea', 0)).toBe(0);
  });

  it('cadenas parecidas no caen necesariamente juntas', () => {
    // No es una garantía del hash, pero sí lo que se quiere en la práctica: dos
    // identificadores consecutivos de la base no deberían compartir tono siempre.
    const pares: [string, string][] = [
      ['emp-1', 'emp-2'],
      ['aaa', 'aab'],
      ['Ana', 'Ano'],
    ];
    const distintos = pares.filter(([a, b]) => indiceDeAncla(a) !== indiceDeAncla(b));
    expect(distintos.length).toBeGreaterThan(0);
  });
});
